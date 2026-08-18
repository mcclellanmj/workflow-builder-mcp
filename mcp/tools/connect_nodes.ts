import { z } from "zod";
import { getNode, listEdges, listNodes, saveEdge } from "../../store/kv.ts";
import type { WorkflowEdge, WorkflowNode } from "../../store/types.ts";
import { createErrorResponse, type ToolCallResponse } from "../registry.ts";
import { wouldCreateCycle } from "../../validation/graph.ts";
import { analyzeWorkflowSuggestions } from "../../validation/heuristics.ts";
import { defineTool, jsonResponse, requireWorkflow } from "../helpers.ts";

const ConnectNodesSchema = z.object({
  workflowId: z.string().min(1).describe("The unique identifier of the workflow."),
  fromNodeId: z.string().min(1).describe("The ID of the source node where the edge originates."),
  toNodeId: z.string().min(1).describe("The ID of the target node where the edge terminates."),
  condition: z.string().optional().describe(
    "Optional condition label for branching paths (e.g. from decision nodes).",
  ),
});

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
    (edge) => edge.fromNodeId === fromNodeId && edge.toNodeId === toNodeId,
  );
  if (isDuplicate) {
    return createErrorResponse(
      `An edge already exists from node "${fromNode.name}" (${fromNodeId}) to node "${toNode.name}" (${toNodeId}).`,
    );
  }

  return null;
}

export const connectNodesTool = defineTool({
  name: "node_connect",
  description:
    "Creates a directed edge from one node to another within a workflow graph. Supports linear connections, conditional branching, and feedback loops (cycles). Prevents inbound edges to start nodes, outbound edges from end nodes, and duplicate edges.",
  schema: ConnectNodesSchema,
  execute: async ({ workflowId, fromNodeId, toNodeId, condition }) => {
    const wfCheck = await requireWorkflow(workflowId);
    if ("error" in wfCheck) return wfCheck.error;

    const [fromNode, toNode, existingEdges] = await Promise.all([
      getNode(workflowId, fromNodeId),
      getNode(workflowId, toNodeId),
      listEdges(workflowId),
    ]);

    const validationError = validateConnection(
      workflowId,
      fromNodeId,
      toNodeId,
      fromNode,
      toNode,
      existingEdges,
    );
    if (validationError) return validationError;

    const createsLoop = wouldCreateCycle(fromNodeId, toNodeId, existingEdges);

    const newEdge: WorkflowEdge = {
      id: crypto.randomUUID(),
      workflowId,
      fromNodeId,
      toNodeId,
      ...(condition !== undefined && condition.trim() !== ""
        ? { condition: condition.trim() }
        : {}),
    };

    await saveEdge(newEdge);

    const warnings: string[] = [];
    if (fromNode!.type === "decision" && (!condition || condition.trim() === "")) {
      warnings.push(
        `Source node "${
          fromNode!.name
        }" (${fromNodeId}) is a decision node, but no condition was specified for this edge. Decision node outbound edges should typically specify a condition.`,
      );
    }
    if (createsLoop) {
      warnings.push(
        `This edge creates a feedback loop / cycle from "${fromNode!.name}" to "${
          toNode!.name
        }". Ensure the loop is gated with a decision node and an exit path to pass validation.`,
      );
    }

    const [allNodes, allEdges] = await Promise.all([
      listNodes(workflowId),
      listEdges(workflowId),
    ]);
    const suggestions = analyzeWorkflowSuggestions(allNodes, allEdges);

    return jsonResponse({
      ...newEdge,
      ...(warnings.length > 0 ? { warning: warnings.join(" ") } : {}),
      ...(suggestions.length > 0 ? { suggestions } : {}),
    });
  },
});
