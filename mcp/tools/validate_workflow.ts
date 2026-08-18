import { z } from "zod";
import { validateGraph } from "../../validation/graph.ts";
import { defineTool, jsonResponse, requireWorkflowGraph } from "../helpers.ts";

const ValidateWorkflowInputSchema = z.object({
  workflowId: z.string().min(1).describe("The unique identifier of the workflow to validate."),
});

export const validateWorkflowTool = defineTool({
  name: "workflow_validate",
  description:
    "Runs full graph validation for a workflow and returns all validation errors, warnings, and modularity suggestions. Validates structural constraints including single start node, reachability from start, gated cycle / loop validation (exit path enforcement), valid edge references, and decision node condition coverage.",
  schema: ValidateWorkflowInputSchema,
  execute: async ({ workflowId }) => {
    const graphCheck = await requireWorkflowGraph(workflowId);
    if ("error" in graphCheck) return graphCheck.error;

    const result = validateGraph(graphCheck.nodes, graphCheck.edges);
    return jsonResponse(result);
  },
});
