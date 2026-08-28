import { z } from "zod";
import { computeReadyFrontier } from "../../store/kv.ts";
import { defineTool, richResponse } from "../helpers.ts";
import { resolveWorkflow } from "../resolvers.ts";
import { formatReadyFrontierMarkdown } from "./task_helpers.ts";

const TaskReadySchema = z.object({
  workflow: z.string().optional().describe(
    "Optional workflow ID, name, or slug to scope the ready frontier.",
  ),
  workflowId: z.string().optional().describe(
    "Alias for 'workflow'.",
  ),
  executionId: z.string().optional().describe(
    "Optional execution ID to scope the ready frontier to a specific run.",
  ),
  role: z.string().optional().describe(
    "Optional role name to filter claimable tasks for a specific role.",
  ),
  limit: z.number().int().positive().optional().describe(
    "Optional maximum number of ready tasks to return.",
  ),
  format: z.enum(["markdown", "json", "both"]).optional().default("both").describe(
    "Optional output format: 'markdown', 'json', or 'both' (default).",
  ),
}).optional().default({});

export const readyTasksTool = defineTool({
  name: "task_ready",
  description:
    "Computes the claimable ready frontier of tasks with zero unresolved blockers. This is the primary tool agents use to discover available work.",
  schema: TaskReadySchema,
  execute: async ({ workflow, workflowId, executionId, role, limit, format }) => {
    let actualWorkflowId = workflowId ?? workflow;
    if (actualWorkflowId) {
      const resolvedWf = await resolveWorkflow(actualWorkflowId);
      if (resolvedWf) {
        actualWorkflowId = resolvedWf.id;
      }
    }

    const readyTasks = await computeReadyFrontier({
      workflowId: actualWorkflowId,
      executionId,
      role,
      limit,
    });

    const markdown = formatReadyFrontierMarkdown(readyTasks);

    return richResponse({
      data: {
        readyTasks,
        frontierSize: readyTasks.length,
      },
      markdown,
      format,
    });
  },
});
