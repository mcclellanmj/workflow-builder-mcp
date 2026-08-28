import { z } from "zod";
import { recordHandoff, updateTask } from "../../store/kv.ts";
import type { Task } from "../../store/types.ts";
import { createErrorResponse, defineTool, jsonResponse } from "../helpers.ts";
import { resolveTask } from "./task_helpers.ts";

const TaskHandoffSchema = z.object({
  task: z.string().min(1).optional().describe("The task ID to hand off."),
  taskId: z.string().min(1).optional().describe("Alias for 'task'. The task ID to hand off."),
  reason: z.string().min(1).describe(
    "The reason for the handoff (e.g. shift change, domain specialization, escalation).",
  ),
  contextSummary: z.string().optional().describe(
    "Summary of progress, decisions, and current state to preserve for the next agent.",
  ),
  rejectedApproaches: z.array(z.string()).optional().describe(
    "List of approaches that failed or were rejected to avoid repeating mistakes.",
  ),
  toAssignee: z.string().optional().describe(
    "Specific agent or person to assign the task to. If omitted, assignee is cleared to release the task to a role queue.",
  ),
  toRole: z.string().optional().describe(
    "Optional role to reassign the task to (e.g. 'qa', 'security', 'frontend').",
  ),
}).refine((data) => data.task || data.taskId, {
  message: "Either 'task' or 'taskId' must be provided.",
});

export const taskHandoffTool = defineTool({
  name: "task_handoff",
  description:
    "Transfers a task between agents or roles while preserving accumulated context and rejected approaches. Updates ownership and creates an audit handoff record.",
  schema: TaskHandoffSchema,
  execute: async (
    { task, taskId, reason, contextSummary, rejectedApproaches, toAssignee, toRole },
  ) => {
    const targetTaskId = (task ?? taskId)!.trim();
    const existingTask = await resolveTask(targetTaskId);
    if (!existingTask) {
      return createErrorResponse(`Task not found: ${targetTaskId}`);
    }

    // 1. Context preservation: append contextSummary to task.context
    let newContext = existingTask.context;
    if (contextSummary && contextSummary.trim()) {
      newContext = existingTask.context && existingTask.context.trim()
        ? `${existingTask.context.trim()}\n\n${contextSummary.trim()}`
        : contextSummary.trim();
    }

    // 2. Append rejected approaches
    let newRejectedApproaches = existingTask.rejectedApproaches
      ? [...existingTask.rejectedApproaches]
      : [];
    if (rejectedApproaches && rejectedApproaches.length > 0) {
      newRejectedApproaches = [...newRejectedApproaches, ...rejectedApproaches];
    }

    // 3. Record handoff record
    const handoffRecord = await recordHandoff({
      taskId: existingTask.id,
      fromAssignee: existingTask.assignee || "unassigned",
      toAssignee: toAssignee ? toAssignee.trim() : undefined,
      toRole: toRole ? toRole.trim() : undefined,
      reason,
      contextSummary: contextSummary ?? "",
      rejectedApproaches: rejectedApproaches ?? [],
    });

    // 4. Update task
    const updates: Partial<Task> = {
      context: newContext,
      rejectedApproaches: newRejectedApproaches,
    };

    if (toAssignee && toAssignee.trim()) {
      updates.assignee = toAssignee.trim();
      updates.claimedAt = new Date().toISOString();
      updates.status = "claimed";
    } else {
      updates.assignee = undefined;
      updates.claimedAt = undefined;
      // Releasing to queue - if currently claimed or in_progress, transition to open
      if (existingTask.status === "claimed" || existingTask.status === "in_progress") {
        updates.status = "open";
      }
    }

    if (toRole && toRole.trim()) {
      updates.role = toRole.trim();
    }

    const updatedTask = await updateTask(existingTask.id, updates);

    return jsonResponse({
      task: updatedTask,
      handoffRecord,
    });
  },
});
