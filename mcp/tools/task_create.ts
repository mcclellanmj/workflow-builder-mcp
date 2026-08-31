import { z } from "zod";
import { createTask, listNodes } from "../../store/kv.ts";
import { defineTool, jsonResponse } from "../helpers.ts";
import { resolveNode, resolveWorkflow } from "../resolvers.ts";
import { resolveTask } from "./task_helpers.ts";

const TaskCreateSchema = z.object({
  title: z.string().min(1).describe("The title or headline of the task."),
  description: z.string().optional().describe("Optional detailed description of the task."),
  role: z.string().optional().describe(
    "Optional user-defined role label (e.g. 'frontend', 'security-reviewer', 'human'). Auto-registers role if new.",
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
  workflow: z.string().optional().describe(
    "Optional workflow ID, name, or slug to link this task to.",
  ),
  workflowId: z.string().optional().describe(
    "Alias for 'workflow'.",
  ),
  executionId: z.string().optional().describe(
    "Optional execution ID to link this task to an active workflow execution run.",
  ),
  node: z.string().optional().describe(
    "Optional node ID, name, or slug to link this task to a specific workflow step.",
  ),
  nodeId: z.string().optional().describe(
    "Alias for 'node'.",
  ),
  pipelineTemplateId: z.string().optional().describe(
    "Optional FlowTemplate ID (e.g. 'unity-dev-playtest-qa', 'code-review-audit', 'hotfix-fast-track', 'research-spec-impl') to initialize a multi-stage pipeline.",
  ),
});

export const createTaskTool = defineTool({
  name: "task_create",
  description:
    "Creates a new assignable task (unit of work). Tasks can be standalone or linked to workflows, executions, and nodes. Supports roles, priorities, and parent-child hierarchies.",
  schema: TaskCreateSchema,
  execute: async ({
    title,
    description,
    role,
    priority,
    type,
    parentTaskId,
    workflow,
    workflowId,
    executionId,
    node,
    nodeId,
    pipelineTemplateId,
  }) => {
    let actualWorkflowId = workflowId ?? workflow;
    if (actualWorkflowId) {
      const resolvedWf = await resolveWorkflow(actualWorkflowId);
      if (resolvedWf) {
        actualWorkflowId = resolvedWf.id;
      }
    }

    let actualNodeId = nodeId ?? node;
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

    const task = await createTask({
      title,
      description,
      role,
      priority,
      type,
      parentTaskId: actualParentTaskId,
      workflowId: actualWorkflowId,
      executionId,
      nodeId: actualNodeId,
      pipelineTemplateId,
    });

    return jsonResponse({ task });
  },
});
