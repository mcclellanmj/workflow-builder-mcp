import { z } from "zod";
import { claimTask } from "../../store/kv.ts";
import { createErrorResponse, defineTool, jsonResponse } from "../helpers.ts";
import { resolveTask } from "./task_helpers.ts";

const TaskClaimSchema = z.object({
  task: z.string().min(1).optional().describe(
    "The unique task ID (e.g. 'tk-a1b2c3'), exact title, or slug of the task to claim.",
  ),
  taskId: z.string().min(1).optional().describe(
    "Alias for 'task'.",
  ),
  assignee: z.string().min(1).describe(
    "Identifier of the agent, subagent, or user claiming this task (e.g. 'frontend-agent-1', 'user-matt').",
  ),
}).refine((data) => data.task || data.taskId, {
  message: "Task ('task' or 'taskId') must be provided.",
});

export const claimTaskTool = defineTool({
  name: "task_claim",
  description:
    "Atomically claims a task for an assignee using optimistic check-and-set concurrency control. Prevents duplicate work across multiple concurrent agents.",
  schema: TaskClaimSchema,
  execute: async ({ task, taskId, assignee }) => {
    const identifier = (taskId ?? task)!.trim();
    const resolved = await resolveTask(identifier);
    if (!resolved) {
      return createErrorResponse(
        `Task "${identifier}" not found. You can specify a task ID (e.g. "tk-a1b2c3") or exact title.`,
      );
    }

    const claimed = await claimTask(resolved.id, assignee);

    return jsonResponse({
      task: claimed,
      instructions:
        `Task claimed successfully by '${assignee}'. Run 'context_prime({ taskId: "${claimed.id}" })' to bootstrap working context, memories, and predecessor handoff notes before beginning work.`,
    });
  },
});
