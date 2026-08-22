import { z } from "zod";
import {
  deleteExecution,
  getExecution,
  listExecutions,
  listNodes,
  saveExecution,
  saveNodes,
} from "../../store/kv.ts";
import { createErrorResponse, defineTool, jsonResponse, requireWorkflow } from "../helpers.ts";

const ResetWorkflowArgsSchema = z.object({
  workflow: z.string().min(1).optional().describe(
    "The unique identifier, name, or slug of the workflow. If provided without executionId, resets all node statuses on the workflow template (for backward compatibility).",
  ),
  workflowId: z.string().min(1).optional().describe(
    "Alias for 'workflow'. The unique identifier, name, or slug of the workflow.",
  ),
  executionId: z.string().min(1).optional().describe(
    "The execution ID of a specific run to reset. If provided, clears all node states for that execution so it can be re-run from the start.",
  ),
}).refine((data) => data.workflow || data.workflowId || data.executionId, {
  message: "At least one of 'workflow', 'workflowId', or 'executionId' must be provided.",
});

export const resetWorkflowTool = defineTool({
  name: "workflow_reset",
  description:
    "Resets a workflow for re-execution. When an executionId is provided, clears the execution's node states so that run can restart from scratch. When a workflow/workflowId is provided, resets all node statuses on the workflow template back to 'pending' AND deletes all executions associated with that workflow. Supports workflow UUIDs, exact names, or slugs.",
  schema: ResetWorkflowArgsSchema,
  execute: async ({ workflow, workflowId, executionId }) => {
    const now = new Date().toISOString();

    // --- Reset a specific execution ---
    if (executionId) {
      const execution = await getExecution(executionId);
      if (!execution) {
        return createErrorResponse(`Execution with ID "${executionId}" not found.`);
      }

      const resetExecution = {
        ...execution,
        status: "in_progress" as const,
        nodeStates: {},
        updatedAt: now,
      };

      await saveExecution(resetExecution);

      return jsonResponse({
        executionId,
        workflowId: execution.workflowId,
        message:
          `Execution "${executionId}" has been reset. Call workflow_start again to begin a new run, or re-use this execution.`,
        nodeStatesCleared: Object.keys(execution.nodeStates).length,
      });
    }

    // --- Reset workflow template (and all its executions) ---
    const targetWorkflow = workflow ?? workflowId!;
    const wfCheck = await requireWorkflow(targetWorkflow);
    if ("error" in wfCheck) return wfCheck.error;

    const actualWfId = wfCheck.workflow.id;
    const nodes = await listNodes(actualWfId);

    for (const node of nodes) {
      node.status = "pending";
      node.error = null;
      node.iteration = 1;
      node.iterationHistory = [];
      node.updatedAt = now;
    }

    await saveNodes(nodes);

    // Also delete all executions for this workflow
    const executions = await listExecutions(actualWfId);
    await Promise.all(executions.map((e) => deleteExecution(e)));

    return jsonResponse({
      workflowId: wfCheck.workflow.id,
      workflowName: wfCheck.workflow.name,
      nodesReset: nodes.length,
      executionsDeleted: executions.length,
      message:
        `Successfully reset ${nodes.length} node(s) in workflow "${wfCheck.workflow.name}" to 'pending' status and deleted ${executions.length} execution(s).`,
    });
  },
});
