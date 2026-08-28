import { z } from "zod";
import { saveNodes } from "../../store/kv.ts";
import type { WorkflowNode } from "../../store/types.ts";
import { createErrorResponse } from "../registry.ts";
import { analyzeWorkflowSuggestions } from "../../validation/heuristics.ts";
import {
  defineTool,
  requireWorkflowGraph,
  resolveNode,
  richResponse,
  STATUS_ICONS,
  validateNodeConfig,
} from "../helpers.ts";

const NodePatchItemSchema = z.object({
  node: z.string().min(1).optional().describe(
    "The unique ID, name, or slug of the node to update.",
  ),
  nodeId: z.string().min(1).optional().describe(
    "Alias for 'node'. The unique ID, name, or slug of the node to update.",
  ),
  name: z.string().min(1).optional().describe("Optional new name for the node."),
  description: z.string().min(1).optional().describe(
    "Optional new detailed instructions or prompt for the node execution.",
  ),
  runInSubAgent: z.boolean().optional().describe(
    "Optional flag indicating whether this node should be executed in a spawned sub-agent.",
  ),
  config: z.record(z.unknown()).optional().describe(
    "Optional configuration object updates (e.g. options, childWorkflowId, prompt, contextHint).",
  ),
}).refine((data) => data.node || data.nodeId, {
  message: "Each node update must specify 'node' or 'nodeId'.",
});

const WorkflowPatchSchema = z.object({
  workflow: z.string().min(1).optional().describe(
    "The unique identifier, name, or slug of the workflow to patch.",
  ),
  workflowId: z.string().min(1).optional().describe(
    "Alias for 'workflow'. The unique ID, name, or slug of the workflow to patch.",
  ),
  nodes: z.array(NodePatchItemSchema).min(1).describe(
    "Array of node updates to apply atomically to the workflow.",
  ),
  format: z.enum(["markdown", "json", "both"]).optional().default("both").describe(
    "Optional output format. 'markdown' returns a formatted summary table, 'json' returns raw data, 'both' (default) returns multi-block annotated content.",
  ),
}).refine((data) => data.workflow || data.workflowId, {
  message: "Workflow ('workflow' or 'workflowId') must be provided.",
});

function formatPatchMarkdown(
  workflowName: string,
  workflowId: string,
  updatedNodes: WorkflowNode[],
): string {
  let md = `## 🛠️ Workflow Batch Patch: **${workflowName}**\n\n`;
  md += `> **Workflow ID**: \`${workflowId}\`\n`;
  md +=
    `> **Updated Nodes**: ${updatedNodes.length} node(s) successfully updated in an atomic transaction.\n\n`;
  md += `| Node Name | ID | Type | Updated Description / Prompt | Sub-Agent |\n`;
  md += `| :--- | :--- | :--- | :--- | :--- |\n`;

  for (const node of updatedNodes) {
    const icon = STATUS_ICONS[node.status] ?? "⏳";
    const desc = node.description
      ? (node.description.length > 80 ? `${node.description.slice(0, 80)}...` : node.description)
      : "-";
    const cleanDesc = desc.replace(/\|/g, "/");
    const subAgentBadge = node.runInSubAgent ? "⚡ `true`" : "`false`";
    md +=
      `| ${icon} **${node.name}** | \`${node.id}\` | \`${node.type}\` | ${cleanDesc} | ${subAgentBadge} |\n`;
  }

  return md;
}

export const workflowPatchTool = defineTool({
  name: "workflow_patch",
  description:
    "Performs batch atomic updates across multiple nodes in a workflow graph in a single call. Eliminates roundtrip overhead when modifying multiple nodes. Supports workflow and node UUIDs, exact names, or slugs. Validates node configurations prior to atomic persistence.",
  schema: WorkflowPatchSchema,
  execute: async ({ workflow, workflowId, nodes: nodePatches, format }) => {
    const targetWorkflow = workflow ?? workflowId!;
    const graphCheck = await requireWorkflowGraph(targetWorkflow);
    if ("error" in graphCheck) return graphCheck.error;

    const { workflow: wf, nodes: existingNodes } = graphCheck;
    const now = new Date().toISOString();

    const nodeMap = new Map<string, WorkflowNode>(existingNodes.map((n) => [n.id, n]));
    const updatedNodes: WorkflowNode[] = [];

    // 1. Resolve and validate all patches before committing
    for (const patch of nodePatches) {
      const targetIdentifier = patch.node ?? patch.nodeId!;
      const existingNode = resolveNode(targetIdentifier, Array.from(nodeMap.values()));

      if (!existingNode) {
        return createErrorResponse(
          `Node "${targetIdentifier}" not found in workflow "${wf.name}" (${wf.id}). You can specify a node UUID, exact name, or slug.`,
        );
      }

      if (patch.config !== undefined) {
        const mergedConfig = { ...existingNode.config, ...patch.config };
        const validationError = validateNodeConfig(existingNode.type, mergedConfig, wf.id);
        if (validationError) return validationError;
      }

      const updatedNode: WorkflowNode = {
        ...existingNode,
        name: patch.name !== undefined ? patch.name : existingNode.name,
        description: patch.description !== undefined ? patch.description : existingNode.description,
        runInSubAgent: patch.runInSubAgent !== undefined
          ? patch.runInSubAgent
          : existingNode.runInSubAgent,
        config: patch.config !== undefined
          ? { ...existingNode.config, ...patch.config }
          : existingNode.config,
        updatedAt: now,
      };

      nodeMap.set(updatedNode.id, updatedNode);
      updatedNodes.push(updatedNode);
    }

    // 2. Persist all updated nodes atomically
    await saveNodes(updatedNodes);

    // 3. Analyze graph heuristics using in-memory updated graph
    const allNodes = Array.from(nodeMap.values());
    const suggestions = analyzeWorkflowSuggestions(allNodes, graphCheck.edges);

    const markdown = formatPatchMarkdown(wf.name, wf.id, updatedNodes);

    return richResponse({
      data: {
        workflowId: wf.id,
        workflowName: wf.name,
        updatedCount: updatedNodes.length,
        updatedNodes,
        ...(suggestions.length > 0 ? { suggestions } : {}),
      },
      markdown,
      format,
    });
  },
});
