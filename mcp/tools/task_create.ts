import { z } from "zod";
import { createTask, listNodes } from "../../store/kv.ts";
import { defineTool, jsonResponse } from "../helpers.ts";
import { resolveNode, resolveWorkflow } from "../resolvers.ts";
import { resolveTask } from "./task_helpers.ts";

const TaskCreateSchema = z.object({
  title: z.string().min(1).describe("The title or headline of the task."),
  description: z.string().optional().describe("Optional detailed description of the task."),
  role: z.string().optional().describe(
    "Optional user-defined role label (e.g. 'frontend', 'security-reviewer', 'qa'). Auto-registers role if new.",
  ),
  priority: z.enum(["critical", "high", "medium", "low"]).optional().describe(
    "Optional task priority level.",
  ),
  type: z.enum(["task", "epic", "subtask", "bug"]).optional().describe(
    "Optional task type ('task', 'epic', 'subtask', or 'bug'). Defaults to 'task'.",
  ),
  parentTaskId: z.string().optional().describe(
    "Optional parent task ID to nest this task under (creates hierarchical parent-child relation).",
  ),
  originWorkflowId: z.string().optional().describe(
    "Optional origin workflow ID where this task was created or dispatched.",
  ),
  originExecutionId: z.string().optional().describe(
    "Optional origin workflow execution run ID.",
  ),
  originNodeId: z.string().optional().describe(
    "Optional origin workflow node ID that dispatched this task.",
  ),
  assignedWorkflowId: z.string().optional().describe(
    "Optional subworkflow ID assigned to accomplish this task.",
  ),
  workflow: z.string().optional().describe(
    "Alias for 'originWorkflowId'.",
  ),
  workflowId: z.string().optional().describe(
    "Alias for 'originWorkflowId'.",
  ),
  executionId: z.string().optional().describe(
    "Alias for 'originExecutionId'.",
  ),
  node: z.string().optional().describe(
    "Alias for 'originNodeId'.",
  ),
  nodeId: z.string().optional().describe(
    "Alias for 'originNodeId'.",
  ),
});

export const createTaskTool = defineTool({
  name: "task_create",
  description:
    "Creates a new single assignable task (unit of work). Returns { task: Task }. Tasks can be linked to origin workflows/executions or assigned a subworkflow to execute.",
  schema: TaskCreateSchema,
  execute: async ({
    title,
    description,
    role,
    priority,
    type,
    parentTaskId,
    originWorkflowId,
    originExecutionId,
    originNodeId,
    assignedWorkflowId,
    workflow,
    workflowId,
    executionId,
    node,
    nodeId,
  }) => {
    let actualWorkflowId = originWorkflowId ?? workflowId ?? workflow;
    if (actualWorkflowId) {
      const resolvedWf = await resolveWorkflow(actualWorkflowId);
      if (resolvedWf) {
        actualWorkflowId = resolvedWf.id;
      }
    }

    let actualNodeId = originNodeId ?? nodeId ?? node;
    if (actualNodeId && actualWorkflowId) {
      const nodes = await listNodes(actualWorkflowId);
      const resolvedNode = resolveNode(actualNodeId, nodes);
      if (resolvedNode) {
        actualNodeId = resolvedNode.id;
      }
    }

    let actualParentTaskId = parentTaskId;
    if (actualParentTaskId) {
      const resolvedParent = await resolveTask(actualParentTaskId);
      if (resolvedParent) {
        actualParentTaskId = resolvedParent.id;
      }
    }

    let actualAssignedWorkflowId = assignedWorkflowId;
    if (actualAssignedWorkflowId) {
      const resolvedAssignedWf = await resolveWorkflow(actualAssignedWorkflowId);
      if (resolvedAssignedWf) {
        actualAssignedWorkflowId = resolvedAssignedWf.id;
      }
    }

    const task = await createTask({
      title,
      description,
      role,
      priority,
      type,
      parentTaskId: actualParentTaskId,
      originWorkflowId: actualWorkflowId,
      originExecutionId: originExecutionId ?? executionId,
      originNodeId: actualNodeId,
      assignedWorkflowId: actualAssignedWorkflowId,
      workflowId: actualWorkflowId,
      executionId: originExecutionId ?? executionId,
      nodeId: actualNodeId,
    });

    return jsonResponse({ task });
  },
});
