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
  workflowId: z.string().min(1).optional().describe(
    "The unique identifier of the workflow. If provided without executionId, resets all node statuses on the workflow template (for backward compatibility).",
  ),
  executionId: z.string().min(1).optional().describe(
    "The execution ID of a specific run to reset. If provided, clears all node states for that execution so it can be re-run from the start.",
  ),
}).refine((data) => data.workflowId || data.executionId, {
  message: "At least one of 'workflowId' or 'executionId' must be provided.",
});

export const resetWorkflowTool = defineTool({
  name: "workflow_reset",
  description:
    "Resets a workflow for re-execution. When an executionId is provided, clears the execution's node states so that run can restart from scratch. When only a workflowId is provided, resets all node statuses on the workflow template back to 'pending' AND deletes all executions associated with that workflow.",
  schema: ResetWorkflowArgsSchema,
  execute: async ({ workflowId, executionId }) => {
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
    const wfCheck = await requireWorkflow(workflowId!);
    if ("error" in wfCheck) return wfCheck.error;

    const nodes = await listNodes(workflowId!);

    for (const node of nodes) {
      node.status = "pending";
      node.error = null;
      node.iteration = 1;
      node.iterationHistory = [];
      node.updatedAt = now;
    }

    await saveNodes(nodes);

    // Also delete all executions for this workflow
    const executions = await listExecutions(workflowId!);
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
