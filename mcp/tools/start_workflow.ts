import { z } from "zod";
import { createErrorResponse } from "../registry.ts";
import { saveExecution, saveNode } from "../../store/kv.ts";
import type { WorkflowExecution, WorkflowNode } from "../../store/types.ts";
import { validateGraph } from "../../validation/graph.ts";
import {
  advanceAcrossEdges,
  computeWorkflowSummary,
  defineTool,
  formatActionableNode,
  formatWorkflowStartMarkdown,
  hydrateNodesWithExecution,
  renderMermaidFlowchart,
  requireWorkflowGraph,
  richResponse,
} from "../helpers.ts";

const StartWorkflowArgsSchema = z.object({
  workflowId: z.string().min(1).describe("The unique identifier of the workflow to start."),
  format: z.enum(["markdown", "json", "both"]).optional().default("both").describe(
    "Optional output format. 'markdown' returns human-readable dashboard, 'json' returns raw data, 'both' (default) returns multi-block annotated content for user and assistant.",
  ),
});

export const startWorkflowTool = defineTool({
  name: "workflow_start",
  description:
    "Begins a new workflow execution. Validates the workflow graph structure, creates a unique execution ID scoped to this run, marks the start node as completed, and returns the initial actionable node(s) along with the execution ID (required for subsequent workflow_next calls), workflow status summary, and visual diagram. Multiple projects can start independent executions of the same workflow simultaneously.",
  schema: StartWorkflowArgsSchema,
  execute: async ({ workflowId, format }) => {
    const graphCheck = await requireWorkflowGraph(workflowId);
    if ("error" in graphCheck) return graphCheck.error;
    const { workflow, nodes, edges } = graphCheck;

    const validation = validateGraph(nodes, edges);
    if (!validation.valid) {
      return createErrorResponse(
        `Workflow validation failed: ${validation.errors.join("; ")}`,
      );
    }

    const startNode = nodes.find((n) => n.type === "start");
    if (!startNode) {
      return createErrorResponse("No start node found in workflow.");
    }

    const now = new Date().toISOString();
    const executionId = crypto.randomUUID();

    // Initialize execution with start node marked as completed
    const execution: WorkflowExecution = {
      id: executionId,
      workflowId,
      status: "in_progress",
      nodeStates: {
        [startNode.id]: {
          nodeId: startNode.id,
          status: "completed",
          error: null,
          iteration: 1,
          updatedAt: now,
        },
      },
      createdAt: now,
      updatedAt: now,
    };

    // Also mark the template start node as completed for backward compatibility
    // and so visualize_workflow without an executionId shows a sane state.
    startNode.status = "completed";
    startNode.updatedAt = now;
    await saveNode(startNode);

    const outboundEdges = edges.filter((e) => e.fromNodeId === startNode.id);
    const nodeMap = new Map<string, WorkflowNode>(nodes.map((n) => [n.id, n]));

    // Pass execution so edge-traversal writes into execution.nodeStates
    const { actionableNextNodes } = await advanceAcrossEdges(
      outboundEdges,
      nodeMap,
      now,
      execution,
    );
    const workflowComplete = actionableNextNodes.length === 0;

    if (workflowComplete) {
      execution.status = "completed";
      execution.updatedAt = now;
      await saveExecution(execution);
    }

    const hydratedNodes = hydrateNodesWithExecution(Array.from(nodeMap.values()), execution);
    const summary = computeWorkflowSummary(hydratedNodes);

    const responseData = {
      executionId,
      workflowId: workflow.id,
      workflowName: workflow.name,
      status: workflowComplete ? "completed" : "in_progress",
      startNode: {
        id: startNode.id,
        name: startNode.name,
        type: startNode.type,
        status: "completed",
      },
      nextNodes: actionableNextNodes.map(formatActionableNode),
      workflowComplete,
      workflowSummary: summary,
      validationWarnings: validation.warnings.length > 0 ? validation.warnings : undefined,
    };

    const markdown = formatWorkflowStartMarkdown(
      workflow,
      startNode,
      actionableNextNodes,
      summary,
      executionId,
      validation.warnings,
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
