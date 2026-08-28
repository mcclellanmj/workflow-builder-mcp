import { z } from "zod";
import { listMemories, type MemorySummary } from "../../store/kv.ts";
import type { MemoryScope } from "../../store/types.ts";
import { defineTool, resolveNodeInWorkflow, resolveWorkflow, richResponse } from "../helpers.ts";

const MemoryListSchema = z.object({
  workflow: z.string().min(1).optional().describe(
    "Filter memories to a workflow by UUID, name, or slug.",
  ),
  workflowId: z.string().min(1).optional().describe(
    "Alias for 'workflow'. Filter memories to a workflow by UUID, name, or slug.",
  ),
  node: z.string().min(1).optional().describe(
    "Filter memories to a node by UUID, name, or slug.",
  ),
  nodeId: z.string().min(1).optional().describe(
    "Alias for 'node'. Filter memories to a node by UUID, name, or slug.",
  ),
  role: z.string().min(1).optional().describe(
    "Filter memories to a role by name or ID.",
  ),
  roleId: z.string().min(1).optional().describe(
    "Alias for 'role'. Filter memories to a role by name or ID.",
  ),
  scope: z.enum(["workflow", "node", "role"]).optional().describe(
    "Optional filter by memory scope level.",
  ),
  tags: z.array(z.string()).optional().describe(
    "Optional tags filter. Only memories containing all specified tags are returned.",
  ),
  format: z.enum(["markdown", "json", "both"]).optional().default("both").describe(
    "Optional output format. 'markdown' returns a table, 'json' returns raw JSON data, 'both' (default) returns multi-block content.",
  ),
});

export function formatMemoryListMarkdown(memories: MemorySummary[]): string {
  if (memories.length === 0) {
    return "## 🧠 Memories\n\n*No memories found matching the specified filters.*";
  }

  let md = `## 🧠 Memories (${memories.length})\n\n`;
  md += `| Key | Scope | Target | Summary | Access Count | Last Accessed |\n`;
  md += `| :--- | :--- | :--- | :--- | :--- | :--- |\n`;

  for (const m of memories) {
    let target = "-";
    if (m.scope === "workflow") {
      target = m.workflowId ? `\`${m.workflowId}\`` : "workflow";
    } else if (m.scope === "node") {
      target = `\`${m.workflowId ?? "_"}:${m.nodeId}\``;
    } else if (m.scope === "role") {
      target = m.roleId ? `\`${m.roleId}\`` : "role";
    }

    const lastAccess = m.lastAccessed ? m.lastAccessed.slice(0, 19).replace("T", " ") : "*never*";
    const summarySanitized = m.summary.replace(/\|/g, "/");
    const count = m.accessCount ?? 0;

    md +=
      `| **${m.key}** | \`${m.scope}\` | ${target} | ${summarySanitized} | ${count} | ${lastAccess} |\n`;
  }

  return md;
}

export const memoryListTool = defineTool({
  name: "memory_list",
  description:
    "Lists memory summaries matching filters (workflow, node, role, tags). IMPORTANT: Returns short summaries only (no full content). Each summary includes key, summary, lastAccessed timestamp, and accessCount.",
  schema: MemoryListSchema,
  execute: async ({
    workflow,
    workflowId: workflowIdArg,
    node,
    nodeId: nodeIdArg,
    role,
    roleId: roleIdArg,
    scope,
    tags,
    format,
  }) => {
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

    const summaries = await listMemories({
      workflowId,
      nodeId,
      roleId,
      scope: scope as MemoryScope | undefined,
      tags,
    });

    const markdown = formatMemoryListMarkdown(summaries);

    return richResponse({
      data: {
        memories: summaries,
        count: summaries.length,
      },
      markdown,
      format,
    });
  },
});
