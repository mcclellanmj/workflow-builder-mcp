import { z } from "zod";
import { createErrorResponse, type ToolCallResponse } from "../registry.ts";
import { saveExecution } from "../../store/kv.ts";
import type { WorkflowEdge, WorkflowNode } from "../../store/types.ts";
import {
  advanceAcrossEdges,
  computeWorkflowSummary,
  defineTool,
  formatActionableNode,
  formatWorkflowNextMarkdown,
  hydrateNodesWithExecution,
  renderMermaidFlowchart,
  requireExecution,
  richResponse,
} from "../helpers.ts";

const WorkflowNextArgsSchema = z.object({
  executionId: z.string().min(1).describe(
    "The unique execution ID returned by workflow_start. Identifies which concurrent run to advance.",
  ),
  nodeId: z.string().min(1).describe(
    "The ID of the node that finished execution or changed status.",
  ),
  status: z.enum(["completed", "failed", "skipped"]).describe(
    "The execution outcome of the node ('completed', 'failed', or 'skipped').",
  ),
  error: z.string().optional().describe("Optional error message if the node failed."),
  decision: z.string().optional().describe(
    "For decision or user_interaction nodes: the chosen branch matching an outbound edge condition (e.g. 'yes', 'no', 'approved', 'fix_minor').",
  ),
  format: z.enum(["markdown", "json", "both"]).optional().default("both").describe(
    "Optional output format. 'markdown' returns human-readable status, 'json' returns raw data, 'both' (default) returns multi-block annotated content for user and assistant.",
  ),
});

/**
 * Resolves candidate outbound edges based on node type and optional decision outcome.
 */
function resolveEdgesToFollow(
  currentNode: WorkflowNode,
  outboundEdges: WorkflowEdge[],
  decision?: string,
): { edges: WorkflowEdge[] } | { error: ToolCallResponse } {
  if (currentNode.type !== "decision" && currentNode.type !== "user_interaction") {
    return { edges: outboundEdges };
  }

  const conditionedEdges = outboundEdges.filter((e) => Boolean(e.condition));

  // If user_interaction node has only unconditional edges and no options config, allow advancing without decision
  if (
    currentNode.type === "user_interaction" && conditionedEdges.length === 0 &&
    !currentNode.config?.options
  ) {
    return { edges: outboundEdges };
  }

  const availableConditions = outboundEdges
    .map((e) => e.condition)
    .filter((c): c is string => Boolean(c));

  if (!decision) {
    const typeLabel = currentNode.type === "user_interaction" ? "user interaction" : "decision";
    return {
      error: createErrorResponse(
        `Node "${currentNode.name}" (${currentNode.id}) is a ${typeLabel} node. You must provide a "decision" argument. Available options: [${
          availableConditions.join(", ")
        }]`,
      ),
    };
  }

  // Check matching edges directly by condition
  let matchingEdges = outboundEdges.filter(
    (e) =>
      e.condition === decision ||
      (e.condition && e.condition.toLowerCase() === decision.toLowerCase()),
  );

  // If not matched and config.options is a map ({ [label]: condition }), try looking up mapped condition
  if (
    matchingEdges.length === 0 &&
    currentNode.config?.options &&
    typeof currentNode.config.options === "object" &&
    !Array.isArray(currentNode.config.options)
  ) {
    const optionsMap = currentNode.config.options as Record<string, string>;
    const matchedKey = Object.keys(optionsMap).find(
      (k) => k.toLowerCase() === decision.toLowerCase(),
    );
    if (matchedKey) {
      const targetCondition = optionsMap[matchedKey];
      matchingEdges = outboundEdges.filter(
        (e) =>
          e.condition === targetCondition ||
          (e.condition && e.condition.toLowerCase() === targetCondition.toLowerCase()),
      );
    }
  }

  if (matchingEdges.length === 0) {
    const typeLabel = currentNode.type === "user_interaction" ? "user interaction" : "decision";
    return {
      error: createErrorResponse(
        `No outbound edge matching decision "${decision}" for ${typeLabel} node "${currentNode.name}". Available options: [${
          availableConditions.join(", ")
        }]`,
      ),
    };
  }

  return { edges: matchingEdges };
}

/**
 * Formats a human-readable execution summary message.
 */
function buildExecutionSummary(
  currentNode: WorkflowNode,
  status: string,
  decision?: string,
  actionableNextNodes: WorkflowNode[] = [],
  completedEndNodes: WorkflowNode[] = [],
): string {
  const isBranchingNode = currentNode.type === "decision" ||
    currentNode.type === "user_interaction";
  if (actionableNextNodes.length > 0) {
    const nextNames = actionableNextNodes.map((n) => `"${n.name}" (${n.type})`).join(", ");
    return isBranchingNode && decision
      ? `Node "${currentNode.name}" ${status} with decision "${decision}". Next step(s): ${nextNames}.`
      : `Node "${currentNode.name}" ${status}. Next step(s): ${nextNames}.`;
  }
  if (completedEndNodes.length > 0) {
    const endNames = completedEndNodes.map((n) => `"${n.name}"`).join(", ");
    return `Node "${currentNode.name}" ${status}. Reached end node(s): ${endNames}. Workflow execution complete.`;
  }
  return `Node "${currentNode.name}" ${status}. No further outbound steps. Workflow execution complete.`;
}

export const getNextStepTool = defineTool({
  name: "workflow_next",
  description:
    "Core orchestration tool. Given an execution ID (from workflow_start) and the outcome of a completed node, updates the execution's node state, traverses outbound graph edges (resolving branch conditions for decision nodes), automatically marks reached 'end' nodes as completed, and returns the next actionable step(s) or signals workflow completion. Each concurrent execution is fully isolated — multiple projects can run the same workflow template simultaneously.",
  schema: WorkflowNextArgsSchema,
  execute: async ({ executionId, nodeId, status, error, decision, format }) => {
    // Load the execution and its workflow graph
    const execCheck = await requireExecution(executionId);
    if ("error" in execCheck) return execCheck.error;

    const { execution, workflow, nodes, edges } = execCheck;
    const now = new Date().toISOString();

    // Find the template node to get type info (name, type, config, etc.)
    const templateNode = nodes.find((n) => n.id === nodeId);
    if (!templateNode) {
      return createErrorResponse(
        `Node with ID "${nodeId}" not found in workflow "${workflow.id}".`,
      );
    }

    // Update this node's execution state
    const prevState = execution.nodeStates[nodeId];
    execution.nodeStates[nodeId] = {
      nodeId,
      status,
      error: error ?? prevState?.error ?? null,
      iteration: prevState?.iteration ?? 1,
      iterationHistory: prevState?.iterationHistory,
      updatedAt: now,
    };
    execution.updatedAt = now;

    // Build a node map hydrated with execution state for edge traversal and rendering
    const nodeMap = new Map<string, WorkflowNode>(
      nodes.map((n) => {
        const ns = execution.nodeStates[n.id];
        if (!ns) return [n.id, n];
        return [n.id, {
          ...n,
          status: ns.status,
          error: ns.error,
          iteration: ns.iteration,
          iterationHistory: ns.iterationHistory,
          updatedAt: ns.updatedAt,
        }];
      }),
    );

    // Reflect the freshly updated current node in the map
    const currentNode = { ...templateNode, ...execution.nodeStates[nodeId] } as WorkflowNode;
    nodeMap.set(currentNode.id, currentNode);

    if (status === "failed") {
      execution.status = "failed";
      await saveExecution(execution);

      const summary = `Node "${currentNode.name}" (${currentNode.id}) marked as failed.${
        error ? ` Error: ${error}` : ""
      }`;
      const responseData = {
        executionId,
        nextNodes: [],
        workflowComplete: false,
        summary,
      };
      const markdown = formatWorkflowNextMarkdown(
        workflow,
        currentNode,
        status,
        summary,
        [],
        [],
        false,
        executionId,
      );
      return richResponse({
        data: responseData,
        markdown,
        format,
      });
    }

    const outboundEdges = edges.filter((e) => e.fromNodeId === nodeId);
    const edgeResolution = resolveEdgesToFollow(currentNode, outboundEdges, decision);
    if ("error" in edgeResolution) return edgeResolution.error;

    // Pass execution so advanceAcrossEdges writes into execution.nodeStates
    const { actionableNextNodes, completedEndNodes } = await advanceAcrossEdges(
      edgeResolution.edges,
      nodeMap,
      now,
      execution,
    );

    const workflowComplete = actionableNextNodes.length === 0;
    if (workflowComplete) {
      execution.status = completedEndNodes.length > 0 ? "completed" : "in_progress";
      execution.updatedAt = now;
      await saveExecution(execution);
    }

    const summary = buildExecutionSummary(
      currentNode,
      status,
      decision,
      actionableNextNodes,
      completedEndNodes,
    );

    const hydratedNodes = hydrateNodesWithExecution(Array.from(nodeMap.values()), execution);

    const responseData = {
      executionId,
      nextNodes: actionableNextNodes.map(formatActionableNode),
      workflowComplete,
      summary,
      workflowSummary: computeWorkflowSummary(hydratedNodes),
    };

    const markdown = formatWorkflowNextMarkdown(
      workflow,
      currentNode,
      status,
      summary,
      actionableNextNodes,
      completedEndNodes,
      workflowComplete,
      executionId,
    );

    const mermaid = renderMermaidFlowchart(hydratedNodes, edges);

    return richResponse({
      data: responseData,
      markdown,
      mermaidDiagram: mermaid,
      format,
    });
  },
});
