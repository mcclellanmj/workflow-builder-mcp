import { z } from "zod";
import { handoffTask } from "../../store/kv.ts";
import { createErrorResponse, defineTool, jsonResponse } from "../helpers.ts";
import { resolveTask } from "./task_helpers.ts";

const TaskHandoffSchema = z.object({
  task: z.string().min(1).optional().describe("The task ID to hand off."),
  taskId: z.string().min(1).optional().describe("Alias for 'task'. The task ID to hand off."),
  action: z.enum(["advance", "reject", "escalate", "delegate"]).optional().describe(
    "Pipeline transition action ('advance', 'reject', 'escalate', 'delegate'). Defaults to 'advance'.",
  ),
  targetStageId: z.string().optional().describe(
    "Target pipeline stage ID for custom routing or rollback.",
  ),
  reason: z.string().min(1).describe(
    "The reason for the handoff or pipeline transition (e.g. stage complete, review rejected, shift change).",
  ),
  contextSummary: z.string().optional().describe(
    "Summary of progress, decisions, and current state to preserve for the next agent.",
  ),
  acceptanceNotes: z.union([z.string(), z.array(z.string())]).optional().describe(
    "Acceptance criteria met or notes from stage execution.",
  ),
  rejectionReasons: z.array(z.string()).optional().describe(
    "List of rejection reasons when action is 'reject'.",
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
  managerOverrideJustification: z.string().optional().describe(
    "Justification when performing a manager override transition.",
  ),
}).refine((data) => data.task || data.taskId, {
  message: "Either 'task' or 'taskId' must be provided.",
});

export const taskHandoffTool = defineTool({
  name: "task_handoff",
  description:
    "Transfers a task between agents or roles while preserving accumulated context and rejected approaches. Supports multi-stage pipeline advancement and rejection loops.",
  schema: TaskHandoffSchema,
  execute: async (
    {
      task,
      taskId,
      action,
      targetStageId,
      reason,
      contextSummary,
      acceptanceNotes,
      rejectionReasons,
      rejectedApproaches,
      toAssignee,
      toRole,
      managerOverrideJustification,
    },
  ) => {
    const targetTaskId = (task ?? taskId)!.trim();
    const existingTask = await resolveTask(targetTaskId);
    if (!existingTask) {
      return createErrorResponse(`Task not found: ${targetTaskId}`);
    }

    const result = await handoffTask({
      taskId: existingTask.id,
      action,
      targetStageId,
      fromAssignee: existingTask.assignee,
      toAssignee,
      toRole,
      reason,
      contextSummary,
      acceptanceNotes,
      rejectionReasons,
      rejectedApproaches,
      managerOverrideJustification,
    });

    return jsonResponse({
      task: result.task,
      handoffRecord: result.handoffRecord,
      auditRecord: result.auditRecord,
    });
  },
});
