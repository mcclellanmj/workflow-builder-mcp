import { z } from "zod";
import {
  createExecution,
  listEdges,
  listNodes,
  transitionNodeState,
} from "../../store/kv.ts";
import {
  createErrorResponse,
  defineTool,
  findNextNodes,
  jsonResponse,
  resolveWorkflow,
} from "../helpers.ts";

const WorkflowRunStartSchema = z.object({
  workflowId: z.string().min(1).describe(
    "The unique workflow ID, exact name, or slug of the workflow to run.",
  ),
  initialContext: z.record(z.unknown()).optional().describe(
    "Optional initial shared runtime context dictionary for the execution.",
  ),
  parentExecutionId: z.string().optional().describe(
    "Optional parent execution ID if this run is a subworkflow execution.",
  ),
  originTaskId: z.string().optional().describe(
    "Optional origin task ID if this execution was created to accomplish a task.",
  ),
  originNodeId: z.string().optional().describe(
    "Optional origin node ID in the parent workflow execution.",
  ),
});

export const workflowRunStartTool = defineTool({
  name: "workflow_run_start",
  description:
    "Starts a new execution run of a workflow. Initializes runtime context, records parent linkages, completes the start node, and activates downstream initial nodes.",
  schema: WorkflowRunStartSchema,
  execute: async ({
    workflowId,
    initialContext,
    parentExecutionId,
    originTaskId,
    originNodeId,
  }) => {
    const workflow = await resolveWorkflow(workflowId);
    if (!workflow) {
      return createErrorResponse(
        `Workflow "${workflowId}" not found. You can specify a workflow UUID, exact name, or slug.`,
      );
    }

    let execution = await createExecution({
      workflowId: workflow.id,
      initialContext: initialContext ?? {},
      parentExecutionId,
      originTaskId,
      originNodeId,
    });

    const [nodes, edges] = await Promise.all([
      listNodes(workflow.id),
      listEdges(workflow.id),
    ]);

    const startNode = nodes.find((n) => n.type === "start");
    let activatedNodes: typeof nodes = [];

    if (startNode) {
      execution = await transitionNodeState({
        executionId: execution.id,
        nodeId: startNode.id,
        status: "completed",
      });

      const nextNodes = await findNextNodes(
        execution,
        startNode.id,
        undefined,
        nodes,
        edges,
      );

      for (const nextNode of nextNodes) {
        execution = await transitionNodeState({
          executionId: execution.id,
          nodeId: nextNode.id,
          status: "running",
        });
      }
      activatedNodes = nextNodes;
    }

    const runningNodes = nodes
      .filter((n) => execution.nodeStates[n.id]?.status === "running")
      .map((n) => ({
        id: n.id,
        name: n.name,
        type: n.type,
        role: n.role,
      }));

    return jsonResponse({
      executionId: execution.id,
      workflowId: workflow.id,
      workflowName: workflow.name,
      status: execution.status,
      activeNodes: runningNodes,
      activatedNodes: activatedNodes.map((n) => ({
        id: n.id,
        name: n.name,
        type: n.type,
        role: n.role,
      })),
      context: execution.context,
      parentExecutionId: execution.parentExecutionId,
      originTaskId: execution.originTaskId,
      originNodeId: execution.originNodeId,
      execution,
    });
  },
});
