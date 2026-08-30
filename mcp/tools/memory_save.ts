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
  key: z.string().min(1).describe(
    "Lookup key for the memory entry, e.g. 'auth-pattern', 'edge-case-notes', 'architecture-decision'",
  ),
  summary: z.string().min(1).describe(
    "Short one-line description or title of the memory shown in memory_list",
  ),
  content: z.string().min(1).describe(
    "Full detailed content/body of the memory to persist and recall later",
  ),
  scope: z.enum(["workflow", "node", "role"]).describe(
    "Scope level: 'workflow' (shared across workflow), 'node' (specific to a node), or 'role' (specific to a role)",
  ),
  roleId: z.string().min(1).optional().describe(
    "Role identifier (e.g. 'unity-gameplay-engineer', 'developer', 'qa-engineer'). Required when scope is 'role'.",
  ),
  role: z.string().min(1).optional().describe(
    "Alias for 'roleId'. Role name or identifier.",
  ),
  workflowId: z.string().min(1).optional().describe(
    "Workflow UUID, name, or slug. Required when scope is 'workflow' or 'node'.",
  ),
  workflow: z.string().min(1).optional().describe(
    "Alias for 'workflowId'. Workflow UUID, name, or slug.",
  ),
  nodeId: z.string().min(1).optional().describe(
    "Node UUID, name, or slug. Required when scope is 'node'.",
  ),
  node: z.string().min(1).optional().describe(
    "Alias for 'nodeId'. Node UUID, name, or slug.",
  ),
  scopeId: z.string().min(1).optional().describe(
    "Generic scope target identifier alias. Automatically maps to 'roleId' (when scope is 'role'), 'workflowId' (when scope is 'workflow'), or 'nodeId' (when scope is 'node').",
  ),
  source: z.string().optional().describe(
    "Optional author, agent, or tool identifier that recorded this memory",
  ),
  tags: z.array(z.string()).optional().describe(
    "Optional array of string tags for categorization, filtering, and search",
  ),
}).refine(
  (data) => {
    if (data.scope === "workflow" || data.scope === "node") {
      return Boolean(data.workflowId || data.workflow || (data.scope === "workflow" && data.scopeId));
    }
    return true;
  },
  {
    message:
      "Workflow ('workflowId', 'workflow', or 'scopeId') is required when scope is 'workflow' or 'node'.",
    path: ["workflowId"],
  },
).refine(
  (data) => {
    if (data.scope === "node") {
      return Boolean(data.nodeId || data.node || data.scopeId);
    }
    return true;
  },
  {
    message: "Node ('nodeId', 'node', or 'scopeId') is required when scope is 'node'.",
    path: ["nodeId"],
  },
).refine(
  (data) => {
    if (data.scope === "role") {
      return Boolean(data.roleId || data.role || data.scopeId);
    }
    return true;
  },
  {
    message: "Role ('roleId', 'role', or 'scopeId') is required when scope is 'role'.",
    path: ["roleId"],
  },
);

export const memorySaveTool = defineTool({
  name: "memory_save",
  description:
    "Saves or updates a memory entry. When scope is 'role', you MUST provide 'roleId' (e.g. 'unity-gameplay-engineer'). When scope is 'workflow', provide 'workflowId'. When scope is 'node', provide 'nodeId'. If a memory with the same key exists in the specified scope, it updates the existing entry (upsert behavior).",
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
    scopeId,
    source,
    tags,
  }) => {
    let workflowId = workflowIdArg ?? workflow ?? (scope === "workflow" ? scopeId : undefined);
    if (workflowId) {
      const resolved = await resolveWorkflow(workflowId);
      if (resolved) workflowId = resolved.id;
    }

    let nodeId = nodeIdArg ?? node ?? (scope === "node" ? scopeId : undefined);
    if (nodeId && workflowId) {
      const resolvedNode = await resolveNodeInWorkflow(workflowId, nodeId);
      if (resolvedNode) nodeId = resolvedNode.id;
    }

    const roleId = (roleIdArg ?? role ?? (scope === "role" ? scopeId : undefined))?.trim();

    if ((scope === "workflow" || scope === "node") && !workflowId) {
      return createErrorResponse(
        "Workflow ('workflowId', 'workflow', or 'scopeId') is required when scope is 'workflow' or 'node'.",
      );
    }
    if (scope === "node" && !nodeId) {
      return createErrorResponse(
        "Node ('nodeId', 'node', or 'scopeId') is required when scope is 'node'.",
      );
    }
    if (scope === "role" && !roleId) {
      return createErrorResponse(
        "Role ('roleId', 'role', or 'scopeId') is required when scope is 'role'.",
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
