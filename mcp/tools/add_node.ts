import { z } from "zod";
import { listEdges, listNodes, saveNode } from "../../store/kv.ts";
import type { NodeType, WorkflowNode } from "../../store/types.ts";
import { analyzeWorkflowSuggestions } from "../../validation/heuristics.ts";
import { defineTool, jsonResponse, requireWorkflow, validateNodeConfig } from "../helpers.ts";

const AddNodeSchema = z.object({
  workflow: z.string().min(1).optional().describe(
    "The unique identifier, name, or slug of the workflow to add the node to.",
  ),
  workflowId: z.string().min(1).optional().describe(
    "Alias for 'workflow'. The unique ID, name, or slug of the workflow to add the node to.",
  ),
  type: z.enum(["step", "decision", "end", "subworkflow", "user_interaction"], {
    errorMap: () => ({
      message:
        "Node type must be 'step', 'decision', 'end', 'subworkflow', or 'user_interaction'. 'start' nodes are auto-created with workflows and cannot be added manually.",
    }),
  }).describe(
    "The type of node: 'step' for executable actions, 'decision' for branching logic, 'end' for workflow termination, 'subworkflow' for nested child workflows, 'user_interaction' for human-in-the-loop prompts.",
  ),
  name: z.string().min(1).describe("A short, descriptive name for the node."),
  description: z.string().min(1).describe(
    "Detailed instructions or prompt for the node execution. Can include code snippets or agent prompts.",
  ),
  runInSubAgent: z.boolean().optional().describe(
    "Optional. If true, the orchestrator should spawn a sub-agent for executing this node. Defaults to false.",
  ),
  config: z.record(z.unknown()).optional().describe(
    "Optional configuration object for the node. For decision nodes, must include 'options' as an array of string choices. For subworkflow nodes, must include 'childWorkflowId'. For user_interaction nodes, must include 'prompt' and optional 'options' / 'allowFreeText' / 'contextHint'.",
  ),
}).refine((data) => data.workflow || data.workflowId, {
  message: "Workflow ('workflow' or 'workflowId') must be provided.",
});

export const addNodeTool = defineTool({
  name: "node_add",
  description:
    "Adds a new node (step, decision, end, subworkflow, or user_interaction) to an existing workflow. Supports workflow UUIDs, exact names, or slugs. Note: 'start' nodes cannot be added manually as they are auto-created with workflows. Decision nodes require config.options containing the list of possible branch outcomes. Subworkflow nodes require config.childWorkflowId. User interaction nodes require config.prompt.",
  schema: AddNodeSchema,
  execute: async ({
    workflow,
    workflowId,
    type,
    name,
    description,
    runInSubAgent,
    config,
  }) => {
    const targetWorkflow = workflow ?? workflowId!;
    const wfCheck = await requireWorkflow(targetWorkflow);
    if ("error" in wfCheck) return wfCheck.error;

    const actualWfId = wfCheck.workflow.id;
    const nodeConfig = config ?? {};

    const validationError = validateNodeConfig(type as NodeType, nodeConfig, actualWfId);
    if (validationError) return validationError;

    const now = new Date().toISOString();
    const newNode: WorkflowNode = {
      id: crypto.randomUUID(),
      workflowId: actualWfId,
      type: type as NodeType,
      name,
      description,
      runInSubAgent: runInSubAgent ?? false,
      config: nodeConfig,
      status: "pending",
      error: null,
      createdAt: now,
      updatedAt: now,
    };

    await saveNode(newNode);

    const [allNodes, allEdges] = await Promise.all([
      listNodes(actualWfId),
      listEdges(actualWfId),
    ]);
    const suggestions = analyzeWorkflowSuggestions(allNodes, allEdges);

    return jsonResponse({
      ...newNode,
      ...(suggestions.length > 0 ? { suggestions } : {}),
    });
  },
});
