import { z } from "zod";
import { recallMemory } from "../../store/kv.ts";
import type { MemoryScope } from "../../store/types.ts";
import {
  createErrorResponse,
  defineTool,
  jsonResponse,
  resolveNodeInWorkflow,
  resolveWorkflow,
} from "../helpers.ts";

const MemoryRecallSchema = z.object({
  key: z.string().min(1).describe("The lookup key of the memory to recall."),
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
  accessedBy: z.string().optional().describe(
    "Agent ID, role, or user recalling the memory (logged for access audit).",
  ),
  executionId: z.string().optional().describe(
    "Active workflow execution ID associated with this recall.",
  ),
  taskId: z.string().optional().describe(
    "Active task ID associated with this recall.",
  ),
});

export const memoryRecallTool = defineTool({
  name: "memory_recall",
  description:
    "Recalls full content of a persistent memory by key. Automatically logs the access event into MemoryAccessRecord for audit and liveness tracking.",
  schema: MemoryRecallSchema,
  execute: async ({
    key,
    scope,
    workflow,
    workflowId: workflowIdArg,
    node,
    nodeId: nodeIdArg,
    role,
    roleId: roleIdArg,
    accessedBy,
    executionId,
    taskId,
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

    const memory = await recallMemory({
      key,
      scope: scope as MemoryScope | undefined,
      workflowId,
      nodeId,
      roleId,
      accessedBy,
      executionId,
      taskId,
    });

    if (!memory) {
      return createErrorResponse(
        `Memory with key "${key}" not found${scope ? ` in scope "${scope}"` : ""}.`,
      );
    }

    return jsonResponse({
      memory,
      accessLogged: true,
      accessedBy: accessedBy ?? null,
      executionId: executionId ?? null,
      taskId: taskId ?? null,
    });
  },
});
