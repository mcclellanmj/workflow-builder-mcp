import { z } from "zod";
import { getTask, recordHandoff } from "../../store/kv.ts";
import { createErrorResponse, defineTool, jsonResponse } from "../helpers.ts";
import { resolveTask } from "./task_helpers.ts";

const TaskHandoffSchema = z.object({
  taskId: z.string().min(1).describe("The task ID to hand off."),
  action: z.enum(["advance", "reject", "escalate"]).describe(
    "Handoff action ('advance', 'reject', 'escalate').",
  ),
  toRole: z.string().min(1).describe(
    "Target role to hand off the task to (e.g. 'reviewer', 'qa', 'developer').",
  ),
  toAssignee: z.string().optional().describe(
    "Optional specific agent or user to assign the task to.",
  ),
  reason: z.string().min(1).describe(
    "The reason for the handoff (e.g. implementation ready, review rejected, blocked).",
  ),
  contextSummary: z.string().describe(
    "Summary of progress, decisions, and current state to preserve for the next agent.",
  ),
  feedback: z.array(z.string()).optional().describe(
    "Optional list of feedback items or defects (especially on reject).",
  ),
  rejectedApproaches: z.array(z.string()).optional().describe(
    "Optional list of approaches that failed or were rejected to avoid repeating mistakes.",
  ),
});

export const taskHandoffTool = defineTool({
  name: "task_handoff",
  description:
    "Transfers a task between roles or agents (advance, reject, escalate) while preserving accumulated context, feedback, and rejected approaches. On rejection, increments rejectionCount and moves task back to open.",
  schema: TaskHandoffSchema,
  execute: async ({
    taskId,
    action,
    toRole,
    toAssignee,
    reason,
    contextSummary,
    feedback,
    rejectedApproaches,
  }) => {
    const existingTask = await resolveTask(taskId);
    if (!existingTask) {
      return createErrorResponse(`Task not found: ${taskId}`);
    }

    const handoffRecord = await recordHandoff({
      taskId: existingTask.id,
      action,
      fromAssignee: existingTask.assignee || existingTask.role || "unknown",
      fromRole: existingTask.role,
      toRole,
      toAssignee,
      reason,
      contextSummary,
      feedback,
      rejectedApproaches,
    });

    const updatedTask = await getTask(existingTask.id);

    return jsonResponse({
      task: updatedTask ?? existingTask,
      handoffRecord,
    });
  },
});
