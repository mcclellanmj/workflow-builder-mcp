/**
 * Formatting and Markdown/Mermaid visualization helpers for MCP tools.
 */

import type { Workflow, WorkflowEdge, WorkflowNode } from "../store/types.ts";

export const STATUS_ICONS: Record<string, string> = {
  pending: "⏳",
  running: "🔄",
  completed: "✅",
  failed: "❌",
  skipped: "⏭️",
};

/**
 * Sanitizes labels for safe inclusion in Mermaid diagrams.
 */
export function sanitizeMermaidLabel(text: string): string {
  return text
    .replace(/"/g, "#quot;")
    .replace(/\n+/g, " ")
    .replace(/<([a-zA-Z/])/g, "&lt;$1")
    .trim();
}

/**
 * Sanitizes edge condition text for safe Mermaid flowchart arrow labeling.
 */
export function sanitizeMermaidCondition(text: string): string {
  return text
    .replace(/\|/g, "/")
    .replace(/"/g, "#quot;")
    .replace(/\n+/g, " ")
    .trim();
}

/**
 * Generates a Mermaid flowchart diagram string from nodes and edges.
 */
export function renderMermaidFlowchart(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
): string {
  const formatId = (id: string) => id.replace(/[^a-zA-Z0-9_]/g, "_");

  const lines: string[] = ["flowchart TD"];
  for (const node of nodes) {
    const icon = STATUS_ICONS[node.status] ?? "⏳";
    const iterSuffix = node.iteration && node.iteration > 1 ? ` (iter ${node.iteration})` : "";
    const label = sanitizeMermaidLabel(`${icon} ${node.name}${iterSuffix}`);
    const nodeId = formatId(node.id);

    switch (node.type) {
      case "start":
      case "end":
        lines.push(`  ${nodeId}(["${label}"])`);
        break;
      case "decision":
        lines.push(`  ${nodeId}{"${label}"}`);
        break;
      case "user_interaction":
        lines.push(`  ${nodeId}{{"${label} 👤"}}`);
        break;
      case "subworkflow":
        lines.push(`  ${nodeId}[["${label} 📦"]]`);
        break;
      case "step":
      default:
        lines.push(`  ${nodeId}["${label}"]`);
        break;
    }
  }

  for (const edge of edges) {
    const fromId = formatId(edge.fromNodeId);
    const toId = formatId(edge.toNodeId);
    if (edge.condition && edge.condition.trim() !== "") {
      const condition = sanitizeMermaidCondition(edge.condition);
      lines.push(`  ${fromId} -->|${condition}| ${toId}`);
    } else {
      lines.push(`  ${fromId} --> ${toId}`);
    }
  }

  return lines.join("\n");
}

export function formatUserInteractionInstructions(node: WorkflowNode): string {
  const cfg = node.config ?? {};
  const prompt = typeof cfg.prompt === "string" ? cfg.prompt : "";
  const contextHint = typeof cfg.contextHint === "string" ? cfg.contextHint : "";
  const allowFreeText = Boolean(cfg.allowFreeText);

  let block = `> [!IMPORTANT]\n`;
  block += `> 👤 **User Interaction Required**: **${node.name}**\n`;
  if (prompt) {
    block += `> - **Prompt for User**: ${prompt}\n`;
  }
  if (contextHint) {
    block += `> - **Context / Hint**: ${contextHint}\n`;
  }
  if (cfg.options) {
    block += `> - **Available Options**:\n`;
    if (Array.isArray(cfg.options)) {
      for (const opt of cfg.options as string[]) {
        block += `>   - \`${opt}\` ➔ select with decision: \`${opt}\`\n`;
      }
    } else if (typeof cfg.options === "object" && cfg.options !== null) {
      for (const [label, condition] of Object.entries(cfg.options as Record<string, string>)) {
        block += `>   - "${label}" ➔ select with decision: \`${condition}\`\n`;
      }
    }
  }
  if (allowFreeText) {
    block += `> - **Free-text Input**: User may enter a freeform response.\n`;
  }
  block += `>\n`;
  block += `> 💡 **Instructions for LLM Orchestrator**:\n`;
  block +=
    `> If an interactive prompt tool (such as \`ask_question\`) is available in your current environment, **use it now** to present the prompt/options to the user and wait for their choice before calling \`workflow_next\`.\n`;
  block +=
    `> If no interactive prompt tool is available, present the prompt clearly in your message to the user and wait for their reply before proceeding.\n`;

  return block;
}

export function formatSubAgentInstructions(node: WorkflowNode): string {
  let block = `> [!NOTE]\n`;
  block += `> 🤖 **Sub-Agent Execution Required**: **${node.name}**\n`;
  block += `> - **Task Description**: ${node.description}\n`;
  block += `>\n`;
  block += `> 💡 **Instructions for LLM Orchestrator**:\n`;
  block +=
    `> This step is marked for sub-agent execution (\`runInSubAgent: true\`). Delegate this task to a sub-agent or child agent in an isolated context if sub-agent capabilities are available in your environment.\n`;
  block +=
    `> Once the sub-agent completes the task, proceed by advancing the workflow with \`workflow_next\` (e.g. \`status: "completed"\`).\n`;

  return block;
}

export function computeWorkflowSummary(nodes: Iterable<WorkflowNode>): {
  totalNodes: number;
  completedNodes: number;
  pendingNodes: number;
  failedNodes: number;
  skippedNodes: number;
} {
  const summary = {
    totalNodes: 0,
    completedNodes: 0,
    pendingNodes: 0,
    failedNodes: 0,
    skippedNodes: 0,
  };

  for (const node of nodes) {
    summary.totalNodes++;
    switch (node.status) {
      case "completed":
        summary.completedNodes++;
        break;
      case "pending":
        summary.pendingNodes++;
        break;
      case "failed":
        summary.failedNodes++;
        break;
      case "skipped":
        summary.skippedNodes++;
        break;
    }
  }

  return summary;
}

export function formatWorkflowListMarkdown(
  workflows: Workflow[],
  referencedIds?: Set<string>,
): string {
  if (workflows.length === 0) {
    return "## 📁 Workflows\n\n*No workflows found.*";
  }

  let md = `## 📁 Workflows (${workflows.length})\n\n`;
  md += `| Workflow Name | ID | Type | Description | Last Updated |\n`;
  md += `| :--- | :--- | :--- | :--- | :--- |\n`;
  for (const wf of workflows) {
    const isSub = wf.intendedForIndependentRun === false ||
      (Boolean(referencedIds?.has(wf.id)) && wf.intendedForIndependentRun !== true);
    const typeBadge = isSub ? "📦 *Sub-workflow*" : "🚀 *Standalone*";
    const desc = wf.description ? wf.description.replace(/\|/g, "/") : "-";
    md += `| **${wf.name}** | \`${wf.id}\` | ${typeBadge} | ${desc} | ${
      wf.updatedAt.slice(0, 10)
    } |\n`;
  }
  return md;
}

export function formatNodeListMarkdown(
  workflow: Workflow,
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
): string {
  let md = `## 🧩 Nodes in Workflow: **${workflow.name}** (${nodes.length})\n\n`;
  md += `| Node Name | Type | Status | Iteration | Outbound Connections |\n`;
  md += `| :--- | :--- | :--- | :--- | :--- |\n`;

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  for (const node of nodes) {
    const icon = STATUS_ICONS[node.status] ?? "⏳";
    const outEdges = edges.filter((e) => e.fromNodeId === node.id);
    const connStrs = outEdges.map((e) => {
      const target = nodeMap.get(e.toNodeId);
      const targetName = target ? target.name : e.toNodeId;
      return e.condition ? `\`${e.condition}\` ➔ **${targetName}**` : `➔ **${targetName}**`;
    });
    const conns = connStrs.length > 0 ? connStrs.join(", ") : "*None*";
    const iter = node.iteration !== undefined ? `${node.iteration}` : "-";

    md += `| ${icon} **${node.name}** | \`${node.type}\` | ${node.status} | ${iter} | ${conns} |\n`;
  }
  return md;
}
