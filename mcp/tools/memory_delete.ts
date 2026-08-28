import { z } from "zod";
import { deleteMemory } from "../../store/kv.ts";
import type { MemoryScope } from "../../store/types.ts";
import { defineTool, jsonResponse, resolveNodeInWorkflow, resolveWorkflow } from "../helpers.ts";

const MemoryDeleteSchema = z.object({
  key: z.string().min(1).describe("The lookup key of the memory to delete."),
  scope: z.enum(["workflow", "node", "role"]).optional().describe(
    "Optional scope level to disambiguate keys across scopes.",
  ),
  workflow: z.string().min(1).optional().describe(
    "Workflow UUID, name, or slug (if workflow- or node-scoped).",
  ),
  workflowId: z.string().min(1).optional().describe(
    "Alias for 'workflow'.",
  ),
  node: z.string().min(1).optional().describe(
    "Node UUID, name, or slug (if node-scoped).",
  ),
  nodeId: z.string().min(1).optional().describe(
    "Alias for 'node'.",
  ),
  role: z.string().min(1).optional().describe(
    "Role name or ID (if role-scoped).",
  ),
  roleId: z.string().min(1).optional().describe(
    "Alias for 'role'.",
  ),
});

export const memoryDeleteTool = defineTool({
  name: "memory_delete",
  description:
    "Deletes a persistent memory and all associated indexes and access records. Returns whether the memory was deleted and the total accessCount prior to deletion.",
  schema: MemoryDeleteSchema,
  execute: async ({
    key,
    scope,
    workflow,
    workflowId: workflowIdArg,
    node,
    nodeId: nodeIdArg,
    role,
    roleId: roleIdArg,
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

    const result = await deleteMemory({
      key,
      scope: scope as MemoryScope | undefined,
      workflowId,
      nodeId,
      roleId,
    });

    return jsonResponse({
      deleted: result.deleted,
      accessCount: result.accessCount,
      key,
      message: result.deleted
        ? `Memory "${key}" deleted successfully (prior access count: ${result.accessCount}).`
        : `Memory "${key}" was not found.`,
    });
  },
});
