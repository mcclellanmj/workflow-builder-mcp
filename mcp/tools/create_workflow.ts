import { z } from "zod";
import type { Workflow, WorkflowNode } from "../../store/types.ts";
import { saveNode, saveWorkflow } from "../../store/kv.ts";
import { defineTool, jsonResponse } from "../helpers.ts";

const CreateWorkflowInputSchema = z.object({
  name: z.string().min(1).describe("The name of the workflow."),
  description: z.string().optional().default("").describe(
    "An optional description explaining the purpose or goal of the workflow.",
  ),
  intendedForIndependentRun: z.boolean().optional().default(true).describe(
    "Optional. Set to true (default) if this workflow is intended to be run as an independent/top-level workflow. Set to false if creating an internal sub-workflow.",
  ),
});

export const createWorkflowTool = defineTool({
  name: "workflow_create",
  description:
    "Creates a new workflow graph with the specified name, optional description, and optional intendedForIndependentRun flag. Automatically creates a default 'start' node as the workflow entry point.",
  schema: CreateWorkflowInputSchema,
  execute: async ({ name, description, intendedForIndependentRun }) => {
    const now = new Date().toISOString();
    const workflowId = crypto.randomUUID();

    const workflow: Workflow = {
      id: workflowId,
      name,
      description,
      intendedForIndependentRun: intendedForIndependentRun ?? true,
      createdAt: now,
      updatedAt: now,
    };

    const startNode: WorkflowNode = {
      id: crypto.randomUUID(),
      workflowId,
      type: "start",
      name: "Start",
      description: "Workflow entry point",
      runInSubAgent: false,
      config: {},
      status: "pending",
      error: null,
      createdAt: now,
      updatedAt: now,
    };

    await Promise.all([
      saveWorkflow(workflow),
      saveNode(startNode),
    ]);

    return jsonResponse({ workflow, startNode });
  },
});
