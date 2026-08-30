import { z } from "zod";
import { getWorkflow, listEdges, listNodes } from "../../store/kv.ts";
import type { NodeType, Workflow } from "../../store/types.ts";
import { defineTool, requireWorkflowGraph, richResponse, STATUS_ICONS } from "../helpers.ts";

const WorkflowTreeSchema = z.object({
  workflow: z.string().min(1).optional().describe(
    "The unique identifier, name, or slug of the root workflow to inspect.",
  ),
  workflowId: z.string().min(1).optional().describe(
    "Alias for 'workflow'. The unique identifier, name, or slug of the root workflow.",
  ),
  depth: z.number().int().min(1).max(20).optional().default(5).describe(
    "Maximum traversal depth for recursively expanding child subworkflows (default: 5).",
  ),
  includeDescriptions: z.boolean().optional().default(false).describe(
    "Whether to include full node descriptions in the tree summary (default: false for concise view).",
  ),
  format: z.enum(["markdown", "json", "both"]).optional().default("both").describe(
    "Optional output format. 'markdown' returns a hierarchical tree diagram, 'json' returns raw nested tree, 'both' (default) returns multi-block annotated content.",
  ),
}).refine((data) => data.workflow || data.workflowId, {
  message: "Workflow ('workflow' or 'workflowId') must be provided.",
});

export interface WorkflowTreeNode {
  workflow: {
    id: string;
    name: string;
    description: string;
    intendedForIndependentRun?: boolean;
  };
  depth: number;
  nodeCount: number;
  edgeCount: number;
  nodes: Array<{
    id: string;
    name: string;
    type: NodeType;
    status: string;
    runInSubAgent: boolean;
    description?: string;
    childWorkflowId?: string;
  }>;
  children: Array<{
    subworkflowNodeId: string;
    subworkflowNodeName: string;
    tree: WorkflowTreeNode;
  }>;
}

const TYPE_ICONS: Record<string, string> = {
  start: "🚀",
  end: "🛑",
  step: "⚡",
  decision: "❓",
  user_interaction: "👤",
  subworkflow: "📦",
};

/**
 * Recursively builds the hierarchical workflow tree structure.
 */
async function buildWorkflowTree(
  workflow: Workflow,
  currentDepth: number,
  maxDepth: number,
  visited: Set<string>,
  includeDescriptions: boolean,
): Promise<WorkflowTreeNode> {
  const [nodes, edges] = await Promise.all([
    listNodes(workflow.id),
    listEdges(workflow.id),
  ]);

  const treeNode: WorkflowTreeNode = {
    workflow: {
      id: workflow.id,
      name: workflow.name,
      description: workflow.description,
      intendedForIndependentRun: workflow.intendedForIndependentRun,
    },
    depth: currentDepth,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    nodes: nodes.map((n) => ({
      id: n.id,
      name: n.name,
      type: n.type,
      status: n.status,
      runInSubAgent: n.runInSubAgent,
      ...(includeDescriptions ? { description: n.description } : {}),
      ...(n.type === "subworkflow" && typeof n.config?.childWorkflowId === "string"
        ? { childWorkflowId: n.config.childWorkflowId }
        : {}),
    })),
    children: [],
  };

  if (currentDepth < maxDepth) {
    const subworkflowNodes = nodes.filter(
      (n) => n.type === "subworkflow" && typeof n.config?.childWorkflowId === "string",
    );

    const childResults = await Promise.all(
      subworkflowNodes.map(async (subNode) => {
        const childId = (subNode.config!.childWorkflowId as string).trim();
        if (!childId || visited.has(childId)) return null;

        const childWf = await getWorkflow(childId);
        if (!childWf) return null;

        const nextVisited = new Set(visited);
        nextVisited.add(childId);

        const childTree = await buildWorkflowTree(
          childWf,
          currentDepth + 1,
          maxDepth,
          nextVisited,
          includeDescriptions,
        );

        return {
          subworkflowNodeId: subNode.id,
          subworkflowNodeName: subNode.name,
          tree: childTree,
        };
      }),
    );

    for (const res of childResults) {
      if (res) {
        treeNode.children.push(res);
      }
    }
  }

  return treeNode;
}

/**
 * Renders an ASCII/Unicode hierarchy tree string from the tree structure.
 */
function renderAsciiTree(
  tree: WorkflowTreeNode,
  prefix = "",
  isTail = true,
  isRoot = true,
): string[] {
  const lines: string[] = [];
  const connector = isRoot ? "" : isTail ? "└── " : "├── ";
  const typeBadge = tree.workflow.intendedForIndependentRun === false
    ? "📦 *(Sub-workflow)*"
    : "🚀 *(Standalone)*";

  lines.push(
    `${prefix}${connector}**${tree.workflow.name}** (\`${tree.workflow.id}\`) ${typeBadge} [${tree.nodeCount} nodes]`,
  );

  const childPrefix = isRoot ? "" : prefix + (isTail ? "    " : "│   ");

  // Render individual nodes in this workflow
  const childSubworkflowMap = new Map(
    tree.children.map((c) => [c.subworkflowNodeId, c.tree]),
  );

  for (let i = 0; i < tree.nodes.length; i++) {
    const node = tree.nodes[i];
    const isLastNode = i === tree.nodes.length - 1 && tree.children.length === 0;
    const nodeConnector = isLastNode ? "└── " : "├── ";
    const icon = TYPE_ICONS[node.type] ?? "🔹";
    const statusIcon = STATUS_ICONS[node.status] ?? "⏳";
    const subAgent = node.runInSubAgent ? " `[Sub-Agent]`" : "";

    if (node.type === "subworkflow" && childSubworkflowMap.has(node.id)) {
      const childTree = childSubworkflowMap.get(node.id)!;
      lines.push(
        `${childPrefix}${nodeConnector}${icon} **${node.name}** (\`${node.type}\` ➔ \`${childTree.workflow.name}\`)`,
      );
      const subLines = renderAsciiTree(
        childTree,
        childPrefix + (isLastNode ? "    " : "│   "),
        true,
        false,
      );
      lines.push(...subLines);
    } else {
      lines.push(
        `${childPrefix}${nodeConnector}${icon} ${statusIcon} **${node.name}** (\`${node.type}\`${subAgent})`,
      );
    }
  }

  return lines;
}

function formatTreeMarkdown(tree: WorkflowTreeNode, maxDepth: number): string {
  const asciiLines = renderAsciiTree(tree);

  let md = `## 🌳 Workflow Hierarchy Tree: **${tree.workflow.name}**\n\n`;
  md += `> **Workflow ID**: \`${tree.workflow.id}\`\n`;
  md +=
    `> **Traversal Depth**: ${maxDepth} | **Child Subworkflows Expanded**: ${tree.children.length}\n\n`;
  md += "```text\n";
  md += asciiLines.join("\n").replace(/\*\*/g, "");
  md += "\n```\n\n";

  md += `### 📋 Workflow Summary\n`;
  md += `- **Root Workflow**: **${tree.workflow.name}** (\`${tree.workflow.id}\`)\n`;
  md += `- **Nodes in Root**: ${tree.nodeCount}\n`;
  md += `- **Direct Child Subworkflows**: ${tree.children.length}\n`;

  return md;
}

export const workflowTreeTool = defineTool({
  name: "workflow_tree",
  description:
    "Renders a complete recursive hierarchical tree view of a workflow and all its nested child subworkflows. Eliminates the need to manually query child subworkflows step-by-step. Supports workflow UUIDs, exact names, or slugs and configurable recursion depth.",
  schema: WorkflowTreeSchema,
  execute: async ({
    workflow,
    workflowId,
    depth = 5,
    includeDescriptions = false,
    format,
  }) => {
    const targetWorkflow = workflow ?? workflowId!;
    const graphCheck = await requireWorkflowGraph(targetWorkflow);
    if ("error" in graphCheck) return graphCheck.error;

    const { workflow: rootWf } = graphCheck;
    const visited = new Set<string>([rootWf.id]);

    const tree = await buildWorkflowTree(
      rootWf,
      1,
      depth,
      visited,
      includeDescriptions,
    );

    const markdown = formatTreeMarkdown(tree, depth);

    return richResponse({
      data: tree,
      markdown,
      format,
    });
  },
});
