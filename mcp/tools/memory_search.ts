import { z } from "zod";
import { getKv, listMemories, type MemorySummary, recordMemoryAccess, resolveUserId } from "../../store/kv.ts";
import {
  type MemorySearchHit,
  type MemorySearchResult,
  searchMemoriesFromKv,
} from "../../store/memory_search.ts";
import {
  defineTool,
  jsonResponse,
  resolveNodeInWorkflow,
  resolveWorkflow,
  richResponse,
} from "../helpers.ts";

const MemorySearchSchema = z.object({
  workflowId: z.string().min(1).describe(
    "Workflow UUID, name, or slug to list or search memories within (required).",
  ),
  nodeId: z.string().min(1).optional().describe(
    "Optional node UUID, name, or slug to filter memories by step.",
  ),
  taskId: z.string().min(1).optional().describe(
    "Optional task ID to filter memories by task.",
  ),
  tags: z.array(z.string()).optional().describe(
    "Optional tags filter. Only memories containing all specified tags are returned.",
  ),
  query: z.string().optional().describe(
    "Optional search query for full-text / keyword matching. When omitted, lists all matching memories (consolidating memory_list).",
  ),
  limit: z.number().int().positive().optional().default(20).describe(
    "Maximum number of matching results to return (default: 20).",
  ),
  threshold: z.number().optional().default(0.0).describe(
    "Minimum relevance score threshold for text search results (default: 0.0).",
  ),
  format: z.enum(["json", "markdown", "rich", "both"]).optional().default("both").describe(
    "Optional output format. 'markdown' returns a formatted table, 'json' returns raw data, 'both' returns multi-block content.",
  ),
});

export function formatMemoryListMarkdown(
  workflowId: string,
  memories: MemorySummary[],
): string {
  if (memories.length === 0) {
    return `## 🧠 Memories for Workflow \`${workflowId}\`\n\n*No memories found matching filters.*`;
  }

  let md = `## 🧠 Memories for Workflow \`${workflowId}\` (${memories.length} found)\n\n`;
  md += `| Key | Summary | Anchor (Step/Task) | Tags | Access Count |\n`;
  md += `| :--- | :--- | :--- | :--- | :--- |\n`;

  for (const m of memories) {
    const anchor = m.nodeId
      ? `Step \`${m.nodeId}\``
      : (m.taskId ? `Task \`${m.taskId}\`` : "Workflow");
    const summarySanitized = m.summary.replace(/\|/g, "/");
    const tagsDisplay = (m.tags && m.tags.length > 0)
      ? m.tags.map((t) => `\`${t}\``).join(", ")
      : "-";
    md += `| **${m.key}** | ${summarySanitized} | ${anchor} | ${tagsDisplay} | ${m.accessCount ?? 0} |\n`;
  }

  return md;
}

export function formatMemorySearchMarkdown(
  query: string,
  hits: MemorySearchHit[],
): string {
  if (hits.length === 0) {
    return `## 🔍 Memory Search: \`${query}\`\n\n*No matching memories found.*`;
  }

  let md = `## 🔍 Memory Search: \`${query}\` (${hits.length} matches found)\n\n`;
  md += `| Score | Key | Anchor (Step/Task) | Summary | Tags | Matched In |\n`;
  md += `| :--- | :--- | :--- | :--- | :--- | :--- |\n`;

  for (const hit of hits) {
    const m = hit.memory;
    const anchor = m.nodeId
      ? `Step \`${m.nodeId}\``
      : (m.taskId ? `Task \`${m.taskId}\`` : "Workflow");
    const scoreDisplay = `**${hit.score.toFixed(2)}**`;
    const summarySanitized = m.summary.replace(/\|/g, "/");
    const tagsDisplay = (m.tags && m.tags.length > 0)
      ? m.tags.map((t) => `\`${t}\``).join(", ")
      : "-";
    const matchedDisplay = hit.matchedFields.map((f) => `\`${f}\``).join(", ");

    md +=
      `| ${scoreDisplay} | **${m.key}** | ${anchor} | ${summarySanitized} | ${tagsDisplay} | ${matchedDisplay} |\n`;
  }

  return md;
}

export const memorySearchTool = defineTool({
  name: "memory_search",
  description:
    "Unified memory search and listing tool. Requires workflowId. When query is omitted, lists memories matching the filters (consolidating memory_list). When query is provided, performs full-text search.",
  schema: MemorySearchSchema,
  execute: async ({
    workflowId: workflowIdArg,
    nodeId: nodeIdArg,
    taskId,
    tags,
    query,
    limit = 20,
    threshold = 0.0,
    format,
  }) => {
    let workflowId = workflowIdArg;
    const resolvedWf = await resolveWorkflow(workflowId);
    if (resolvedWf) {
      workflowId = resolvedWf.id;
    }

    let nodeId = nodeIdArg;
    if (nodeId && workflowId) {
      const resolvedNode = await resolveNodeInWorkflow(workflowId, nodeId);
      if (resolvedNode) {
        nodeId = resolvedNode.id;
      }
    }

    const kv = await getKv();
    const userId = resolveUserId();

    // Case 1: No query -> List memories matching filters (consolidates memory_list)
    if (!query || !query.trim()) {
      const summaries = await listMemories({
        workflowId,
        nodeId,
        taskId,
        tags,
        limit,
        userId,
      });

      if (format === "json") {
        return jsonResponse({
          workflowId,
          count: summaries.length,
          memories: summaries,
        });
      }

      const markdown = formatMemoryListMarkdown(workflowId, summaries);
      return richResponse({
        data: {
          workflowId,
          count: summaries.length,
          memories: summaries,
        },
        markdown,
        format: format === "markdown" ? "markdown" : "both",
      });
    }

    // Case 2: Query provided -> Full-text search using Orama
    const searchResult: MemorySearchResult = await searchMemoriesFromKv(kv, userId, {
      query: query.trim(),
      workflowId,
      nodeId,
      taskId,
      tags,
      limit,
      threshold,
    });

    // Record memory access telemetry for retrieved hits
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
        query: query.trim(),
        workflowId,
        count: searchResult.count,
        totalHits: searchResult.totalHits,
        elapsedMs: searchResult.elapsedMs,
        hits: searchResult.hits,
      });
    }

    const markdown = formatMemorySearchMarkdown(query.trim(), searchResult.hits);

    return richResponse({
      data: {
        query: query.trim(),
        workflowId,
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
