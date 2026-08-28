import { z } from "zod";
import { saveEdge } from "../../store/kv.ts";
import type { WorkflowEdge, WorkflowNode } from "../../store/types.ts";
import { createErrorResponse, type ToolCallResponse } from "../registry.ts";
import { wouldCreateCycle } from "../../validation/graph.ts";
import { analyzeWorkflowSuggestions } from "../../validation/heuristics.ts";
import { defineTool, jsonResponse, requireWorkflowGraph, resolveNode } from "../helpers.ts";

const ConnectNodesSchema = z.object({
  workflow: z.string().min(1).optional().describe(
    "The unique identifier, name, or slug of the workflow.",
  ),
  workflowId: z.string().min(1).optional().describe(
    "Alias for 'workflow'. The unique identifier, name, or slug of the workflow.",
  ),
  fromNode: z.string().min(1).optional().describe(
    "The ID, name, or slug of the source node where the edge originates.",
  ),
  fromNodeId: z.string().min(1).optional().describe(
    "Alias for 'fromNode'. The ID, name, or slug of the source node.",
  ),
  toNode: z.string().min(1).optional().describe(
    "The ID, name, or slug of the target node where the edge terminates.",
  ),
  toNodeId: z.string().min(1).optional().describe(
    "Alias for 'toNode'. The ID, name, or slug of the target node.",
  ),
  condition: z.string().optional().describe(
    "Optional condition label for branching paths (e.g. from decision nodes).",
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
 * Validates connection constraints: node existence, start/end node edge rules, and duplicates.
 */
function validateConnection(
  workflowId: string,
  fromNodeId: string,
  toNodeId: string,
  fromNode: WorkflowNode | null,
  toNode: WorkflowNode | null,
  existingEdges: WorkflowEdge[],
): ToolCallResponse | null {
  if (!fromNode) {
    return createErrorResponse(
      `Source node "${fromNodeId}" not found in workflow "${workflowId}".`,
    );
  }

  if (!toNode) {
    return createErrorResponse(
      `Target node "${toNodeId}" not found in workflow "${workflowId}".`,
    );
  }

  if (toNode.type === "start") {
    return createErrorResponse(
      `Cannot connect to start node "${toNode.name}" (${toNodeId}). Start nodes must not have inbound edges.`,
    );
  }

  if (fromNode.type === "end") {
    return createErrorResponse(
      `Cannot connect from end node "${fromNode.name}" (${fromNodeId}). End nodes must not have outbound edges.`,
    );
  }

  const isDuplicate = existingEdges.some(
    (edge) => edge.fromNodeId === fromNode.id && edge.toNodeId === toNode.id,
  );
  if (isDuplicate) {
    return createErrorResponse(
      `An edge already exists from node "${fromNode.name}" (${fromNode.id}) to node "${toNode.name}" (${toNode.id}).`,
    );
  }

  return null;
}

export const connectNodesTool = defineTool({
  name: "node_connect",
  description:
    "Creates a directed edge from one node to another within a workflow graph. Supports workflow and node UUIDs, exact names, or slugs. Supports linear connections, conditional branching, and feedback loops (cycles). Prevents inbound edges to start nodes, outbound edges from end nodes, and duplicate edges.",
  schema: ConnectNodesSchema,
  execute: async ({
    workflow,
    workflowId,
    fromNode,
    fromNodeId,
    toNode,
    toNodeId,
    condition,
  }) => {
    const targetWorkflow = workflow ?? workflowId!;
    const fromTarget = fromNode ?? fromNodeId!;
    const toTarget = toNode ?? toNodeId!;

    const graphCheck = await requireWorkflowGraph(targetWorkflow);
    if ("error" in graphCheck) return graphCheck.error;

    const { workflow: wf, nodes, edges: existingEdges } = graphCheck;
    const resolvedFrom = resolveNode(fromTarget, nodes);
    const resolvedTo = resolveNode(toTarget, nodes);

    const validationError = validateConnection(
      wf.id,
      fromTarget,
      toTarget,
      resolvedFrom,
      resolvedTo,
      existingEdges,
    );
    if (validationError) return validationError;

    const createsLoop = wouldCreateCycle(resolvedFrom!.id, resolvedTo!.id, existingEdges);

    const newEdge: WorkflowEdge = {
      id: crypto.randomUUID(),
      workflowId: wf.id,
      fromNodeId: resolvedFrom!.id,
      toNodeId: resolvedTo!.id,
      ...(condition !== undefined && condition.trim() !== ""
        ? { condition: condition.trim() }
        : {}),
    };

    await saveEdge(newEdge);

    const warnings: string[] = [];
    if (resolvedFrom!.type === "decision" && (!condition || condition.trim() === "")) {
      warnings.push(
        `Source node "${resolvedFrom!.name}" (${
          resolvedFrom!.id
        }) is a decision node, but no condition was specified for this edge. Decision node outbound edges should typically specify a condition.`,
      );
    }
    if (createsLoop) {
      warnings.push(
        `This edge creates a feedback loop / cycle from "${resolvedFrom!.name}" to "${
          resolvedTo!.name
        }". Ensure the loop is gated with a decision node and an exit path to pass validation.`,
      );
    }

    const allEdges = [...existingEdges, newEdge];
    const suggestions = analyzeWorkflowSuggestions(nodes, allEdges);

    return jsonResponse({
      ...newEdge,
      ...(warnings.length > 0 ? { warning: warnings.join(" ") } : {}),
      ...(suggestions.length > 0 ? { suggestions } : {}),
    });
  },
});
