import { z } from "zod";
import {
  patchExecutionContext,
  transitionNodeState,
} from "../../store/kv.ts";
import type { DecisionConfig, WorkflowNode } from "../../store/types.ts";
import {
  createErrorResponse,
  defineTool,
  findNextNodes,
  jsonResponse,
  requireExecution,
  resolveNode,
} from "../helpers.ts";
import { evaluateDecisionNode } from "../evaluator.ts";

const WorkflowStepAdvanceSchema = z.object({
  executionId: z.string().min(1).describe(
    "The unique identifier of the workflow execution to advance.",
  ),
  nodeId: z.string().min(1).describe(
    "The ID, exact name, or slug of the node being advanced.",
  ),
  status: z.enum(["completed", "failed", "waiting_for_children"]).default("completed").describe(
    "Target status for the node (completed, failed, or waiting_for_children).",
  ),
  data: z.record(z.unknown()).optional().describe(
    "Step output data (used for decision evaluation or logging).",
  ),
  contextDelta: z.record(z.unknown()).optional().describe(
    "Context mutations to patch into the execution ($set, $push, or deep-merge).",
  ),
  feedback: z.string().optional().describe(
    "Feedback or rejection notes to preserve in iteration history.",
  ),
  error: z.string().optional().describe(
    "Error details if the step failed.",
  ),
});

export const workflowStepAdvanceTool = defineTool({
  name: "workflow_step_advance",
  description:
    "Advances a step in a workflow execution. Evaluates decision conditions, patches runtime context, records iteration history with feedback, transitions node status, and activates eligible downstream nodes satisfying barrier policies.",
  schema: WorkflowStepAdvanceSchema,
  execute: async ({
    executionId,
    nodeId,
    status,
    data,
    contextDelta,
    feedback,
    error,
  }) => {
    const execCheck = await requireExecution(executionId);
    if ("error" in execCheck) return execCheck.error;

    let { execution, workflow, nodes, edges } = execCheck;

    const node = resolveNode(nodeId, nodes);
    if (!node) {
      return createErrorResponse(
        `Node "${nodeId}" not found in workflow "${workflow.name}" (${workflow.id}).`,
      );
    }

    // 1. Evaluate decision condition if node is a decision node
    let condition: string | undefined;
    if (node.type === "decision") {
      condition = evaluateDecisionNode(
        (node.config ?? {}) as unknown as DecisionConfig,
        data ?? {},
        execution.context ?? {},
      );
    }

    // 2. Patch execution context if delta provided
    if (contextDelta && Object.keys(contextDelta).length > 0) {
      execution = await patchExecutionContext(executionId, contextDelta);
    }

    // 3. Transition node status and record feedback / diff in iteration history
    execution = await transitionNodeState({
      executionId,
      nodeId: node.id,
      status,
      error,
      feedback,
      contextDiff: contextDelta,
    });

    // 4. If step completed, find next eligible nodes satisfying barrier policies and activate them
    let activatedNodes: WorkflowNode[] = [];
    if (status === "completed") {
      const nextNodes = await findNextNodes(
        execution,
        node.id,
        condition,
        nodes,
        edges,
      );

      for (const nextNode of nextNodes) {
        execution = await transitionNodeState({
          executionId,
          nodeId: nextNode.id,
          status: "running",
        });
      }
      activatedNodes = nextNodes;
    }

    return jsonResponse({
      executionId: execution.id,
      node: {
        id: node.id,
        name: node.name,
        type: node.type,
        role: node.role,
        state: execution.nodeStates[node.id],
      },
      condition: condition ?? null,
      activatedNodes: activatedNodes.map((n) => ({
        id: n.id,
        name: n.name,
        type: n.type,
        role: n.role,
      })),
      context: execution.context,
      execution,
    });
  },
});
