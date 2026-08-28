import { z } from "zod";
import { listTasks } from "../../store/kv.ts";
import type { TaskStatus } from "../../store/types.ts";
import { defineTool, richResponse } from "../helpers.ts";
import { resolveWorkflow } from "../resolvers.ts";
import { formatTaskListMarkdown, resolveTask } from "./task_helpers.ts";

const TaskListSchema = z.object({
  workflow: z.string().optional().describe(
    "Optional workflow ID, name, or slug to filter tasks by.",
  ),
  workflowId: z.string().optional().describe(
    "Alias for 'workflow'.",
  ),
  executionId: z.string().optional().describe(
    "Optional execution ID to filter tasks by.",
  ),
  status: z.union([
    z.string(),
    z.array(z.string()),
  ]).optional().describe(
    "Optional status filter. E.g. 'open', 'claimed', 'in_progress', 'blocked', 'closed', or comma-separated.",
  ),
  role: z.string().optional().describe(
    "Optional role name to filter tasks by.",
  ),
  assignee: z.string().optional().describe(
    "Optional assignee identifier to filter tasks by.",
  ),
  parentTaskId: z.string().optional().describe(
    "Optional parent task ID to list child subtasks.",
  ),
  format: z.enum(["markdown", "json", "both"]).optional().default("both").describe(
    "Optional output format: 'markdown', 'json', or 'both' (default).",
  ),
}).optional().default({});

export const listTasksTool = defineTool({
  name: "task_list",
  description:
    "Lists tasks matching specified filter criteria (workflow, execution, status, role, assignee, or parent task). Returns the list of tasks and a summary of counts by status.",
  schema: TaskListSchema,
  execute: async ({
    workflow,
    workflowId,
    executionId,
    status,
    role,
    assignee,
    parentTaskId,
    format,
  }) => {
    let actualWorkflowId = workflowId ?? workflow;
    if (actualWorkflowId) {
      const resolvedWf = await resolveWorkflow(actualWorkflowId);
      if (resolvedWf) {
        actualWorkflowId = resolvedWf.id;
      }
    }

    let actualParentTaskId = parentTaskId;
    if (actualParentTaskId) {
      const resolvedParent = await resolveTask(actualParentTaskId);
      if (resolvedParent) {
        actualParentTaskId = resolvedParent.id;
      }
    }

    let parsedStatus: TaskStatus | TaskStatus[] | undefined = undefined;
    if (status) {
      if (Array.isArray(status)) {
        parsedStatus = status as TaskStatus[];
      } else if (status.includes(",")) {
        parsedStatus = status.split(",").map((s) => s.trim()) as TaskStatus[];
      } else {
        parsedStatus = status as TaskStatus;
      }
    }

    const tasks = await listTasks({
      workflowId: actualWorkflowId,
      executionId,
      status: parsedStatus,
      role,
      assignee,
      parentTaskId: actualParentTaskId,
    });

    const summary = {
      total: tasks.length,
      open: tasks.filter((t) => t.status === "open").length,
      claimed: tasks.filter((t) => t.status === "claimed").length,
      in_progress: tasks.filter((t) => t.status === "in_progress").length,
      blocked: tasks.filter((t) => t.status === "blocked").length,
      review: tasks.filter((t) => t.status === "review").length,
      closed: tasks.filter((t) => t.status === "closed").length,
      wontfix: tasks.filter((t) => t.status === "wontfix").length,
    };

    const markdown = formatTaskListMarkdown(tasks, summary);

    return richResponse({
      data: { tasks, summary },
      markdown,
      format,
    });
  },
});
