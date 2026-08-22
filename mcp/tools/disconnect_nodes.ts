import { z } from "zod";
import { deleteEdge, listEdges, listNodes } from "../../store/kv.ts";
import type { ValidationResult, WorkflowEdge } from "../../store/types.ts";
import { createErrorResponse } from "../registry.ts";
import { validateGraph } from "../../validation/graph.ts";
import { defineTool, jsonResponse, requireWorkflowGraph, resolveNode } from "../helpers.ts";

const DisconnectNodesSchema = z.object({
  workflow: z.string().min(1).optional().describe(
    "The unique identifier, name, or slug of the workflow.",
  ),
  workflowId: z.string().min(1).optional().describe(
    "Alias for 'workflow'. The unique identifier, name, or slug of the workflow.",
  ),
  fromNode: z.string().min(1).optional().describe(
    "The ID, name, or slug of the source node.",
  ),
  fromNodeId: z.string().min(1).optional().describe(
    "Alias for 'fromNode'. The ID, name, or slug of the source node.",
  ),
  toNode: z.string().min(1).optional().describe(
    "The ID, name, or slug of the target node.",
  ),
  toNodeId: z.string().min(1).optional().describe(
    "Alias for 'toNode'. The ID, name, or slug of the target node.",
  ),
}).refine(
  (data) =>
    (data.workflow || data.workflowId) &&
    (data.fromNode || data.fromNodeId) &&
    (data.toNode || data.toNodeId),
  {
    message:
      "Workflow ('workflow' or 'workflowId'), source node ('fromNode' or 'fromNodeId'), and target node ('toNode' or 'toNodeId') must be provided.",
  },
);

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
    "Removes a directed edge between two nodes in a workflow graph. Supports workflow and node UUIDs, exact names, or slugs. Validates that the edge exists before deleting it, and checks the graph structure after deletion to warn if any nodes have become unreachable from the start node.",
  schema: DisconnectNodesSchema,
  execute: async ({ workflow, workflowId, fromNode, fromNodeId, toNode, toNodeId }) => {
    const targetWorkflow = workflow ?? workflowId!;
    const fromTarget = fromNode ?? fromNodeId!;
    const toTarget = toNode ?? toNodeId!;

    const graphCheck = await requireWorkflowGraph(targetWorkflow);
    if ("error" in graphCheck) return graphCheck.error;

    const { workflow: wf, nodes, edges } = graphCheck;
    const resolvedFrom = resolveNode(fromTarget, nodes);
    const resolvedTo = resolveNode(toTarget, nodes);

    const fromId = resolvedFrom ? resolvedFrom.id : fromTarget;
    const toId = resolvedTo ? resolvedTo.id : toTarget;

    const edgeToDelete = edges.find(
      (edge) => edge.fromNodeId === fromId && edge.toNodeId === toId,
    );

    if (!edgeToDelete) {
      return createErrorResponse(
        `No edge found from node "${fromTarget}" to node "${toTarget}" in workflow "${wf.name}" (${wf.id}).`,
      );
    }

    await deleteEdge(wf.id, edgeToDelete.id);

    const [remainingNodes, remainingEdges] = await Promise.all([
      listNodes(wf.id),
      listEdges(wf.id),
    ]);
    const validation = validateGraph(remainingNodes, remainingEdges);
    const warnings = extractDisconnectionWarnings(validation);

    const responsePayload: {
      message: string;
      deletedEdge: WorkflowEdge;
      warnings?: string[];
    } = {
      message: `Successfully removed edge connecting node "${
        resolvedFrom?.name ?? fromTarget
      }" to node "${resolvedTo?.name ?? toTarget}".`,
      deletedEdge: edgeToDelete,
    };

    if (warnings.length > 0) {
      responsePayload.warnings = warnings;
    }

    return jsonResponse(responsePayload);
  },
});
