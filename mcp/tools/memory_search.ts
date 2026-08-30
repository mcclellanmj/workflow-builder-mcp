import { z } from "zod";
import { getKv, recordMemoryAccess, resolveUserId } from "../../store/kv.ts";
import {
  type MemorySearchHit,
  type MemorySearchResult,
  searchMemoriesFromKv,
} from "../../store/memory_search.ts";
import type { MemoryScope } from "../../store/types.ts";
import {
  createErrorResponse,
  defineTool,
  jsonResponse,
  resolveNodeInWorkflow,
  resolveWorkflow,
  richResponse,
} from "../helpers.ts";

const MemorySearchSchema = z.object({
  query: z.string().optional().describe(
    "The search query string for keyword or semantic matching.",
  ),
  vector: z.array(z.number()).optional().describe(
    "Optional dense vector embedding for vector/semantic similarity search.",
  ),
  mode: z.enum(["hybrid", "keyword", "vector"]).optional().describe(
    "Search execution mode: 'hybrid', 'keyword', or 'vector'. Defaults to 'keyword' (or 'hybrid' if query and vector are both present).",
  ),
  scope: z.enum(["workflow", "node", "role"]).optional().describe(
    "Optional filter by memory scope level.",
  ),
  workflow: z.string().min(1).optional().describe(
    "Workflow UUID, name, or slug to restrict search scope.",
  ),
  workflowId: z.string().min(1).optional().describe(
    "Alias for 'workflow'.",
  ),
  node: z.string().min(1).optional().describe(
    "Node UUID, name, or slug to restrict search scope.",
  ),
  nodeId: z.string().min(1).optional().describe(
    "Alias for 'node'.",
  ),
  role: z.string().min(1).optional().describe(
    "Role name or ID to restrict search scope.",
  ),
  roleId: z.string().min(1).optional().describe(
    "Alias for 'role'.",
  ),
  tags: z.array(z.string()).optional().describe(
    "Optional tags filter. Only memories containing all specified tags are searched/returned.",
  ),
  limit: z.number().int().positive().optional().default(10).describe(
    "Maximum number of matching results to return (default: 10).",
  ),
  threshold: z.number().optional().default(0.0).describe(
    "Minimum relevance score threshold for filtering results (default: 0.0).",
  ),
  format: z.enum(["json", "markdown", "rich", "both"]).optional().default("both").describe(
    "Optional output format. 'markdown' returns a formatted table, 'json' returns raw hits, 'rich'/'both' returns multi-block content.",
  ),
});

export function formatMemorySearchMarkdown(
  query: string | undefined,
  hits: MemorySearchHit[],
  mode: string,
): string {
  const queryDisplay = query ? `\`${query}\`` : "*vector similarity*";
  if (hits.length === 0) {
    return `## 🔍 Memory Search: ${queryDisplay}\n\n*No matching memories found.*`;
  }

  let md =
    `## 🔍 Memory Search: ${queryDisplay} (${hits.length} matches found, mode: \`${mode}\`)\n\n`;
  md += `| Score | Key | Scope | Target | Summary | Tags | Matched In |\n`;
  md += `| :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n`;

  for (const hit of hits) {
    const m = hit.memory;
    let target = "-";
    if (m.scope === "workflow") {
      target = m.workflowId ? `\`${m.workflowId}\`` : "workflow";
    } else if (m.scope === "node") {
      target = `\`${m.workflowId ?? "_"}:${m.nodeId}\``;
    } else if (m.scope === "role") {
      target = m.roleId ? `\`${m.roleId}\`` : "role";
    }

    const scoreDisplay = `**${hit.score.toFixed(2)}**`;
    const summarySanitized = m.summary.replace(/\|/g, "/");
    const tagsDisplay = (m.tags && m.tags.length > 0)
      ? m.tags.map((t) => `\`${t}\``).join(", ")
      : "-";
    const matchedDisplay = hit.matchedFields.map((f) => `\`${f}\``).join(", ");

    md +=
      `| ${scoreDisplay} | **${m.key}** | \`${m.scope}\` | ${target} | ${summarySanitized} | ${tagsDisplay} | ${matchedDisplay} |\n`;
  }

  return md;
}

export const memorySearchTool = defineTool({
  name: "memory_search",
  description:
    "Performs semantic, keyword, and hybrid search over past memories, post-mortems, and design decisions.",
  schema: MemorySearchSchema,
  execute: async ({
    query,
    vector,
    mode,
    scope,
    workflow,
    workflowId: workflowIdArg,
    node,
    nodeId: nodeIdArg,
    role,
    roleId: roleIdArg,
    tags,
    limit,
    threshold,
    format,
  }) => {
    if (!query && (!vector || vector.length === 0)) {
      return createErrorResponse("Either 'query' or 'vector' must be provided for memory search.");
    }

    let workflowId = workflow ?? workflowIdArg;
    if (workflowId) {
      const resolved = await resolveWorkflow(workflowId);
      if (resolved) workflowId = resolved.id;
    }

    let nodeId = node ?? nodeIdArg;
    if (nodeId && workflowId) {
      const resolvedNode = await resolveNodeInWorkflow(workflowId, nodeId);
      if (resolvedNode) nodeId = resolvedNode.id;
    }

    const roleId = (role ?? roleIdArg)?.trim();

    const kv = await getKv();
    const userId = resolveUserId();

    const effectiveMode = mode ?? (vector && query ? "hybrid" : vector ? "vector" : "keyword");

    const searchResult: MemorySearchResult = await searchMemoriesFromKv(kv, userId, {
      query,
      vector,
      mode: effectiveMode,
      scope: scope as MemoryScope | undefined,
      workflowId,
      nodeId,
      roleId,
      tags,
      limit,
      threshold,
    });

    // Record memory access telemetry for all retrieved memories
    await Promise.all(
      searchResult.hits.map((hit) =>
        recordMemoryAccess(hit.memory.id, {
          accessedBy: "memory_search",
          userId,
        })
      ),
    );

    if (format === "json") {
      return jsonResponse({
        query: query ?? null,
        mode: effectiveMode,
        count: searchResult.count,
        totalHits: searchResult.totalHits,
        elapsedMs: searchResult.elapsedMs,
        hits: searchResult.hits,
      });
    }

    const markdown = formatMemorySearchMarkdown(query, searchResult.hits, effectiveMode);

    return richResponse({
      data: {
        query: query ?? null,
        mode: effectiveMode,
        count: searchResult.count,
        totalHits: searchResult.totalHits,
        elapsedMs: searchResult.elapsedMs,
        hits: searchResult.hits,
      },
      markdown,
      format: format === "markdown" ? "markdown" : "both",
    });
  },
});
