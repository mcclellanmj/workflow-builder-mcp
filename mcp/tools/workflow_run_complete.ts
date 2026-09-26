import { z } from "zod";
import { completeExecution, getExecution } from "../../store/kv.ts";
import {
  createErrorResponse,
  defineTool,
  jsonResponse,
} from "../helpers.ts";

const WorkflowRunCompleteSchema = z.object({
  executionId: z.string().min(1).describe(
    "The unique identifier of the workflow execution to complete.",
  ),
  status: z.enum(["completed", "failed"]).default("completed").describe(
    "Final status of the workflow execution (completed or failed).",
  ),
  finalSummary: z.string().optional().describe(
    "Summary of deliverables, outcomes, or review results from this run.",
  ),
  error: z.string().optional().describe(
    "Error details if the execution failed.",
  ),
});

export const workflowRunCompleteTool = defineTool({
  name: "workflow_run_complete",
  description:
    "Completes a workflow execution run, sets its terminal status, bubbles summaries or defect notes to linked origin tasks, and releases waiting parent nodes when sibling tasks complete.",
  schema: WorkflowRunCompleteSchema,
  execute: async ({ executionId, status, finalSummary, error }) => {
    const existing = await getExecution(executionId);
    if (!existing) {
      return createErrorResponse(`Execution "${executionId}" not found.`);
    }

    const execution = await completeExecution(
      executionId,
      status,
      finalSummary,
      error,
    );

    return jsonResponse({
      executionId: execution.id,
      workflowId: execution.workflowId,
      status: execution.status,
      finalSummary: finalSummary ?? null,
      error: error ?? null,
      parentExecutionId: execution.parentExecutionId ?? null,
      originTaskId: execution.originTaskId ?? null,
      originNodeId: execution.originNodeId ?? null,
      execution,
    });
  },
});
