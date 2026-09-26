import { z } from "zod";
import { saveNode } from "../../store/kv.ts";
import type { JoinPolicy, WorkflowNode } from "../../store/types.ts";
import { defineTool, jsonResponse, requireNode, validateNodeConfig } from "../helpers.ts";

const EditNodeSchema = z.object({
  workflow: z.string().min(1).optional().describe(
    "The unique identifier, name, or slug (e.g. 'review-workflow/security') of the workflow containing the node.",
  ),
  workflowId: z.string().min(1).optional().describe(
    "Alias for 'workflow'. The unique ID, name, or slug of the workflow containing the node.",
  ),
  node: z.string().min(1).optional().describe(
    "The unique ID, name, or slug (e.g. 'Step 5-web') of the node to edit.",
  ),
  nodeId: z.string().min(1).optional().describe(
    "Alias for 'node'. The unique ID, name, or slug of the node to edit.",
  ),
  name: z.string().min(1).optional().describe("Optional new name for the node."),
  description: z.string().min(1).optional().describe(
    "Optional new detailed instructions or prompt for the node execution.",
  ),
  runInSubAgent: z.boolean().optional().describe(
    "Optional flag indicating whether this node should be executed in a spawned sub-agent.",
  ),
  role: z.string().optional().describe(
    "Optional new workflow-scoped role assignment for this node.",
  ),
  joinPolicy: z.enum(["all", "any", "m_of_n"]).optional().describe(
    "Optional new barrier join policy ('all', 'any', 'm_of_n').",
  ),
  joinThreshold: z.number().int().positive().optional().describe(
    "Optional new threshold count of satisfied inbound edges when joinPolicy is 'm_of_n'.",
  ),
  config: z.record(z.unknown()).optional().describe(
    "Optional configuration object updates. For decision nodes: { field: string, map?: Record<string, string>, numericRules?: Array<{ op, value, condition }>, default: string }. For subworkflow nodes: { childWorkflowId: string }. For user_interaction nodes: { prompt: string, options?: string[] | Record<string, string> }.",
  ),
}).strict().refine((data) => (data.workflow || data.workflowId) && (data.node || data.nodeId), {
  message: "Workflow ('workflow' or 'workflowId') and node ('node' or 'nodeId') must be provided.",
});

export const editNodeTool = defineTool({
  name: "node_edit",
  description:
    "Edits an existing node's properties (name, description, runInSubAgent, role, joinPolicy, joinThreshold, config) in a workflow.",
  schema: EditNodeSchema,
  execute: async ({
    workflow,
    workflowId,
    node,
    nodeId,
    name,
    description,
    runInSubAgent,
    role,
    joinPolicy,
    joinThreshold,
    config,
  }) => {
    const targetWorkflow = workflow ?? workflowId!;
    const targetNode = node ?? nodeId!;

    const nodeCheck = await requireNode(targetWorkflow, targetNode);
    if ("error" in nodeCheck) return nodeCheck.error;

    const { node: existingNode } = nodeCheck;

    if (config !== undefined) {
      const mergedConfig = { ...existingNode.config, ...config };
      const validationError = validateNodeConfig(
        existingNode.type,
        mergedConfig,
        existingNode.workflowId,
      );
      if (validationError) return validationError;
    }

    const updatedNode: WorkflowNode = {
      ...existingNode,
      name: name !== undefined ? name : existingNode.name,
      description: description !== undefined ? description : existingNode.description,
      runInSubAgent: runInSubAgent !== undefined ? runInSubAgent : existingNode.runInSubAgent,
      role: role !== undefined ? (role.trim() || undefined) : existingNode.role,
      joinPolicy: joinPolicy !== undefined ? (joinPolicy as JoinPolicy) : existingNode.joinPolicy,
      joinThreshold: joinThreshold !== undefined ? joinThreshold : existingNode.joinThreshold,
      config: config !== undefined ? { ...existingNode.config, ...config } : existingNode.config,
      updatedAt: new Date().toISOString(),
    };

    await saveNode(updatedNode);
    return jsonResponse(updatedNode);
  },
});
