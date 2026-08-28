import { z } from "zod";
import { hydrateWorkflowToEpic } from "../../store/kv.ts";
import { defineTool, richResponse } from "../helpers.ts";

const WorkflowHydrateArgsSchema = z.object({
  workflow: z.string().min(1).optional().describe(
    "The unique identifier, name, or slug of the workflow to hydrate into an Epic and Task DAG.",
  ),
  workflowId: z.string().min(1).optional().describe(
    "Alias for 'workflow'. The unique identifier, name, or slug of the workflow.",
  ),
  title: z.string().optional().describe(
    "Optional custom title for the hydrated root Epic (defaults to workflow name).",
  ),
  description: z.string().optional().describe(
    "Optional custom description for the hydrated root Epic.",
  ),
  parentTaskId: z.string().optional().describe(
    "Optional parent task or epic ID to nest this hydrated epic under.",
  ),
  role: z.string().optional().describe(
    "Optional default role to assign to hydrated tasks that do not specify a role.",
  ),
  priority: z.enum(["critical", "high", "medium", "low"]).optional().describe(
    "Optional priority level for the root epic (e.g. 'critical', 'high', 'medium', 'low').",
  ),
  format: z.enum(["markdown", "json", "both"]).optional().default("both").describe(
    "Optional output format. 'markdown' returns human-readable dashboard, 'json' returns raw data, 'both' (default) returns multi-block annotated content for user and assistant.",
  ),
}).refine((data) => data.workflow || data.workflowId, {
  message: "Workflow ('workflow' or 'workflowId') must be provided.",
});

export function formatHydrationMarkdown(
  result: Awaited<ReturnType<typeof hydrateWorkflowToEpic>>,
): string {
  let md = `## 🚀 Workflow Hydrated into Epic: **${result.epic.title}**\n\n`;
  md += `> **Root Epic ID**: \`${result.epic.id}\` | **Status**: \`${result.epic.status}\`\n\n`;
  md += `### 📊 Summary\n`;
  md += `- **Epics Created**: ${result.summary.totalEpics}\n`;
  md += `- **Tasks Created**: ${result.summary.totalTasks}\n`;
  md += `- **Dependency Edges**: ${result.summary.totalDependencies}\n`;
  md += `- **Ready Frontier**: ${result.summary.readyTasksCount} task(s) unblocked\n\n`;

  if (result.readyTasks.length > 0) {
    md += `### 🎯 Ready to Work Immediately\n`;
    md += `| Task ID | Title | Role | Priority | Status |\n`;
    md += `|:---|:---|:---|:---|:---|\n`;
    for (const t of result.readyTasks) {
      const roleStr = t.role || "-";
      const prioStr = t.priority || "-";
      md += `| \`${t.id}\` | ${t.title} | ${roleStr} | ${prioStr} | \`${t.status}\` |\n`;
    }
    md += `\n`;
  }

  if (result.epics.length > 1) {
    md += `### 📦 Subworkflow Epics\n`;
    for (const e of result.epics) {
      if (e.id === result.epic.id) continue;
      md += `- \`${e.id}\`: **${e.title}** (Parent: \`${e.parentTaskId}\`)\n`;
    }
    md += `\n`;
  }

  md += `### 💡 Recommended Next Steps\n`;
  md +=
    `1. Discover ready work across queues: \`task_ready({ workflowId: "${result.epic.workflowId}" })\`\n`;
  if (result.readyTasks[0]) {
    md += `2. Claim work: \`task_claim({ task: "${
      result.readyTasks[0].id
    }", assignee: "<agent-id>" })\`\n`;
  } else {
    md += `2. Claim work: \`task_claim({ task: "<taskId>", assignee: "<agent-id>" })\`\n`;
  }
  md +=
    `3. Close work when completed: \`task_close({ task: "<taskId>", reason: "Verified" })\` (automatically unblocks downstream tasks)\n`;

  return md;
}

export const workflowHydrateTool = defineTool({
  name: "workflow_hydrate",
  description:
    "Hydrates a workflow template DAG into an actionable Epic and Task DAG. Each workflow node becomes an assignable task; nested subworkflows hydrate into nested child Epics ('an epic in an epic'); and graph edges map to directional blocking dependencies. Returns the root Epic, nested Epics, tasks, dependencies, and the immediate ready frontier of unblocked tasks ready to be worked on.",
  schema: WorkflowHydrateArgsSchema,
  execute: async ({
    workflow,
    workflowId,
    title,
    description,
    parentTaskId,
    role,
    priority,
    format,
  }) => {
    const targetWorkflow = (workflow ?? workflowId)!.trim();

    try {
      const result = await hydrateWorkflowToEpic({
        workflow: targetWorkflow,
        title,
        description,
        parentTaskId,
        role,
        priority,
      });

      const markdown = formatHydrationMarkdown(result);

      return richResponse({
        data: result,
        markdown,
        format,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [{ type: "text", text: `Failed to hydrate workflow: ${msg}` }],
      };
    }
  },
});
