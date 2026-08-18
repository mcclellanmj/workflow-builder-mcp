import { z } from "zod";
import { deleteWorkflow } from "../../store/kv.ts";
import { defineTool, jsonResponse, requireWorkflow } from "../helpers.ts";

const DeleteWorkflowInputSchema = z.object({
  workflowId: z.string().min(1).describe("The unique identifier of the workflow to delete."),
});

export const deleteWorkflowTool = defineTool({
  name: "workflow_delete",
  description: "Deletes a workflow and all its associated nodes and edges via cascading delete.",
  schema: DeleteWorkflowInputSchema,
  execute: async ({ workflowId }) => {
    const wfCheck = await requireWorkflow(workflowId);
    if ("error" in wfCheck) return wfCheck.error;

    await deleteWorkflow(workflowId);

    return jsonResponse({
      message:
        `Workflow "${wfCheck.workflow.name}" (${workflowId}) and all associated nodes and edges were deleted successfully.`,
      workflowId,
    });
  },
});
