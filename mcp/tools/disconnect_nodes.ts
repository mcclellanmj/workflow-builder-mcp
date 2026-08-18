import { z } from "zod";
import { deleteEdge, listEdges, listNodes } from "../../store/kv.ts";
import type { ValidationResult, WorkflowEdge } from "../../store/types.ts";
import { createErrorResponse } from "../registry.ts";
import { validateGraph } from "../../validation/graph.ts";
import { defineTool, jsonResponse, requireWorkflow } from "../helpers.ts";

const DisconnectNodesSchema = z.object({
  workflowId: z.string().min(1).describe("The unique identifier of the workflow."),
  fromNodeId: z.string().min(1).describe("The ID of the source node."),
  toNodeId: z.string().min(1).describe("The ID of the target node."),
});

/**
 * Extracts post-disconnection warnings from graph validation results.
 */
function extractDisconnectionWarnings(validation: ValidationResult): string[] {
  const warnings: string[] = [];
  const unreachabilityErrors = validation.errors.filter((err) =>
    err.includes("not reachable from the start node")
  );

  for (const unreachableMsg of unreachabilityErrors) {
    warnings.push(`Warning: Disconnection leaves node unreachable: ${unreachableMsg}`);
  }
  for (const graphWarning of validation.warnings) {
    warnings.push(graphWarning);
  }
  return warnings;
}

export const disconnectNodesTool = defineTool({
  name: "node_disconnect",
  description:
    "Removes a directed edge between two nodes in a workflow graph. Validates that the edge exists before deleting it, and checks the graph structure after deletion to warn if any nodes have become unreachable from the start node.",
  schema: DisconnectNodesSchema,
  execute: async ({ workflowId, fromNodeId, toNodeId }) => {
    const wfCheck = await requireWorkflow(workflowId);
    if ("error" in wfCheck) return wfCheck.error;

    const edges = await listEdges(workflowId);
    const edgeToDelete = edges.find(
      (edge) => edge.fromNodeId === fromNodeId && edge.toNodeId === toNodeId,
    );

    if (!edgeToDelete) {
      return createErrorResponse(
        `No edge found from node "${fromNodeId}" to node "${toNodeId}" in workflow "${workflowId}".`,
      );
    }

    await deleteEdge(workflowId, edgeToDelete.id);

    const [remainingNodes, remainingEdges] = await Promise.all([
      listNodes(workflowId),
      listEdges(workflowId),
    ]);
    const validation = validateGraph(remainingNodes, remainingEdges);
    const warnings = extractDisconnectionWarnings(validation);

    const responsePayload: {
      message: string;
      deletedEdge: WorkflowEdge;
      warnings?: string[];
    } = {
      message: `Successfully removed edge connecting node "${fromNodeId}" to node "${toNodeId}".`,
      deletedEdge: edgeToDelete,
    };

    if (warnings.length > 0) {
      responsePayload.warnings = warnings;
    }

    return jsonResponse(responsePayload);
  },
});
