import { z } from "zod";
import { recallMemory } from "../../store/kv.ts";
import {
  createErrorResponse,
  defineTool,
  jsonResponse,
  resolveNodeInWorkflow,
  resolveWorkflow,
} from "../helpers.ts";

const MemoryRecallSchema = z.object({
  key: z.string().min(1).describe("The lookup key of the memory to recall."),
  workflow: z.string().min(1).optional().describe(
    "Workflow UUID, name, or slug.",
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
  id: z.string().optional().describe(
    "Direct memory ID to recall.",
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
    "Recalls full content of a persistent memory by key or ID. Automatically logs the access event into MemoryAccessRecord for audit and liveness tracking.",
  schema: MemoryRecallSchema,
  execute: async ({
    key,
    workflow,
    workflowId: workflowIdArg,
    node,
    nodeId: nodeIdArg,
    id,
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

    const memory = await recallMemory({
      id,
      key,
      workflowId,
      nodeId,
      accessedBy,
      executionId,
      taskId,
    });

    if (!memory) {
      return createErrorResponse(
        `Memory with key "${key}" not found${workflowId ? ` in workflow "${workflowId}"` : ""}.`,
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
