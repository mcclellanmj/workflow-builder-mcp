import { z } from "zod";
import { overrideTaskPipeline } from "../../store/kv.ts";
import { createErrorResponse, defineTool, jsonResponse } from "../helpers.ts";
import { resolveTask } from "./task_helpers.ts";

const InsertStageSchema = z.object({
  id: z.string().min(1).describe("Unique identifier for the new stage."),
  name: z.string().min(1).describe("Human-readable name for the new stage."),
  role: z.string().min(1).describe("Role assigned to this stage."),
  description: z.string().optional().describe("Description and instructions for this stage."),
  allowedTransitions: z.array(z.object({
    targetStageId: z.string().min(1).describe("Target stage ID."),
    action: z.enum(["advance", "reject", "escalate", "delegate"]).describe("Transition action."),
    allowedRoles: z.array(z.string()).optional(),
    requiresReviewApproval: z.boolean().optional(),
  })).optional().default([]),
  requiredFields: z.array(z.string()).optional(),
  validationRules: z.object({
    minCommentLength: z.number().optional(),
    requireStructuredHandoff: z.boolean().optional(),
    requireRejectedApproachesOnReject: z.boolean().optional(),
    customGuards: z.array(z.string()).optional(),
  }).optional(),
  position: z.enum(["before_current", "after_current", "at_index"]).optional().default(
    "after_current",
  ).describe(
    "Position to insert the stage relative to the active stage ('before_current', 'after_current', 'at_index').",
  ),
  index: z.number().int().optional().describe("Specific index if position is 'at_index'."),
});

const TaskPipelineOverrideSchema = z.object({
  task: z.string().min(1).optional().describe("The task ID, exact title, or slug to override."),
  taskId: z.string().min(1).optional().describe("Alias for 'task'."),
  action: z.enum([
    "force_advance",
    "skip_stage",
    "insert_stage",
    "reset_rejections",
    "emergency_override",
  ]).optional()
    .describe(
      "Type of override intervention: 'force_advance', 'skip_stage', 'insert_stage', 'reset_rejections', or 'emergency_override'.",
    ),
  targetStageId: z.string().optional().describe("Target stage ID to transition or jump to."),
  targetStageIndex: z.number().int().optional().describe(
    "Target stage index to transition or jump to.",
  ),
  skipCurrentStage: z.boolean().optional().describe("Whether to mark current stage as 'skipped'."),
  resetRejectionCount: z.boolean().optional().describe(
    "Whether to reset rejection counter to 0 (un-tripping circuit breaker).",
  ),
  insertStage: InsertStageSchema.optional().describe(
    "Stage definition to dynamically insert into the active pipeline.",
  ),
  justification: z.string().min(1).describe(
    "Mandatory manager justification / audit note for the override.",
  ),
  managerId: z.string().optional().describe("Identifier of manager executing the override."),
}).refine((data) => data.task || data.taskId, {
  message: "Either 'task' or 'taskId' must be provided.",
});

export const taskPipelineOverrideTool = defineTool({
  name: "task_pipeline_override",
  description:
    "Executes emergency manager pipeline interventions: force stage advancement, skip stages, dynamically insert stages, and reset rejection circuit breakers.",
  schema: TaskPipelineOverrideSchema,
  execute: async ({
    task,
    taskId,
    action,
    targetStageId,
    targetStageIndex,
    skipCurrentStage,
    resetRejectionCount,
    insertStage,
    justification,
    managerId,
  }) => {
    const identifier = (taskId ?? task)!.trim();
    const resolved = await resolveTask(identifier);
    if (!resolved) {
      return createErrorResponse(
        `Task "${identifier}" not found. Specify a valid task ID or title.`,
      );
    }
    if (!resolved.pipeline) {
      return createErrorResponse(
        `Task '${resolved.id}' is not managed by a pipeline. Attach a pipeline first using 'task_pipeline_attach'.`,
      );
    }

    const updatedTask = await overrideTaskPipeline(resolved.id, {
      action,
      targetStageId,
      targetStageIndex,
      skipCurrentStage,
      resetRejectionCount,
      insertStage,
      justification,
      managerId,
    });

    const activeStage = updatedTask.pipeline?.stages[updatedTask.pipeline.currentStageIndex ?? 0];
    const latestAudit = updatedTask.pipeline?.history
      ?.[(updatedTask.pipeline?.history?.length ?? 1) - 1];

    return jsonResponse({
      task: updatedTask,
      activeStage,
      latestAuditRecord: latestAudit,
      message:
        `Successfully executed pipeline override on task '${updatedTask.id}' (active stage: ${
          activeStage?.name ?? activeStage?.id
        }, role: ${updatedTask.role}).`,
    });
  },
});
