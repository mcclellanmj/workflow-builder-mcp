import { z } from "zod";
import { listEdges, listNodes, saveNode } from "../../store/kv.ts";
import type { JoinPolicy, NodeType, WorkflowNode } from "../../store/types.ts";
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
  role: z.string().optional().describe(
    "Optional workflow-scoped role assigned to this step (e.g. 'developer', 'reviewer', 'qa', 'architect').",
  ),
  joinPolicy: z.enum(["all", "any", "m_of_n"]).optional().describe(
    "Barrier synchronization policy when this node has multiple incoming edges ('all', 'any', 'm_of_n'). Defaults to 'all'.",
  ),
  joinThreshold: z.number().int().positive().optional().describe(
    "Threshold count of satisfied inbound edges when joinPolicy is 'm_of_n'.",
  ),
  config: z.record(z.unknown()).optional().describe(
    "Optional configuration object for the node. For decision nodes: { field: string, map?: Record<string, string>, numericRules?: Array<{ op, value, condition }>, default: string }. For subworkflow nodes: { childWorkflowId: string }. For user_interaction nodes: { prompt: string, options?: string[] | Record<string, string> }.",
  ),
}).refine((data) => data.workflow || data.workflowId, {
  message: "Workflow ('workflow' or 'workflowId') must be provided.",
});

export const addNodeTool = defineTool({
  name: "node_add",
  description:
    "Adds a new node (step, decision, end, subworkflow, or user_interaction) to an existing workflow. Supports barrier join policies (all, any, m_of_n), role assignments, and declarative decision configurations ({ field, map, numericRules, default }).",
  schema: AddNodeSchema,
  execute: async ({
    workflow,
    workflowId,
    type,
    name,
    description,
    runInSubAgent,
    role,
    joinPolicy,
    joinThreshold,
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
      role: role?.trim() || undefined,
      joinPolicy: joinPolicy as JoinPolicy | undefined,
      joinThreshold,
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
