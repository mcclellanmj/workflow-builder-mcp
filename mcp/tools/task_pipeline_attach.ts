import { z } from "zod";
import { attachPipelineToTask } from "../../store/kv.ts";
import type { TaskPipeline } from "../../store/types.ts";
import { createErrorResponse, defineTool, jsonResponse } from "../helpers.ts";
import { resolveTask } from "./task_helpers.ts";

const TaskPipelineAttachSchema = z.object({
  task: z.string().min(1).optional().describe(
    "The unique task ID (e.g. 'tk-a1b2c3'), exact title, or slug of the task.",
  ),
  taskId: z.string().min(1).optional().describe("Alias for 'task'."),
  templateId: z.string().optional().describe(
    "FlowTemplate ID to instantiate and attach (e.g. 'unity-dev-playtest-qa', 'code-review-audit', 'hotfix-fast-track').",
  ),
  customPipeline: z.record(z.unknown()).optional().describe(
    "Optional custom TaskPipeline definition object to attach directly.",
  ),
  justification: z.string().optional().describe(
    "Optional manager justification or audit note for attaching the pipeline.",
  ),
}).refine((data) => data.task || data.taskId, {
  message: "Either 'task' or 'taskId' must be provided.",
}).refine((data) => data.templateId || data.customPipeline, {
  message: "Either 'templateId' or 'customPipeline' must be provided.",
});

export const taskPipelineAttachTool = defineTool({
  name: "task_pipeline_attach",
  description:
    "Attaches a workflow pipeline template or custom multi-stage pipeline to an existing task.",
  schema: TaskPipelineAttachSchema,
  execute: async ({ task, taskId, templateId, customPipeline, justification }) => {
    const identifier = (taskId ?? task)!.trim();
    const resolved = await resolveTask(identifier);
    if (!resolved) {
      return createErrorResponse(
        `Task "${identifier}" not found. Specify a valid task ID or title.`,
      );
    }

    const pipelineSource = templateId
      ? templateId.trim()
      : (customPipeline as unknown as TaskPipeline);
    const updatedTask = await attachPipelineToTask(
      resolved.id,
      pipelineSource,
      undefined,
      justification,
    );

    return jsonResponse({
      task: updatedTask,
      message: `Attached pipeline to task '${updatedTask.id}' (active stage: ${
        updatedTask.pipeline?.currentStageId ?? "none"
      }, role: ${updatedTask.role ?? "unassigned"}).`,
    });
  },
});
