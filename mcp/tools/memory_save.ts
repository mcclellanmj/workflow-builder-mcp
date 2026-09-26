import { z } from "zod";
import { saveMemory } from "../../store/kv.ts";
import {
  defineTool,
  jsonResponse,
  resolveNodeInWorkflow,
  resolveWorkflow,
} from "../helpers.ts";

const MemorySaveSchema = z.object({
  workflowId: z.string().min(1).describe(
    "Workflow UUID, name, or slug to associate this memory with (required).",
  ),
  nodeId: z.string().min(1).optional().describe(
    "Optional node UUID, name, or slug to anchor this memory to a specific workflow step.",
  ),
  taskId: z.string().min(1).optional().describe(
    "Optional task ID to anchor this memory to a specific task.",
  ),
  key: z.string().min(1).describe(
    "Lookup key for the memory entry (e.g. 'architecture-decision', 'contract-spec', 'auth-pattern').",
  ),
  summary: z.string().min(1).describe(
    "Short one-line description or title of the memory.",
  ),
  content: z.string().min(1).describe(
    "Full detailed content of the memory.",
  ),
  tags: z.array(z.string()).optional().default([]).describe(
    "Tags for categorization and search (e.g. ['architecture', 'api', 'backend']). Defaults to empty array.",
  ),
  source: z.string().optional().describe(
    "Optional author or role recording this memory.",
  ),
  roleId: z.string().optional().describe(
    "Optional role ID (for backward compatibility).",
  ),
  scopeId: z.string().optional().describe(
    "Optional scope ID alias (for backward compatibility).",
  ),
});

export const memorySaveTool = defineTool({
  name: "memory_save",
  description:
    "Saves or updates a memory entry within a workflow project. Memories can optionally be anchored to a specific node/step or task, and tagged for cross-cutting discovery. Upserts if key exists in the workflow.",
  schema: MemorySaveSchema,
  execute: async ({
    workflowId: workflowIdArg,
    nodeId: nodeIdArg,
    taskId,
    key,
    summary,
    content,
    tags = [],
    source,
  }) => {
    let workflowId = workflowIdArg;
    const resolved = await resolveWorkflow(workflowId);
    if (resolved) {
      workflowId = resolved.id;
    }

    let nodeId = nodeIdArg;
    if (nodeId && workflowId) {
      const resolvedNode = await resolveNodeInWorkflow(workflowId, nodeId);
      if (resolvedNode) {
        nodeId = resolvedNode.id;
      }
    }

    const result = await saveMemory({
      workflowId,
      nodeId,
      taskId,
      key,
      summary,
      content,
      tags,
      source,
    });

    return jsonResponse({
      memory: result.memory,
      created: result.created,
      action: result.created ? "created" : "updated",
    });
  },
});
