import { z } from "zod";
import { createErrorResponse } from "../registry.ts";
import { deleteEdges, deleteNode } from "../../store/kv.ts";
import { defineTool, jsonResponse, requireNode } from "../helpers.ts";

const DeleteNodeSchema = z.object({
  workflow: z.string().min(1).optional().describe(
    "The unique identifier, name, or slug of the workflow containing the node.",
  ),
  workflowId: z.string().min(1).optional().describe(
    "Alias for 'workflow'. The unique ID, name, or slug of the workflow containing the node.",
  ),
  node: z.string().min(1).optional().describe(
    "The unique ID, name, or slug of the node to delete.",
  ),
  nodeId: z.string().min(1).optional().describe(
    "Alias for 'node'. The unique ID, name, or slug of the node to delete.",
  ),
}).refine((data) => (data.workflow || data.workflowId) && (data.node || data.nodeId), {
  message: "Workflow ('workflow' or 'workflowId') and node ('node' or 'nodeId') must be provided.",
});

export const deleteNodeTool = defineTool({
  name: "node_delete",
  description:
    "Deletes a node from a workflow along with all inbound and outbound edges connected to it. Supports workflow and node UUIDs, exact names, or slugs. Start nodes cannot be deleted.",
  schema: DeleteNodeSchema,
  execute: async ({ workflow, workflowId, node, nodeId }) => {
    const targetWorkflow = workflow ?? workflowId!;
    const targetNode = node ?? nodeId!;

    const nodeCheck = await requireNode(targetWorkflow, targetNode);
    if ("error" in nodeCheck) return nodeCheck.error;

    const { node: existingNode, workflow: wf, edges } = nodeCheck;
    if (existingNode.type === "start") {
      return createErrorResponse(
        `Cannot delete the start node ("${existingNode.name}") of workflow "${wf.name}". Start nodes are required.`,
      );
    }

    const removedEdges = edges.filter(
      (edge) => edge.fromNodeId === existingNode.id || edge.toNodeId === existingNode.id,
    );
    const edgeIds = removedEdges.map((e) => e.id);

    await Promise.all([
      deleteEdges(wf.id, edgeIds),
      deleteNode(wf.id, existingNode.id),
    ]);

    return jsonResponse({
      success: true,
      message:
        `Node "${existingNode.name}" (${existingNode.id}) and ${removedEdges.length} connected edge(s) were successfully deleted.`,
      deletedNode: existingNode,
      removedEdges,
    });
  },
});
