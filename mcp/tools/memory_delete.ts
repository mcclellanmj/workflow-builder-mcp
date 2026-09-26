import { z } from "zod";
import { deleteMemory } from "../../store/kv.ts";
import { defineTool, jsonResponse, resolveNodeInWorkflow, resolveWorkflow } from "../helpers.ts";

const MemoryDeleteSchema = z.object({
  key: z.string().min(1).describe("The lookup key of the memory to delete."),
  workflow: z.string().min(1).optional().describe(
    "Workflow UUID, name, or slug to scope memory deletion.",
  ),
  workflowId: z.string().min(1).optional().describe(
    "Alias for 'workflow'.",
  ),
  node: z.string().min(1).optional().describe(
    "Optional node UUID, name, or slug to scope memory deletion.",
  ),
  nodeId: z.string().min(1).optional().describe(
    "Alias for 'node'.",
  ),
  taskId: z.string().min(1).optional().describe(
    "Optional task ID to scope memory deletion.",
  ),
  id: z.string().optional().describe(
    "Optional direct memory ID to delete.",
  ),
});

export const memoryDeleteTool = defineTool({
  name: "memory_delete",
  description:
    "Deletes a persistent memory and all associated indexes and access records. Returns whether the memory was deleted and the total accessCount prior to deletion.",
  schema: MemoryDeleteSchema,
  execute: async ({
    key,
    workflow,
    workflowId: workflowIdArg,
    node,
    nodeId: nodeIdArg,
    taskId,
    id,
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

    const result = await deleteMemory({
      id,
      key,
      workflowId,
      nodeId,
      taskId,
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
