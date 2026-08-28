import { z } from "zod";
import { getDependencies, listTasks } from "../../store/kv.ts";
import { createErrorResponse, defineTool, jsonResponse } from "../helpers.ts";
import { resolveTask } from "./task_helpers.ts";

const TaskGetSchema = z.object({
  task: z.string().min(1).optional().describe(
    "The unique task ID (e.g. 'tk-a1b2c3'), exact title, or slug of the task to retrieve.",
  ),
  taskId: z.string().min(1).optional().describe(
    "Alias for 'task'.",
  ),
  includeDependencies: z.boolean().optional().default(false).describe(
    "Optional. When true, retrieves blocking and blocked-by dependencies.",
  ),
  includeChildren: z.boolean().optional().default(false).describe(
    "Optional. When true, retrieves child subtasks.",
  ),
}).refine((data) => data.task || data.taskId, {
  message: "Task ('task' or 'taskId') must be provided.",
});

export const getTaskTool = defineTool({
  name: "task_get",
  description:
    "Retrieves full details for a task by its ID, title, or slug. Optionally includes directional dependencies (blocking and blocked-by) and child subtasks.",
  schema: TaskGetSchema,
  execute: async ({ task, taskId, includeDependencies, includeChildren }) => {
    const identifier = (taskId ?? task)!.trim();
    const resolved = await resolveTask(identifier);
    if (!resolved) {
      return createErrorResponse(
        `Task "${identifier}" not found. You can specify a task ID (e.g. "tk-a1b2c3") or exact title.`,
      );
    }

    const result: Record<string, unknown> = { task: resolved };

    if (includeDependencies) {
      const [blocking, blockedBy] = await Promise.all([
        getDependencies(resolved.id, "blocking"),
        getDependencies(resolved.id, "blocked-by"),
      ]);
      result.dependencies = {
        blocking,
        blockedBy,
      };
    }

    if (includeChildren) {
      const children = await listTasks({ parentTaskId: resolved.id });
      result.children = children;
    }

    return jsonResponse(result);
  },
});
