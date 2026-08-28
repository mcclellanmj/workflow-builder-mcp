import { z } from "zod";
import { saveMemory } from "../../store/kv.ts";
import type { MemoryScope } from "../../store/types.ts";
import {
  createErrorResponse,
  defineTool,
  jsonResponse,
  resolveNodeInWorkflow,
  resolveWorkflow,
} from "../helpers.ts";

const MemorySaveSchema = z.object({
  key: z.string().min(1).describe("Lookup key, e.g. auth-pattern, edge-case-notes"),
  summary: z.string().min(1).describe("Short one-line description shown in memory_list"),
  content: z.string().min(1).describe("Full content of the memory"),
  scope: z.enum(["workflow", "node", "role"]).describe(
    "Scope level: 'workflow', 'node', or 'role'",
  ),
  workflow: z.string().min(1).optional().describe(
    "Workflow ID, name, or slug (required if scope is 'workflow' or 'node')",
  ),
  workflowId: z.string().min(1).optional().describe(
    "Alias for 'workflow'",
  ),
  node: z.string().min(1).optional().describe(
    "Node ID, name, or slug (required if scope is 'node')",
  ),
  nodeId: z.string().min(1).optional().describe(
    "Alias for 'node'",
  ),
  role: z.string().min(1).optional().describe(
    "Role name or ID (required if scope is 'role')",
  ),
  roleId: z.string().min(1).optional().describe(
    "Alias for 'role'",
  ),
  source: z.string().optional().describe(
    "Optional author, agent, or tool that recorded this memory",
  ),
  tags: z.array(z.string()).optional().describe(
    "Optional tags for categorization and search",
  ),
}).refine(
  (data) => {
    if (data.scope === "workflow" || data.scope === "node") {
      return Boolean(data.workflow || data.workflowId);
    }
    return true;
  },
  {
    message:
      "Workflow ('workflow' or 'workflowId') is required when scope is 'workflow' or 'node'.",
    path: ["workflowId"],
  },
).refine(
  (data) => {
    if (data.scope === "node") {
      return Boolean(data.node || data.nodeId);
    }
    return true;
  },
  {
    message: "Node ('node' or 'nodeId') is required when scope is 'node'.",
    path: ["nodeId"],
  },
).refine(
  (data) => {
    if (data.scope === "role") {
      return Boolean(data.role || data.roleId);
    }
    return true;
  },
  {
    message: "Role ('role' or 'roleId') is required when scope is 'role'.",
    path: ["roleId"],
  },
);

export const memorySaveTool = defineTool({
  name: "memory_save",
  description:
    "Saves or updates a persistent memory entry scoped to a workflow, node, or role. If a memory with the same key exists in the specified scope, it updates the existing entry (upsert behavior).",
  schema: MemorySaveSchema,
  execute: async ({
    key,
    summary,
    content,
    scope,
    workflow,
    workflowId: workflowIdArg,
    node,
    nodeId: nodeIdArg,
    role,
    roleId: roleIdArg,
    source,
    tags,
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

    if ((scope === "workflow" || scope === "node") && !workflowId) {
      return createErrorResponse(
        "Workflow ('workflow' or 'workflowId') is required when scope is 'workflow' or 'node'.",
      );
    }
    if (scope === "node" && !nodeId) {
      return createErrorResponse(
        "Node ('node' or 'nodeId') is required when scope is 'node'.",
      );
    }
    if (scope === "role" && !roleId) {
      return createErrorResponse(
        "Role ('role' or 'roleId') is required when scope is 'role'.",
      );
    }

    const result = await saveMemory({
      key,
      summary,
      content,
      scope: scope as MemoryScope,
      workflowId: scope === "workflow" || scope === "node" ? workflowId : undefined,
      nodeId: scope === "node" ? nodeId : undefined,
      roleId: scope === "role" ? roleId : undefined,
      source,
      tags,
    });

    return jsonResponse({
      memory: result.memory,
      created: result.created,
      action: result.created ? "created" : "updated",
    });
  },
});
