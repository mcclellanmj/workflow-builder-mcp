import { z } from "zod";
import { createErrorResponse } from "../registry.ts";
import { deleteEdgesForNode, deleteNode } from "../../store/kv.ts";
import { defineTool, jsonResponse, requireNode } from "../helpers.ts";

const DeleteNodeSchema = z.object({
  workflowId: z.string().min(1).describe("The unique ID of the workflow containing the node."),
  nodeId: z.string().min(1).describe("The unique ID of the node to delete."),
});

export const deleteNodeTool = defineTool({
  name: "node_delete",
  description:
    "Deletes a node from a workflow along with all inbound and outbound edges connected to it. Start nodes cannot be deleted.",
  schema: DeleteNodeSchema,
  execute: async ({ workflowId, nodeId }) => {
    const nodeCheck = await requireNode(workflowId, nodeId);
    if ("error" in nodeCheck) return nodeCheck.error;

    const { node } = nodeCheck;
    if (node.type === "start") {
      return createErrorResponse(
        `Cannot delete the start node ("${node.name}") of workflow "${workflowId}". Start nodes are required.`,
      );
    }

    const [removedEdges] = await Promise.all([
      deleteEdgesForNode(workflowId, nodeId),
      deleteNode(workflowId, nodeId),
    ]);

    return jsonResponse({
      success: true,
      message:
        `Node "${node.name}" (${nodeId}) and ${removedEdges.length} connected edge(s) were successfully deleted.`,
      deletedNode: node,
      removedEdges,
    });
  },
});
