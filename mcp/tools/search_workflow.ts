import { z } from "zod";
import { listEntries, listNodes, listWorkflows, resolveUserId } from "../../store/kv.ts";
import type { NodeType, Workflow, WorkflowNode } from "../../store/types.ts";
import { defineTool, requireWorkflow, richResponse, STATUS_ICONS } from "../helpers.ts";

const SearchWorkflowSchema = z.object({
  query: z.string().min(1).describe(
    "The search query string. Supports boolean OR / AND syntax (e.g. 'authentication OR passkey'), exact phrases, and case-insensitive substrings.",
  ),
  includeDescriptions: z.boolean().optional().default(true).describe(
    "Whether to search descriptions, prompts, and configurations in addition to names (default: true).",
  ),
  workflow: z.string().optional().describe(
    "Optional workflow UUID, name, or slug to restrict the search scope to a specific workflow.",
  ),
  workflowId: z.string().optional().describe(
    "Alias for 'workflow'.",
  ),
  type: z.enum(["start", "step", "decision", "end", "subworkflow", "user_interaction"]).optional()
    .describe(
      "Optional node type filter (e.g. 'step', 'decision', 'user_interaction').",
    ),
  limit: z.number().int().positive().optional().default(50).describe(
    "Optional maximum number of matching results to return (default: 50).",
  ),
  format: z.enum(["markdown", "json", "both"]).optional().default("both").describe(
    "Optional output format. 'markdown' returns human-readable tables, 'json' returns raw matches, 'both' (default) returns multi-block annotated content.",
  ),
});

export interface SearchMatchItem {
  workflowId: string;
  workflowName: string;
  isSubworkflow: boolean;
  node?: {
    id: string;
    name: string;
    type: NodeType;
    description: string;
    runInSubAgent: boolean;
    status: string;
  };
  matchedFields: string[];
  snippet: string;
}

/**
 * Checks if a text string matches a search query supporting boolean OR and AND syntax.
 */
function matchesQuery(text: string, query: string): { matched: boolean; matchedTerm?: string } {
  const lowerText = text.toLowerCase();
  const rawQuery = query.trim();

  // Boolean OR syntax
  if (/\s+OR\s+/i.test(rawQuery)) {
    const clauses = rawQuery.split(/\s+OR\s+/i).map((c) => c.trim().toLowerCase()).filter(
      Boolean,
    );
    for (const clause of clauses) {
      if (clause && lowerText.includes(clause)) {
        return { matched: true, matchedTerm: clause };
      }
    }
    return { matched: false };
  }

  // Boolean AND syntax
  if (/\s+AND\s+/i.test(rawQuery)) {
    const clauses = rawQuery.split(/\s+AND\s+/i).map((c) => c.trim().toLowerCase()).filter(
      Boolean,
    );
    const allMatch = clauses.every((clause) => clause && lowerText.includes(clause));
    if (allMatch && clauses.length > 0) {
      return { matched: true, matchedTerm: clauses[0] };
    }
    return { matched: false };
  }

  // Direct substring / keyword matching
  const lowerQuery = rawQuery.toLowerCase();
  if (lowerText.includes(lowerQuery)) {
    return { matched: true, matchedTerm: lowerQuery };
  }

  return { matched: false };
}

/**
 * Extracts a concise surrounding snippet for context around the matched term.
 */
function extractSnippet(fullText: string, matchedTerm?: string, maxLen = 120): string {
  if (!fullText) return "";
  const cleaned = fullText.replace(/\s+/g, " ").trim();
  if (!matchedTerm) {
    return cleaned.length > maxLen ? `${cleaned.slice(0, maxLen)}...` : cleaned;
  }

  const idx = cleaned.toLowerCase().indexOf(matchedTerm.toLowerCase());
  if (idx === -1) {
    return cleaned.length > maxLen ? `${cleaned.slice(0, maxLen)}...` : cleaned;
  }

  const start = Math.max(0, idx - 40);
  const end = Math.min(cleaned.length, idx + matchedTerm.length + 60);
  let snippet = cleaned.slice(start, end);
  if (start > 0) snippet = `...${snippet}`;
  if (end < cleaned.length) snippet = `${snippet}...`;
  return snippet;
}

function formatSearchMarkdown(
  query: string,
  matches: SearchMatchItem[],
  totalScannedWorkflows: number,
): string {
  if (matches.length === 0) {
    return `## 🔍 Workflow Search: \`${query}\`\n\n*No matching workflows or nodes found (scanned ${totalScannedWorkflows} workflow(s)).*`;
  }

  let md = `## 🔍 Workflow Search: \`${query}\` (${matches.length} matches found)\n\n`;

  // Group matches by workflow
  const grouped = new Map<string, SearchMatchItem[]>();
  for (const item of matches) {
    const list = grouped.get(item.workflowId) ?? [];
    list.push(item);
    grouped.set(item.workflowId, list);
  }

  for (const [_wfId, items] of grouped) {
    const first = items[0];
    const typeBadge = first.isSubworkflow ? "📦 *Sub-workflow*" : "🚀 *Standalone*";
    md += `### 📁 **${first.workflowName}** (\`${first.workflowId}\`) — ${typeBadge}\n\n`;
    md += `| Node / Target | Type | Matched In | Snippet / Context |\n`;
    md += `| :--- | :--- | :--- | :--- |\n`;

    for (const match of items) {
      if (match.node) {
        const icon = STATUS_ICONS[match.node.status] ?? "⏳";
        const nodeLabel = `${icon} **${match.node.name}** (\`${match.node.id}\`)`;
        const typeLabel = `\`${match.node.type}\`${
          match.node.runInSubAgent ? " `[Sub-Agent]`" : ""
        }`;
        const fields = match.matchedFields.join(", ");
        const snippet = match.snippet.replace(/\|/g, "/");
        md += `| ${nodeLabel} | ${typeLabel} | \`${fields}\` | ${snippet} |\n`;
      } else {
        const fields = match.matchedFields.join(", ");
        const snippet = match.snippet.replace(/\|/g, "/");
        md += `| *Workflow Metadata* | \`workflow\` | \`${fields}\` | ${snippet} |\n`;
      }
    }
    md += `\n`;
  }

  return md;
}

export const searchWorkflowTool = defineTool({
  name: "workflow_search",
  description:
    "Searches across workflows and their graph nodes for keywords, phrases, or boolean query expressions (e.g. 'authentication OR passkey'). Scans workflow names, node names, descriptions, agent instructions, prompts, and configurations across standalone workflows and child subworkflows with contextual snippet previews.",
  schema: SearchWorkflowSchema,
  execute: async ({
    query,
    includeDescriptions,
    workflow,
    workflowId,
    type,
    limit,
    format,
  }) => {
    let targetWorkflows: Workflow[] = [];
    const scopeIdentifier = workflow ?? workflowId;
    const uid = resolveUserId();
    let nodesByWorkflow: Map<string, WorkflowNode[]> | null = null;

    if (scopeIdentifier) {
      const wfCheck = await requireWorkflow(scopeIdentifier);
      if ("error" in wfCheck) return wfCheck.error;
      targetWorkflows = [wfCheck.workflow];
    } else {
      targetWorkflows = await listWorkflows();
      const allNodes = await listEntries<WorkflowNode>(["users", uid, "nodes"]);
      nodesByWorkflow = new Map<string, WorkflowNode[]>();
      for (const node of allNodes) {
        if (node && node.workflowId) {
          const list = nodesByWorkflow.get(node.workflowId) ?? [];
          list.push(node);
          nodesByWorkflow.set(node.workflowId, list);
        }
      }
    }

    const matches: SearchMatchItem[] = [];

    for (const wf of targetWorkflows) {
      if (matches.length >= limit) break;

      const isSub = wf.intendedForIndependentRun === false;

      // 1. Search workflow-level metadata if no node type filter is set
      if (!type) {
        const wfMatchedFields: string[] = [];
        let matchedSnippet = "";

        const nameMatch = matchesQuery(wf.name, query);
        if (nameMatch.matched) {
          wfMatchedFields.push("name");
          matchedSnippet = extractSnippet(wf.name, nameMatch.matchedTerm);
        }

        if (includeDescriptions && wf.description) {
          const descMatch = matchesQuery(wf.description, query);
          if (descMatch.matched) {
            wfMatchedFields.push("description");
            if (!matchedSnippet) {
              matchedSnippet = extractSnippet(wf.description, descMatch.matchedTerm);
            }
          }
        }

        if (wfMatchedFields.length > 0) {
          matches.push({
            workflowId: wf.id,
            workflowName: wf.name,
            isSubworkflow: isSub,
            matchedFields: wfMatchedFields,
            snippet: matchedSnippet || wf.description || wf.name,
          });
        }
      }

      // 2. Search nodes in this workflow
      const nodes: WorkflowNode[] = nodesByWorkflow
        ? (nodesByWorkflow.get(wf.id) ?? [])
        : (await listNodes(wf.id));

      for (const node of nodes) {
        if (matches.length >= limit) break;
        if (type && node.type !== type) continue;

        const nodeMatchedFields: string[] = [];
        let matchedSnippet = "";

        // Check node name
        const nameMatch = matchesQuery(node.name, query);
        if (nameMatch.matched) {
          nodeMatchedFields.push("name");
          matchedSnippet = extractSnippet(node.name, nameMatch.matchedTerm);
        }

        // Check node description / instructions
        if (includeDescriptions && node.description) {
          const descMatch = matchesQuery(node.description, query);
          if (descMatch.matched) {
            nodeMatchedFields.push("description");
            if (!matchedSnippet) {
              matchedSnippet = extractSnippet(node.description, descMatch.matchedTerm);
            }
          }
        }

        // Check prompt in config (for user_interaction nodes)
        if (includeDescriptions && typeof node.config?.prompt === "string") {
          const promptMatch = matchesQuery(node.config.prompt, query);
          if (promptMatch.matched) {
            nodeMatchedFields.push("config.prompt");
            if (!matchedSnippet) {
              matchedSnippet = extractSnippet(node.config.prompt, promptMatch.matchedTerm);
            }
          }
        }

        // Check options in config (for decision or user_interaction nodes)
        if (includeDescriptions && node.config?.options) {
          const optionsStr = typeof node.config.options === "string"
            ? node.config.options
            : JSON.stringify(node.config.options);
          const optMatch = matchesQuery(optionsStr, query);
          if (optMatch.matched) {
            nodeMatchedFields.push("config.options");
            if (!matchedSnippet) {
              matchedSnippet = extractSnippet(optionsStr, optMatch.matchedTerm);
            }
          }
        }

        // Check contextHint in config
        if (includeDescriptions && typeof node.config?.contextHint === "string") {
          const hintMatch = matchesQuery(node.config.contextHint, query);
          if (hintMatch.matched) {
            nodeMatchedFields.push("config.contextHint");
            if (!matchedSnippet) {
              matchedSnippet = extractSnippet(node.config.contextHint, hintMatch.matchedTerm);
            }
          }
        }

        if (nodeMatchedFields.length > 0) {
          matches.push({
            workflowId: wf.id,
            workflowName: wf.name,
            isSubworkflow: isSub,
            node: {
              id: node.id,
              name: node.name,
              type: node.type,
              description: node.description,
              runInSubAgent: node.runInSubAgent,
              status: node.status,
            },
            matchedFields: nodeMatchedFields,
            snippet: matchedSnippet || node.description || node.name,
          });
        }
      }
    }

    const markdown = formatSearchMarkdown(query, matches, targetWorkflows.length);

    return richResponse({
      data: {
        query,
        totalMatches: matches.length,
        matches,
      },
      markdown,
      format,
    });
  },
});
