import { z } from "zod";
import { addTaskComment, getTask } from "../../store/kv.ts";
import { createErrorResponse, defineTool, jsonResponse } from "../helpers.ts";
import { resolveTask } from "./task_helpers.ts";

const TaskCommentSchema = z.object({
  task: z.string().min(1).optional().describe(
    "The unique task ID (e.g. 'tk-a1b2c3'), exact title, or slug of the task to comment on.",
  ),
  taskId: z.string().min(1).optional().describe(
    "Alias for 'task'.",
  ),
  comment: z.string().min(1).max(256).optional().describe(
    "The short comment content (maximum 256 characters).",
  ),
  content: z.string().min(1).max(256).optional().describe(
    "Alias for 'comment' (maximum 256 characters).",
  ),
  author: z.string().min(1).optional().describe(
    "Optional author name or identifier (e.g. 'agent-1', 'alice', 'reviewer'). Defaults to 'anonymous' or active caller.",
  ),
}).refine((data) => data.task || data.taskId, {
  message: "Task ('task' or 'taskId') must be provided.",
}).refine((data) => data.comment || data.content, {
  message: "Comment content ('comment' or 'content') must be provided.",
});

export const commentTaskTool = defineTool({
  name: "task_comment",
  description:
    "Adds a short comment (maximum 256 characters) to a task's comment log for quick updates, status notes, or reviewer feedback.",
  schema: TaskCommentSchema,
  execute: async ({ task, taskId, comment, content, author }) => {
    const identifier = (taskId ?? task)!.trim();
    const text = (comment ?? content)!.trim();

    if (text.length > 256) {
      return createErrorResponse(
        `Comment exceeds maximum length of 256 characters (received ${text.length} characters). Keep comments short and sweet.`,
      );
    }

    const resolved = await resolveTask(identifier);
    if (!resolved) {
      return createErrorResponse(
        `Task "${identifier}" not found. You can specify a task ID (e.g. "tk-a1b2c3") or exact title.`,
      );
    }

    try {
      const createdComment = await addTaskComment(resolved.id, {
        author: author || "agent",
        content: text,
      });

      const updatedTask = await getTask(resolved.id);

      return jsonResponse({
        comment: createdComment,
        task: updatedTask,
        message: `Comment logged on task ${resolved.id} (${text.length}/256 chars).`,
      });
    } catch (err) {
      return createErrorResponse(err instanceof Error ? err.message : String(err));
    }
  },
});
