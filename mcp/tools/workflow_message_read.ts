import { z } from "zod";
import { getExecution, listMessages } from "../../store/kv.ts";
import {
  createErrorResponse,
  defineTool,
  jsonResponse,
} from "../helpers.ts";

const WorkflowMessageReadSchema = z.object({
  executionId: z.string().min(1).describe(
    "The unique identifier of the workflow execution whose message board to read.",
  ),
  taskId: z.string().optional().describe(
    "Filter messages associated with a specific task ID.",
  ),
  nodeId: z.string().optional().describe(
    "Filter messages associated with a specific node ID.",
  ),
  role: z.string().optional().describe(
    "Filter messages posted by a specific role.",
  ),
  topic: z.string().optional().describe(
    "Filter messages by topic (e.g. 'review_feedback', 'blocker', 'child_completion').",
  ),
  includeSubworkflows: z.boolean().default(false).describe(
    "When true, aggregates messages from child subworkflow executions linked to this execution.",
  ),
  limit: z.number().optional().describe(
    "Maximum number of messages to return.",
  ),
});

export const workflowMessageReadTool = defineTool({
  name: "workflow_message_read",
  description:
    "Reads chronological messages from a workflow execution's message board with multi-level filtering by task, node, role, and topic, and optional subworkflow message aggregation.",
  schema: WorkflowMessageReadSchema,
  execute: async ({
    executionId,
    taskId,
    nodeId,
    role,
    topic,
    includeSubworkflows,
    limit,
  }) => {
    const execution = await getExecution(executionId);
    if (!execution) {
      return createErrorResponse(`Execution "${executionId}" not found.`);
    }

    const messages = await listMessages(executionId, {
      taskId,
      nodeId,
      role,
      topic,
      includeSubworkflows,
      limit,
    });

    return jsonResponse({
      executionId,
      workflowId: execution.workflowId,
      count: messages.length,
      messages,
    });
  },
});
