import { z } from "zod";
import { validateGraph } from "../../validation/graph.ts";
import { defineTool, jsonResponse, requireWorkflowGraph } from "../helpers.ts";

const ValidateWorkflowInputSchema = z.object({
  workflow: z.string().min(1).optional().describe(
    "The unique identifier, name, or slug of the workflow to validate.",
  ),
  workflowId: z.string().min(1).optional().describe(
    "Alias for 'workflow'. The unique identifier, name, or slug of the workflow to validate.",
  ),
}).refine((data) => data.workflow || data.workflowId, {
  message: "Workflow ('workflow' or 'workflowId') must be provided.",
});

export const validateWorkflowTool = defineTool({
  name: "workflow_validate",
  description:
    "Runs full graph validation for a workflow and returns all validation errors, warnings, and modularity suggestions. Supports workflow UUIDs, exact names, or slugs. Validates structural constraints including single start node, reachability from start, gated cycle / loop validation (exit path enforcement), valid edge references, and decision node condition coverage.",
  schema: ValidateWorkflowInputSchema,
  execute: async ({ workflow, workflowId }) => {
    const targetWorkflow = workflow ?? workflowId!;
    const graphCheck = await requireWorkflowGraph(targetWorkflow);
    if ("error" in graphCheck) return graphCheck.error;

    const result = validateGraph(graphCheck.nodes, graphCheck.edges);
    return jsonResponse(result);
  },
});
