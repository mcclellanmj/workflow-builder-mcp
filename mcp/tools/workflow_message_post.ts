import { z } from "zod";
import { getExecution, postMessage } from "../../store/kv.ts";
import {
  createErrorResponse,
  defineTool,
  jsonResponse,
} from "../helpers.ts";

const WorkflowMessagePostSchema = z.object({
  executionId: z.string().min(1).describe(
    "The unique identifier of the workflow execution whose message board to post to.",
  ),
  content: z.string().min(1).describe(
    "The content of the message.",
  ),
  author: z.string().min(1).describe(
    "Identifier of the message author (agent name or user).",
  ),
  role: z.string().optional().describe(
    "Role of the author (e.g. 'developer', 'reviewer', 'qa-engineer', 'orchestrator').",
  ),
  taskId: z.string().optional().describe(
    "Optional task ID to associate with this message for task-scoped filtering.",
  ),
  nodeId: z.string().optional().describe(
    "Optional node ID to associate with this message for step-scoped filtering.",
  ),
  topic: z.string().optional().describe(
    "Optional topic category (e.g. 'review_feedback', 'blocker', 'status', 'architecture').",
  ),
});

export const workflowMessagePostTool = defineTool({
  name: "workflow_message_post",
  description:
    "Posts a message to a workflow execution's message board, optionally tagging a task, step node, role, and topic for synchronized agent communication.",
  schema: WorkflowMessagePostSchema,
  execute: async ({
    executionId,
    content,
    author,
    role,
    taskId,
    nodeId,
    topic,
  }) => {
    const execution = await getExecution(executionId);
    if (!execution) {
      return createErrorResponse(`Execution "${executionId}" not found.`);
    }

    const message = await postMessage({
      id: crypto.randomUUID(),
      executionId,
      workflowId: execution.workflowId,
      content,
      author,
      role,
      taskId,
      nodeId,
      topic,
      createdAt: new Date().toISOString(),
    });

    return jsonResponse({
      message,
    });
  },
});
