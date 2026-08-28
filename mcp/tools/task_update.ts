import { z } from "zod";
import { updateTask } from "../../store/kv.ts";
import type { TaskPriority, TaskStatus } from "../../store/types.ts";
import { createErrorResponse, defineTool, jsonResponse } from "../helpers.ts";
import { resolveTask } from "./task_helpers.ts";

const TaskUpdateSchema = z.object({
  task: z.string().min(1).optional().describe(
    "The unique task ID (e.g. 'tk-a1b2c3'), exact title, or slug of the task to update.",
  ),
  taskId: z.string().min(1).optional().describe(
    "Alias for 'task'.",
  ),
  title: z.string().min(1).optional().describe("Optional new title."),
  description: z.string().optional().describe("Optional new description."),
  status: z.enum([
    "open",
    "claimed",
    "in_progress",
    "blocked",
    "review",
    "closed",
    "wontfix",
  ]).optional().describe("Optional new status."),
  priority: z.enum(["critical", "high", "medium", "low"]).optional().describe(
    "Optional new priority level.",
  ),
  role: z.string().optional().describe("Optional new role assignment."),
  context: z.string().optional().describe(
    "Optional context note to append to the task's working context.",
  ),
}).refine((data) => data.task || data.taskId, {
  message: "Task ('task' or 'taskId') must be provided.",
});

export const updateTaskTool = defineTool({
  name: "task_update",
  description:
    "Updates an existing task's title, description, status, priority, role, or context. Appends to existing context if provided.",
  schema: TaskUpdateSchema,
  execute: async ({
    task,
    taskId,
    title,
    description,
    status,
    priority,
    role,
    context,
  }) => {
    const identifier = (taskId ?? task)!.trim();
    const resolved = await resolveTask(identifier);
    if (!resolved) {
      return createErrorResponse(
        `Task "${identifier}" not found. You can specify a task ID (e.g. "tk-a1b2c3") or exact title.`,
      );
    }

    const updates: Record<string, unknown> = {};
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (status !== undefined) updates.status = status as TaskStatus;
    if (priority !== undefined) updates.priority = priority as TaskPriority;
    if (role !== undefined) updates.role = role;

    if (context !== undefined) {
      const trimmedContext = context.trim();
      if (trimmedContext) {
        updates.context = resolved.context
          ? `${resolved.context}\n${trimmedContext}`
          : trimmedContext;
      }
    }

    const updated = await updateTask(resolved.id, updates);

    return jsonResponse({ task: updated });
  },
});
