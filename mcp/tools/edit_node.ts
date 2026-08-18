import { z } from "zod";
import { saveNode } from "../../store/kv.ts";
import type { WorkflowNode } from "../../store/types.ts";
import { defineTool, jsonResponse, requireNode, validateNodeConfig } from "../helpers.ts";

const EditNodeSchema = z.object({
  workflowId: z.string().min(1).describe("The unique ID of the workflow containing the node."),
  nodeId: z.string().min(1).describe("The unique ID of the node to edit."),
  name: z.string().min(1).optional().describe("Optional new name for the node."),
  description: z.string().min(1).optional().describe(
    "Optional new detailed instructions or prompt for the node execution.",
  ),
  runInSubAgent: z.boolean().optional().describe(
    "Optional flag indicating whether this node should be executed in a spawned sub-agent.",
  ),
  config: z.record(z.unknown()).optional().describe(
    "Optional configuration object updates. For decision nodes, must include 'options' as an array of string choices. For subworkflow nodes, can update 'childWorkflowId' or 'maxIterations'. For user_interaction nodes, can update 'prompt', 'options', 'allowFreeText', or 'contextHint'.",
  ),
}).strict();

export const editNodeTool = defineTool({
  name: "node_edit",
  description:
    "Edits an existing node's properties (name, description, runInSubAgent, config) in a workflow. Note: Node types cannot be changed after creation, and start node types are fixed.",
  schema: EditNodeSchema,
  execute: async ({ workflowId, nodeId, name, description, runInSubAgent, config }) => {
    const nodeCheck = await requireNode(workflowId, nodeId);
    if ("error" in nodeCheck) return nodeCheck.error;

    const { node } = nodeCheck;

    if (config !== undefined) {
      const mergedConfig = { ...node.config, ...config };
      const validationError = validateNodeConfig(node.type, mergedConfig, workflowId);
      if (validationError) return validationError;
    }

    const updatedNode: WorkflowNode = {
      ...node,
      name: name !== undefined ? name : node.name,
      description: description !== undefined ? description : node.description,
      runInSubAgent: runInSubAgent !== undefined ? runInSubAgent : node.runInSubAgent,
      config: config !== undefined ? { ...node.config, ...config } : node.config,
      updatedAt: new Date().toISOString(),
    };

    await saveNode(updatedNode);
    return jsonResponse(updatedNode);
  },
});
