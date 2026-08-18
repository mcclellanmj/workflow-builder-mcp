import { z } from "zod";
import { getExecution, listEdges } from "../../store/kv.ts";
import type { WorkflowEdge } from "../../store/types.ts";
import {
  createErrorResponse,
  defineTool,
  hydrateNodesWithExecution,
  jsonResponse,
  requireNode,
} from "../helpers.ts";

const GetNodeSchema = z.object({
  workflowId: z.string().min(1).describe("The unique ID of the workflow containing the node."),
  nodeId: z.string().min(1).describe("The unique ID of the node to retrieve."),
  executionId: z.string().min(1).optional().describe(
    "Optional execution ID. When provided, node status fields reflect that specific concurrent run's state.",
  ),
});

export const getNodeTool = defineTool({
  name: "node_get",
  description:
    "Gets full details of a single node in a workflow, including all connected inbound and outbound edges. When an executionId is provided, status/output/error/iteration fields reflect that specific concurrent run's state.",
  schema: GetNodeSchema,
  execute: async ({ workflowId, nodeId, executionId }) => {
    const nodeCheck = await requireNode(workflowId, nodeId);
    if ("error" in nodeCheck) return nodeCheck.error;

    const edges = await listEdges(workflowId);
    const inboundEdges: WorkflowEdge[] = [];
    const outboundEdges: WorkflowEdge[] = [];

    for (const edge of edges) {
      if (edge.toNodeId === nodeId) inboundEdges.push(edge);
      if (edge.fromNodeId === nodeId) outboundEdges.push(edge);
    }

    let node = nodeCheck.node;

    if (executionId) {
      const execution = await getExecution(executionId);
      if (!execution) {
        return createErrorResponse(`Execution with ID "${executionId}" not found.`);
      }
      const [hydrated] = hydrateNodesWithExecution([node], execution);
      node = hydrated;
    }

    return jsonResponse({
      ...node,
      inboundEdges,
      outboundEdges,
    });
  },
});
