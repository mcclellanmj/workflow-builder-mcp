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
  workflow: z.string().min(1).optional().describe(
    "The unique identifier, name, or slug of the workflow containing the node.",
  ),
  workflowId: z.string().min(1).optional().describe(
    "Alias for 'workflow'. The unique ID, name, or slug of the workflow containing the node.",
  ),
  node: z.string().min(1).optional().describe(
    "The unique ID, name, or slug of the node to retrieve.",
  ),
  nodeId: z.string().min(1).optional().describe(
    "Alias for 'node'. The unique ID, name, or slug of the node to retrieve.",
  ),
  executionId: z.string().min(1).optional().describe(
    "Optional execution ID. When provided, node status fields reflect that specific concurrent run's state.",
  ),
}).refine((data) => (data.workflow || data.workflowId) && (data.node || data.nodeId), {
  message: "Workflow ('workflow' or 'workflowId') and node ('node' or 'nodeId') must be provided.",
});

export const getNodeTool = defineTool({
  name: "node_get",
  description:
    "Gets full details of a single node in a workflow, including all connected inbound and outbound edges. Supports workflow and node UUIDs, exact names, or slugs. When an executionId is provided, status/error/iteration fields reflect that specific concurrent run's state.",
  schema: GetNodeSchema,
  execute: async ({ workflow, workflowId, node, nodeId, executionId }) => {
    const targetWorkflow = workflow ?? workflowId!;
    const targetNode = node ?? nodeId!;

    const nodeCheck = await requireNode(targetWorkflow, targetNode);
    if ("error" in nodeCheck) return nodeCheck.error;

    const { node: resolvedNode, workflow: wf } = nodeCheck;

    const edges = await listEdges(wf.id);
    const inboundEdges: WorkflowEdge[] = [];
    const outboundEdges: WorkflowEdge[] = [];

    for (const edge of edges) {
      if (edge.toNodeId === resolvedNode.id) inboundEdges.push(edge);
      if (edge.fromNodeId === resolvedNode.id) outboundEdges.push(edge);
    }

    let currentNode = resolvedNode;

    if (executionId) {
      const execution = await getExecution(executionId);
      if (!execution) {
        return createErrorResponse(`Execution with ID "${executionId}" not found.`);
      }
      const [hydrated] = hydrateNodesWithExecution([currentNode], execution);
      currentNode = hydrated;
    }

    return jsonResponse({
      ...currentNode,
      inboundEdges,
      outboundEdges,
    });
  },
});
