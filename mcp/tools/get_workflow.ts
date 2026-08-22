import { z } from "zod";
import { exportWorkflowBundle } from "../../store/kv.ts";
import {
  defineTool,
  hydrateNodesWithExecution,
  jsonResponse,
  requireExecution,
  requireWorkflowGraph,
} from "../helpers.ts";

const GetWorkflowInputSchema = z.object({
  workflow: z.string().min(1).optional().describe(
    "The unique identifier, name, or slug (e.g. 'review-workflow' or 'review-workflow/security') of the workflow to retrieve.",
  ),
  workflowId: z.string().min(1).optional().describe(
    "Alias for 'workflow'. The unique identifier, name, or slug of the workflow to retrieve.",
  ),
  executionId: z.string().min(1).optional().describe(
    "Optional execution ID. When provided, node statuses in the response reflect that specific concurrent run's state.",
  ),
  includeSubworkflows: z.boolean().optional().default(false).describe(
    "Optional. When true, recursively finds and includes all child subworkflows in the response under 'subworkflows'.",
  ),
}).refine((data) => data.workflow || data.workflowId || data.executionId, {
  message: "At least one of 'workflow', 'workflowId', or 'executionId' must be provided.",
});

export const getWorkflowTool = defineTool({
  name: "workflow_get",
  description:
    "Gets full workflow details including workflow metadata, all nodes with their configurations and execution states, and all connecting edges. Accepts workflow UUIDs, exact names, or slugs (e.g. 'review-workflow/security'). Supports includeSubworkflows: true to recursively bundle child subworkflows.",
  schema: GetWorkflowInputSchema,
  execute: async ({ workflow, workflowId, executionId, includeSubworkflows }) => {
    if (executionId) {
      const execCheck = await requireExecution(executionId);
      if ("error" in execCheck) return execCheck.error;

      const { execution, workflow: wf, nodes, edges } = execCheck;
      const hydratedNodes = hydrateNodesWithExecution(nodes, execution);
      return jsonResponse({ workflow: wf, nodes: hydratedNodes, edges, execution });
    }

    const targetWorkflow = workflow ?? workflowId!;
    const graphCheck = await requireWorkflowGraph(targetWorkflow);
    if ("error" in graphCheck) return graphCheck.error;

    if (includeSubworkflows) {
      const bundle = await exportWorkflowBundle(graphCheck.workflow.id, {
        includeSubworkflows: true,
        includeExecutions: false,
      });
      return jsonResponse({
        workflow: graphCheck.workflow,
        nodes: graphCheck.nodes,
        edges: graphCheck.edges,
        subworkflows: bundle?.subworkflows ?? [],
      });
    }

    return jsonResponse(graphCheck);
  },
});
