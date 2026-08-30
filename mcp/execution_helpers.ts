/**
 * Workflow execution, graph retrieval, and node transition helper utilities.
 */

import type { ToolCallResponse } from "./registry.ts";
import { createErrorResponse } from "./registry.ts";
import { resolveNode, resolveWorkflow } from "./resolvers.ts";
import { getExecution, listEdges, listNodes } from "../store/kv.ts";
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
 * Fetches a workflow by UUID, name, or slug, returning a formatted error response if not found.
 */
export async function requireWorkflow(
  workflowIdOrSlug: string,
  userId?: string,
): Promise<{ workflow: Workflow } | { error: ToolCallResponse }> {
  const workflow = await resolveWorkflow(workflowIdOrSlug, userId);
  if (!workflow) {
    return {
      error: createErrorResponse(
        `Workflow "${workflowIdOrSlug}" not found. You can specify a workflow UUID, exact name, or slug (e.g. "review-workflow" or "parent-workflow/child").`,
      ),
    };
  }
  return { workflow };
}

/**
 * Fetches a workflow along with all its nodes and edges in parallel, resolving by UUID, name, or slug.
 */
export async function requireWorkflowGraph(
  workflowIdOrSlug: string,
  userId?: string,
): Promise<
  { workflow: Workflow; nodes: WorkflowNode[]; edges: WorkflowEdge[] } | {
    error: ToolCallResponse;
  }
> {
  const wfCheck = await requireWorkflow(workflowIdOrSlug, userId);
  if ("error" in wfCheck) return wfCheck;

  const [nodes, edges] = await Promise.all([
    listNodes(wfCheck.workflow.id, { userId }),
    listEdges(wfCheck.workflow.id, { userId }),
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
 * Fetches both a workflow and a specific node within it by UUID, name, or slug.
 */
export async function requireNode(
  workflowIdOrSlug: string,
  nodeIdOrSlug: string,
  userId?: string,
): Promise<
  { workflow: Workflow; node: WorkflowNode; nodes: WorkflowNode[]; edges: WorkflowEdge[] } | {
    error: ToolCallResponse;
  }
> {
  const graphCheck = await requireWorkflowGraph(workflowIdOrSlug, userId);
  if ("error" in graphCheck) return graphCheck;

  const { workflow, nodes, edges } = graphCheck;
  const node = resolveNode(nodeIdOrSlug, nodes);
  if (!node) {
    return {
      error: createErrorResponse(
        `Node "${nodeIdOrSlug}" not found in workflow "${workflow.name}" (${workflow.id}). You can specify a node UUID, exact name, or slug.`,
      ),
    };
  }
  return { workflow, node, nodes, edges };
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
