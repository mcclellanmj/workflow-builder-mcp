/**
 * Shared helper functions and tool definition utilities.
 */

import type { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpTool, ToolCallResponse, ToolContentItem } from "./registry.ts";
import {
  createErrorResponse,
  createMultiContentResponse,
  createSuccessResponse,
} from "./registry.ts";

export { createErrorResponse, createMultiContentResponse, createSuccessResponse };
import {
  getExecution,
  getNode,
  getWorkflow,
  listEdges,
  listNodes,
  saveExecution,
  saveNodes,
} from "../store/kv.ts";
import type {
  ExecutionId,
  NodeExecutionState,
  NodeType,
  Workflow,
  WorkflowEdge,
  WorkflowExecution,
  WorkflowNode,
} from "../store/types.ts";

export type OutputFormat = "markdown" | "json" | "both";

export interface DefineToolOptions<TSchema extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  description: string;
  schema?: TSchema;
  execute: (args: z.output<TSchema>) => Promise<ToolCallResponse>;
}

/**
 * Creates an McpTool definition backed directly by Zod schemas,
 * handling input parsing/validation and registering seamlessly with McpServer.
 */
export function defineTool<TSchema extends z.ZodTypeAny = z.ZodTypeAny>(
  opts: DefineToolOptions<TSchema>,
): McpTool<z.input<TSchema>> {
  const executeHandler = async (rawArgs: unknown): Promise<ToolCallResponse> => {
    let parsedArgs: z.output<TSchema>;
    if (opts.schema) {
      const parsed = opts.schema.safeParse(rawArgs ?? {});
      if (!parsed.success) {
        const errorMsg = parsed.error.errors
          .map((e) => `${e.path.join(".") || "root"}: ${e.message}`)
          .join("; ");
        return createErrorResponse(`Invalid arguments: ${errorMsg}`);
      }
      parsedArgs = parsed.data;
    } else {
      parsedArgs = (rawArgs ?? {}) as z.output<TSchema>;
    }

    try {
      return await opts.execute(parsedArgs);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return createErrorResponse(`Error executing tool "${opts.name}": ${message}`);
    }
  };

  return {
    name: opts.name,
    description: opts.description,
    schema: opts.schema,
    execute: executeHandler,
    register: (server: McpServer): void => {
      server.registerTool(
        opts.name,
        {
          description: opts.description,
          ...(opts.schema ? { inputSchema: opts.schema } : {}),
        },
        async (args: unknown) => {
          console.error(
            `[WORKFLOW_MCP] Executing tool '${opts.name}' with args:`,
            JSON.stringify(args || {}),
          );
          const startTime = Date.now();
          try {
            const response = await executeHandler(args);
            const duration = Date.now() - startTime;
            console.error(`[WORKFLOW_MCP] Tool '${opts.name}' completed in ${duration}ms.`);
            return response;
          } catch (err) {
            const duration = Date.now() - startTime;
            console.error(`[WORKFLOW_MCP] Tool '${opts.name}' failed after ${duration}ms:`, err);
            throw err;
          }
        },
      );
    },
  };
}

/** Returns a successful ToolCallResponse containing JSON-formatted text. */
export function jsonResponse(data: unknown): ToolCallResponse {
  return createSuccessResponse(JSON.stringify(data, null, 2));
}

export interface RichResponseOptions {
  data: unknown;
  markdown: string;
  mermaidDiagram?: string;
  format?: OutputFormat;
}

/**
 * Constructs a rich ToolCallResponse supporting Markdown, Mermaid diagrams,
 * and JSON data annotated for target audience (user vs assistant).
 */
export function richResponse(opts: RichResponseOptions): ToolCallResponse {
  const format = opts.format ?? "both";

  if (format === "json") {
    return createSuccessResponse(JSON.stringify(opts.data, null, 2));
  }

  if (format === "markdown") {
    let text = opts.markdown;
    if (opts.mermaidDiagram) {
      text += `\n\n\`\`\`mermaid\n${opts.mermaidDiagram}\n\`\`\``;
    }
    return createSuccessResponse(text);
  }

  // format === "both": Multi-content items targeting audience
  const items: ToolContentItem[] = [
    {
      type: "text",
      text: opts.markdown,
      annotations: { audience: ["user"], priority: 1.0 },
    },
  ];

  if (opts.mermaidDiagram) {
    items.push({
      type: "text",
      text: `\`\`\`mermaid\n${opts.mermaidDiagram}\n\`\`\``,
      annotations: { audience: ["user"], priority: 0.9 },
    });
  }

  items.push({
    type: "text",
    text: JSON.stringify(opts.data, null, 2),
    annotations: { audience: ["assistant"], priority: 0.8 },
  });

  return createMultiContentResponse(items);
}

const STATUS_ICONS: Record<string, string> = {
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

export function formatWorkflowStartMarkdown(
  workflow: Workflow,
  _startNode: WorkflowNode,
  nextNodes: WorkflowNode[],
  summary: ReturnType<typeof computeWorkflowSummary>,
  executionId: string,
  warnings?: string[],
): string {
  const nextList = nextNodes.length > 0
    ? nextNodes.map((n) => {
      const iter = n.iteration && n.iteration > 1 ? ` *(Iteration ${n.iteration})*` : "";
      const subAgent = n.runInSubAgent ? " `[Sub-Agent]`" : "";
      return `- **${n.name}** (\`${n.type}\`${subAgent}${iter}): ${n.description}`;
    }).join("\n")
    : "*None (Workflow Complete)*";

  let md = `## 🚀 Workflow Started: **${workflow.name}**\n\n`;
  if (workflow.description) {
    md += `> ${workflow.description}\n\n`;
  }
  md +=
    `> **Execution ID**: \`${executionId}\` — pass this to \`workflow_next\` to advance this run.\n\n`;
  md += `### 📋 Next Actionable Step(s)\n${nextList}\n\n`;
  md +=
    `### 📊 Progress\n- **Total Nodes**: ${summary.totalNodes} | **Completed**: ${summary.completedNodes} | **Pending**: ${summary.pendingNodes}\n`;

  const userInteractionNodes = nextNodes.filter((n) => n.type === "user_interaction");
  if (userInteractionNodes.length > 0) {
    for (const n of userInteractionNodes) {
      md += `\n${formatUserInteractionInstructions(n)}\n`;
    }
  }

  if (warnings && warnings.length > 0) {
    md += `\n> [!WARNING]\n> **Validation Warnings**:\n> - ${warnings.join("\n> - ")}\n`;
  }
  return md;
}

export function formatWorkflowNextMarkdown(
  workflow: Workflow,
  currentNode: WorkflowNode,
  status: string,
  summaryText: string,
  nextNodes: WorkflowNode[],
  completedEndNodes: WorkflowNode[],
  workflowComplete: boolean,
  executionId?: string,
): string {
  const statusEmoji = status === "completed" ? "✅" : status === "failed" ? "❌" : "⏭️";
  const iterText = currentNode.iteration && currentNode.iteration > 1
    ? ` *(Iteration ${currentNode.iteration})*`
    : "";

  let md = `## ⚡ Workflow Progress: **${workflow.name}**\n\n`;
  if (executionId) {
    md += `> **Execution ID**: \`${executionId}\`\n\n`;
  }
  md +=
    `### ${statusEmoji} Current Step: **${currentNode.name}** (\`${currentNode.type}\`${iterText})\n`;
  md += `- **Outcome**: \`${status}\`\n`;

  if (currentNode.error) {
    md += `- **Error**: ❌ ${currentNode.error}\n`;
  }

  md += `\n> **Summary**: ${summaryText}\n\n`;

  if (workflowComplete) {
    const endNames = completedEndNodes.map((n) => `"${n.name}"`).join(", ");
    md += `### 🎉 Workflow Complete!\nReached terminal node(s): ${endNames || "End"}\n`;
  } else if (nextNodes.length > 0) {
    md += `### 📋 Actionable Next Step(s)\n`;
    for (const n of nextNodes) {
      const iter = n.iteration && n.iteration > 1 ? ` *(Iteration ${n.iteration})*` : "";
      const subAgent = n.runInSubAgent ? " `[Sub-Agent]`" : "";
      md += `- **${n.name}** (\`${n.type}\`${subAgent}${iter}): ${n.description}\n`;
      if (n.type === "decision" && Array.isArray(n.config?.options)) {
        md += `  *Branch Options*: \`${(n.config.options as string[]).join("`, `")}\`\n`;
      }
      if (n.type === "subworkflow" && n.config?.childWorkflowId) {
        md += `  *Child Workflow ID*: \`${n.config.childWorkflowId}\`\n`;
      }
      if (n.type === "user_interaction") {
        if (typeof n.config?.prompt === "string") {
          md += `  *Prompt*: ${n.config.prompt}\n`;
        }
        if (Array.isArray(n.config?.options)) {
          md += `  *Branch Options*: \`${(n.config.options as string[]).join("`, `")}\`\n`;
        } else if (typeof n.config?.options === "object" && n.config?.options !== null) {
          const optList = Object.entries(n.config.options as Record<string, string>)
            .map(([label, cond]) => `"${label}" (\`${cond}\`)`)
            .join(", ");
          md += `  *Branch Options*: ${optList}\n`;
        }
      }
    }

    const userInteractionNodes = nextNodes.filter((n) => n.type === "user_interaction");
    if (userInteractionNodes.length > 0) {
      for (const n of userInteractionNodes) {
        md += `\n${formatUserInteractionInstructions(n)}\n`;
      }
    }
  }

  return md;
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

/**
 * Fetches a workflow or returns a formatted error response if not found.
 */
export async function requireWorkflow(
  workflowId: string,
): Promise<{ workflow: Workflow } | { error: ToolCallResponse }> {
  const workflow = await getWorkflow(workflowId);
  if (!workflow) {
    return {
      error: createErrorResponse(`Workflow with ID "${workflowId}" not found.`),
    };
  }
  return { workflow };
}

/**
 * Fetches a workflow along with all its nodes and edges in parallel.
 */
export async function requireWorkflowGraph(
  workflowId: string,
): Promise<
  { workflow: Workflow; nodes: WorkflowNode[]; edges: WorkflowEdge[] } | {
    error: ToolCallResponse;
  }
> {
  const wfCheck = await requireWorkflow(workflowId);
  if ("error" in wfCheck) return wfCheck;

  const [nodes, edges] = await Promise.all([
    listNodes(workflowId),
    listEdges(workflowId),
  ]);

  return { workflow: wfCheck.workflow, nodes, edges };
}

/**
 * Overlays execution-specific runtime state onto a list of workflow node templates.
 * Returns new node objects with status/output/error/iteration from the execution's nodeStates.
 * Nodes with no execution state are returned with their template defaults (all "pending").
 */
export function hydrateNodesWithExecution(
  nodes: WorkflowNode[],
  execution: WorkflowExecution,
): WorkflowNode[] {
  return nodes.map((node) => {
    const ns: NodeExecutionState | undefined = execution.nodeStates[node.id];
    if (!ns) return node;
    return {
      ...node,
      status: ns.status,
      error: ns.error,
      iteration: ns.iteration,
      iterationHistory: ns.iterationHistory,
      updatedAt: ns.updatedAt,
    };
  });
}

/**
 * Loads a workflow execution and its associated workflow graph, returning an error response if either is missing.
 */
export async function requireExecution(executionId: ExecutionId): Promise<
  | {
    execution: WorkflowExecution;
    workflow: Workflow;
    nodes: WorkflowNode[];
    edges: WorkflowEdge[];
  }
  | { error: ToolCallResponse }
> {
  const execution = await getExecution(executionId);
  if (!execution) {
    return {
      error: createErrorResponse(`Execution with ID "${executionId}" not found.`),
    };
  }

  const graphCheck = await requireWorkflowGraph(execution.workflowId);
  if ("error" in graphCheck) return graphCheck;

  return { execution, ...graphCheck };
}

/**
 * Fetches both a workflow and a specific node within it, returning a formatted error response if either is missing.
 */
export async function requireNode(
  workflowId: string,
  nodeId: string,
): Promise<{ workflow: Workflow; node: WorkflowNode } | { error: ToolCallResponse }> {
  const wfResult = await requireWorkflow(workflowId);
  if ("error" in wfResult) return wfResult;

  const node = await getNode(workflowId, nodeId);
  if (!node) {
    return {
      error: createErrorResponse(`Node with ID "${nodeId}" not found in workflow "${workflowId}".`),
    };
  }
  return { workflow: wfResult.workflow, node };
}

/**
 * Validates that a decision node's config contains a valid, non-empty options array of strings.
 */
export function validateDecisionOptions(
  config?: Record<string, unknown>,
): ToolCallResponse | null {
  const options = config?.options;
  if (
    !Array.isArray(options) ||
    options.length === 0 ||
    !options.every((opt) => typeof opt === "string" && opt.trim().length > 0)
  ) {
    return createErrorResponse(
      "Decision nodes require a non-empty 'options' array of strings in config (e.g. config: { options: ['approved', 'rejected'] }).",
    );
  }
  return null;
}

/**
 * Validates that a subworkflow node's config contains a valid childWorkflowId and prevents direct self-recursion.
 */
export function validateSubworkflowConfig(
  config?: Record<string, unknown>,
  currentWorkflowId?: string,
): ToolCallResponse | null {
  const childWorkflowId = config?.childWorkflowId;
  if (
    typeof childWorkflowId !== "string" ||
    childWorkflowId.trim().length === 0
  ) {
    return createErrorResponse(
      "Subworkflow nodes require a non-empty 'childWorkflowId' in config (e.g. config: { childWorkflowId: 'wf-123' }).",
    );
  }
  if (currentWorkflowId && childWorkflowId.trim() === currentWorkflowId) {
    return createErrorResponse(
      "Subworkflow node cannot reference its own workflow ID (self-recursion is not allowed).",
    );
  }
  return null;
}

/**
 * Validates that a user_interaction node's config contains a valid prompt and optional options / flags.
 */
export function validateUserInteractionConfig(
  config?: Record<string, unknown>,
): ToolCallResponse | null {
  if (!config || typeof config !== "object") {
    return createErrorResponse(
      "User interaction nodes require a config object with at least a 'prompt' string.",
    );
  }

  const prompt = config.prompt;
  if (typeof prompt !== "string" || prompt.trim().length === 0) {
    return createErrorResponse(
      "User interaction nodes require a non-empty 'prompt' string in config (e.g. config: { prompt: 'Do you want to apply fixes?' }).",
    );
  }

  const options = config.options;
  if (options !== undefined) {
    if (Array.isArray(options)) {
      if (
        options.length === 0 ||
        !options.every((opt) => typeof opt === "string" && opt.trim().length > 0)
      ) {
        return createErrorResponse(
          "When 'options' is an array for a user interaction node, it must be a non-empty array of strings.",
        );
      }
    } else if (typeof options === "object" && options !== null) {
      const entries = Object.entries(options as Record<string, unknown>);
      if (
        entries.length === 0 ||
        !entries.every(
          ([k, v]) =>
            typeof k === "string" &&
            k.trim().length > 0 &&
            typeof v === "string" &&
            v.trim().length > 0,
        )
      ) {
        return createErrorResponse(
          "When 'options' is a map for a user interaction node, all keys and values must be non-empty strings (e.g. { 'Yes': 'fix_additional', 'No': 'finish_workflow' }).",
        );
      }
    } else {
      return createErrorResponse(
        "'options' for a user interaction node must be either a string array or a map of { displayLabel: condition }.",
      );
    }
  }

  if (config.allowFreeText !== undefined && typeof config.allowFreeText !== "boolean") {
    return createErrorResponse("'allowFreeText' in config must be a boolean.");
  }

  if (config.contextHint !== undefined && typeof config.contextHint !== "string") {
    return createErrorResponse("'contextHint' in config must be a string.");
  }

  return null;
}

/**
 * Unified validator for node configurations based on NodeType.
 */
export function validateNodeConfig(
  type: NodeType,
  config: Record<string, unknown>,
  workflowId?: string,
): ToolCallResponse | null {
  if (type === "decision") {
    return validateDecisionOptions(config);
  }
  if (type === "subworkflow") {
    return validateSubworkflowConfig(config, workflowId);
  }
  if (type === "user_interaction") {
    return validateUserInteractionConfig(config);
  }
  return null;
}

/**
 * Shapes a WorkflowNode into the public actionable next-node DTO.
 */
export function formatActionableNode(node: WorkflowNode): {
  id: string;
  name: string;
  type: string;
  description: string;
  runInSubAgent: boolean;
  config: Record<string, unknown>;
  status: string;
  iteration?: number;
} {
  return {
    id: node.id,
    name: node.name,
    type: node.type,
    description: node.description,
    runInSubAgent: node.runInSubAgent,
    config: node.config,
    status: node.status,
    ...(node.iteration !== undefined ? { iteration: node.iteration } : {}),
  };
}

/**
 * Traverses candidate edges, automatically marks reached 'end' nodes as completed,
 * partitions actionable next nodes from terminal end nodes, and handles loop re-entry / iterations.
 *
 * When `execution` is provided, all runtime state mutations are written into `execution.nodeStates`
 * and the execution is saved to KV. Otherwise, node records are saved directly to KV (legacy path).
 */
export async function advanceAcrossEdges(
  edges: WorkflowEdge[],
  nodeMap: Map<string, WorkflowNode>,
  now: string,
  execution?: WorkflowExecution,
): Promise<{ actionableNextNodes: WorkflowNode[]; completedEndNodes: WorkflowNode[] }> {
  const actionableNextNodes: WorkflowNode[] = [];
  const completedEndNodes: WorkflowNode[] = [];
  const modifiedNodes: WorkflowNode[] = [];

  // Helper: get current runtime view of a node (from execution if provided, else the node itself)
  const getNodeState = (node: WorkflowNode): WorkflowNode => {
    if (!execution) return node;
    const ns = execution.nodeStates[node.id];
    if (!ns) return node;
    return {
      ...node,
      status: ns.status,
      error: ns.error,
      iteration: ns.iteration,
      iterationHistory: ns.iterationHistory,
      updatedAt: ns.updatedAt,
    };
  };

  // Helper: persist runtime changes to appropriate store
  const applyNodeMutation = (node: WorkflowNode): void => {
    nodeMap.set(node.id, node);
    if (execution) {
      execution.nodeStates[node.id] = {
        nodeId: node.id,
        status: node.status,
        error: node.error,
        iteration: node.iteration,
        iterationHistory: node.iterationHistory,
        updatedAt: node.updatedAt,
      };
    } else {
      modifiedNodes.push(node);
    }
  };

  for (const edge of edges) {
    const baseNode = nodeMap.get(edge.toNodeId);
    if (!baseNode) continue;

    const targetNode = { ...getNodeState(baseNode) };

    if (targetNode.type === "end") {
      targetNode.status = "completed";
      targetNode.updatedAt = now;
      applyNodeMutation(targetNode);
      completedEndNodes.push(targetNode);
    } else if (targetNode.status !== "pending") {
      // Loop re-entry to an already executed or active node
      const currentIteration = targetNode.iteration ?? 1;
      const rawMax = Number(targetNode.config?.maxIterations);
      const maxIterations = Number.isInteger(rawMax) && rawMax > 0 && rawMax <= 100 ? rawMax : 10;

      if (currentIteration >= maxIterations) {
        // Exceeded iteration ceiling
        targetNode.status = "failed";
        targetNode.error = `Loop iteration limit exceeded (maximum ${maxIterations} iterations).`;
        targetNode.updatedAt = now;
        applyNodeMutation(targetNode);
      } else {
        // Increment iteration and archive previous iteration state
        const history = targetNode.iterationHistory ?? [];
        history.push({
          iteration: currentIteration,
          error: targetNode.error,
          completedAt: targetNode.updatedAt || now,
        });

        targetNode.iterationHistory = history;
        targetNode.iteration = currentIteration + 1;
        targetNode.status = "pending";
        targetNode.error = null;
        targetNode.updatedAt = now;

        applyNodeMutation(targetNode);
        actionableNextNodes.push(targetNode);
      }
    } else {
      // Normal pending node
      if (targetNode.iteration === undefined) {
        targetNode.iteration = 1;
        targetNode.updatedAt = now;
        applyNodeMutation(targetNode);
      }
      actionableNextNodes.push(targetNode);
    }
  }

  if (execution) {
    await saveExecution(execution);
  } else if (modifiedNodes.length > 0) {
    await saveNodes(modifiedNodes);
  }

  return { actionableNextNodes, completedEndNodes };
}

/**
 * Computes status counts across nodes in a single pass without extra array allocations.
 */
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

/**
 * Indexes edges into inbound and outbound lookup maps for O(1) connection resolution.
 */
export function indexEdges(edges: WorkflowEdge[]): {
  inboundMap: Map<string, WorkflowEdge[]>;
  outboundMap: Map<string, WorkflowEdge[]>;
} {
  const inboundMap = new Map<string, WorkflowEdge[]>();
  const outboundMap = new Map<string, WorkflowEdge[]>();

  for (const edge of edges) {
    const outList = outboundMap.get(edge.fromNodeId);
    if (outList) {
      outList.push(edge);
    } else {
      outboundMap.set(edge.fromNodeId, [edge]);
    }

    const inList = inboundMap.get(edge.toNodeId);
    if (inList) {
      inList.push(edge);
    } else {
      inboundMap.set(edge.toNodeId, [edge]);
    }
  }

  return { inboundMap, outboundMap };
}
