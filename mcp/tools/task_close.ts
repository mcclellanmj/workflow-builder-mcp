import { z } from "zod";
import { closeTask } from "../../store/kv.ts";
import { createErrorResponse, defineTool, jsonResponse } from "../helpers.ts";
import { resolveTask } from "./task_helpers.ts";

const TaskCloseSchema = z.object({
  task: z.string().min(1).optional().describe(
    "The unique task ID (e.g. 'tk-a1b2c3'), exact title, or slug of the task to close.",
  ),
  taskId: z.string().min(1).optional().describe(
    "Alias for 'task'.",
  ),
  reason: z.string().optional().describe(
    "Optional explanation or resolution summary for closing the task.",
  ),
}).refine((data) => data.task || data.taskId, {
  message: "Task ('task' or 'taskId') must be provided.",
});

export const closeTaskTool = defineTool({
  name: "task_close",
  description:
    "Marks a task as completed/closed, records an optional close reason, and re-evaluates all dependent tasks. Automatically unblocks downstream tasks whose prerequisites are all satisfied.",
  schema: TaskCloseSchema,
  execute: async ({ task, taskId, reason }) => {
    const identifier = (taskId ?? task)!.trim();
    const resolved = await resolveTask(identifier);
    if (!resolved) {
      return createErrorResponse(
        `Task "${identifier}" not found. You can specify a task ID (e.g. "tk-a1b2c3") or exact title.`,
      );
    }

    const { task: closedTask, unblockedTasks } = await closeTask(resolved.id, reason);

    return jsonResponse({
      task: closedTask,
      unblockedTasks,
    });
  },
});
