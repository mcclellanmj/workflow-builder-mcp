import { z } from "zod";
import {
  defineTool,
  hydrateNodesWithExecution,
  jsonResponse,
  requireExecution,
  requireWorkflowGraph,
} from "../helpers.ts";

const GetWorkflowInputSchema = z.object({
  workflowId: z.string().min(1).optional().describe(
    "The unique identifier of the workflow to retrieve. Required if executionId is not provided.",
  ),
  executionId: z.string().min(1).optional().describe(
    "Optional execution ID. When provided, node statuses in the response reflect that specific concurrent run's state.",
  ),
}).refine((data) => data.workflowId || data.executionId, {
  message: "At least one of 'workflowId' or 'executionId' must be provided.",
});

export const getWorkflowTool = defineTool({
  name: "workflow_get",
  description:
    "Gets full workflow details including workflow metadata, all nodes with their configurations and execution states, and all connecting edges. When an executionId is provided, node statuses reflect that specific concurrent run.",
  schema: GetWorkflowInputSchema,
  execute: async ({ workflowId, executionId }) => {
    if (executionId) {
      const execCheck = await requireExecution(executionId);
      if ("error" in execCheck) return execCheck.error;

      const { execution, workflow, nodes, edges } = execCheck;
      const hydratedNodes = hydrateNodesWithExecution(nodes, execution);
      return jsonResponse({ workflow, nodes: hydratedNodes, edges, execution });
    }

    const graphCheck = await requireWorkflowGraph(workflowId!);
    if ("error" in graphCheck) return graphCheck.error;

    return jsonResponse(graphCheck);
  },
});
