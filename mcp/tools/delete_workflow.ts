import { z } from "zod";
import { deleteWorkflow } from "../../store/kv.ts";
import { defineTool, jsonResponse, requireWorkflow } from "../helpers.ts";

const DeleteWorkflowInputSchema = z.object({
  workflow: z.string().min(1).optional().describe(
    "The unique identifier, name, or slug of the workflow to delete.",
  ),
  workflowId: z.string().min(1).optional().describe(
    "Alias for 'workflow'. The unique identifier, name, or slug of the workflow to delete.",
  ),
}).refine((data) => data.workflow || data.workflowId, {
  message: "Workflow ('workflow' or 'workflowId') must be provided.",
});

export const deleteWorkflowTool = defineTool({
  name: "workflow_delete",
  description:
    "Deletes a workflow and all its associated nodes and edges via cascading delete. Supports workflow UUIDs, exact names, or slugs.",
  schema: DeleteWorkflowInputSchema,
  execute: async ({ workflow, workflowId }) => {
    const targetWorkflow = workflow ?? workflowId!;
    const wfCheck = await requireWorkflow(targetWorkflow);
    if ("error" in wfCheck) return wfCheck.error;

    await deleteWorkflow(wfCheck.workflow.id);

    return jsonResponse({
      message:
        `Workflow "${wfCheck.workflow.name}" (${wfCheck.workflow.id}) and all associated nodes and edges were deleted successfully.`,
      workflowId: wfCheck.workflow.id,
    });
  },
});
