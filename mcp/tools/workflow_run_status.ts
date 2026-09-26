import { z } from "zod";
import { listMessages } from "../../store/kv.ts";
import {
  defineTool,
  jsonResponse,
  requireExecution,
} from "../helpers.ts";

const WorkflowRunStatusSchema = z.object({
  executionId: z.string().min(1).describe(
    "The unique identifier of the workflow execution to inspect.",
  ),
});

export const workflowRunStatusTool = defineTool({
  name: "workflow_run_status",
  description:
    "Retrieves the comprehensive status of a workflow execution, including active node states (running, waiting_for_children, completed, pending, failed), shared runtime context, and recent message board highlights.",
  schema: WorkflowRunStatusSchema,
  execute: async ({ executionId }) => {
    const execCheck = await requireExecution(executionId);
    if ("error" in execCheck) return execCheck.error;

    const { execution, workflow, nodes } = execCheck;

    const recentMessages = await listMessages(executionId, {
      limit: 10,
      includeSubworkflows: true,
    });

    const nodesByStatus = {
      running: [] as Array<{
        id: string;
        name: string;
        type: string;
        role?: string;
        iteration?: number;
      }>,
      waiting_for_children: [] as Array<{
        id: string;
        name: string;
        type: string;
        role?: string;
        iteration?: number;
      }>,
      completed: [] as Array<{
        id: string;
        name: string;
        type: string;
        role?: string;
        iteration?: number;
      }>,
      pending: [] as Array<{
        id: string;
        name: string;
        type: string;
        role?: string;
        iteration?: number;
      }>,
      failed: [] as Array<{
        id: string;
        name: string;
        type: string;
        role?: string;
        iteration?: number;
        error?: string | null;
      }>,
      other: [] as Array<{
        id: string;
        name: string;
        type: string;
        role?: string;
        status: string;
        iteration?: number;
      }>,
    };

    for (const node of nodes) {
      const state = execution.nodeStates[node.id];
      const status = state?.status ?? "pending";
      const item = {
        id: node.id,
        name: node.name,
        type: node.type,
        role: node.role,
        iteration: state?.iteration ?? 0,
      };

      if (status === "running") {
        nodesByStatus.running.push(item);
      } else if (status === "waiting_for_children") {
        nodesByStatus.waiting_for_children.push(item);
      } else if (status === "completed") {
        nodesByStatus.completed.push(item);
      } else if (status === "pending") {
        nodesByStatus.pending.push(item);
      } else if (status === "failed") {
        nodesByStatus.failed.push({ ...item, error: state?.error ?? null });
      } else {
        nodesByStatus.other.push({ ...item, status });
      }
    }

    return jsonResponse({
      executionId: execution.id,
      workflowId: execution.workflowId,
      workflowName: workflow.name,
      status: execution.status,
      activeNodes: nodesByStatus.running,
      waitingNodes: nodesByStatus.waiting_for_children,
      completedNodes: nodesByStatus.completed,
      pendingNodes: nodesByStatus.pending,
      failedNodes: nodesByStatus.failed,
      nodesByStatus,
      nodeStates: execution.nodeStates,
      context: execution.context,
      parentExecutionId: execution.parentExecutionId,
      originTaskId: execution.originTaskId,
      originNodeId: execution.originNodeId,
      recentMessages,
      createdAt: execution.createdAt,
      updatedAt: execution.updatedAt,
      execution,
    });
  },
});
