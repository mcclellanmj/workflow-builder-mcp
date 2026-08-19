/**
 * Workflow execution, graph retrieval, and node transition helper utilities.
 */

import type { ToolCallResponse } from "./registry.ts";
import { createErrorResponse } from "./registry.ts";
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
 * Returns new node objects with status/error/iteration from the execution's nodeStates.
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
      const currentIteration = targetNode.iteration ?? 1;
      const rawMax = Number(targetNode.config?.maxIterations);
      const maxIterations = Number.isInteger(rawMax) && rawMax > 0 && rawMax <= 100 ? rawMax : 10;

      if (currentIteration >= maxIterations) {
        targetNode.status = "failed";
        targetNode.error = `Loop iteration limit exceeded (maximum ${maxIterations} iterations).`;
        targetNode.updatedAt = now;
        applyNodeMutation(targetNode);
      } else {
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
