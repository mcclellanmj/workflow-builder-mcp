import { z } from "zod";
import type { Task, TaskPipeline } from "../../store/types.ts";
import { createErrorResponse, defineTool, jsonResponse } from "../helpers.ts";
import { resolveTask } from "./task_helpers.ts";

const TaskPipelineStatusSchema = z.object({
  task: z.string().min(1).optional().describe(
    "The unique task ID (e.g. 'tk-a1b2c3'), exact title, or slug of the task.",
  ),
  taskId: z.string().min(1).optional().describe("Alias for 'task'."),
  format: z.enum(["json", "markdown", "both"]).optional().default("both").describe(
    "Output format ('json', 'markdown', or 'both'). Defaults to 'both'.",
  ),
}).refine((data) => data.task || data.taskId, {
  message: "Either 'task' or 'taskId' must be provided.",
});

export function formatPipelineStatusMarkdown(task: Task): string {
  const lines: string[] = [
    `## 🔄 Pipeline Status: **${task.title}** (\`${task.id}\`)`,
    "",
    `**Overall Task Status**: \`${task.status}\` | **Current Role**: \`${
      task.role || "unassigned"
    }\` | **Assignee**: \`${task.assignee || "unassigned"}\``,
    "",
  ];

  if (!task.pipeline) {
    lines.push("> [!NOTE]");
    lines.push("> This task is currently **unpipelined** (standalone work item).");
    lines.push("> Attach a multi-stage flow template using `task_pipeline_attach`.");
    return lines.join("\n");
  }

  const pipeline = task.pipeline;
  const stages = pipeline.stages || [];
  const currentIdx = pipeline.currentStageIndex ?? 0;
  const activeStage = stages[currentIdx];

  const completedCount = stages.filter((s) => s.status === "completed").length;
  const totalCount = stages.length;
  const percent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  const rejectionCount = pipeline.rejectionCount ?? 0;
  const maxRejections = pipeline.maxRejectionCycles ?? 3;
  const isTripped = rejectionCount >= maxRejections;

  lines.push(
    `### 📊 Pipeline Progress: ${percent}% (${completedCount}/${totalCount} stages completed)`,
  );
  lines.push(
    `- **Template**: \`${pipeline.templateId || "custom"}\` (v${
      pipeline.templateVersion || "1.0.0"
    })`,
  );
  lines.push(
    `- **Active Stage**: **${
      activeStage?.name || activeStage?.id || "None"
    }** (\`${activeStage?.id}\`)`,
  );
  lines.push(
    `- **Rejection Loop Policy**: \`${pipeline.rejectionLoopPolicy || "rollback_to_stage"}\``,
  );
  lines.push(
    `- **Rejection Cycles**: ${rejectionCount} / ${maxRejections} ${
      isTripped ? "⚠️ **[CIRCUIT BREAKER TRIPPED]**" : ""
    }`,
  );
  lines.push("");

  lines.push("### 🪜 Stages Matrix");
  lines.push("| # | Stage ID | Name | Role | Status | Assignee | Completed At |");
  lines.push("|:---|:---|:---|:---|:---|:---|:---|");

  stages.forEach((st, idx) => {
    const isCurrent = idx === currentIdx;
    const statusIcon = st.status === "completed"
      ? "✅"
      : st.status === "active"
      ? "🔄"
      : st.status === "rejected"
      ? "❌"
      : st.status === "skipped"
      ? "⏭️"
      : "⏳";
    const currentMarker = isCurrent ? "👉 " : "";
    const assigneeStr = st.assignee || "-";
    const completedStr = st.completedAt ? st.completedAt.slice(0, 19).replace("T", " ") : "-";

    lines.push(
      `| ${
        idx + 1
      } | \`${st.id}\` | ${currentMarker}**${st.name}** | \`${st.role}\` | ${statusIcon} \`${st.status}\` | ${assigneeStr} | ${completedStr} |`,
    );
  });
  lines.push("");

  if (activeStage && activeStage.allowedTransitions && activeStage.allowedTransitions.length > 0) {
    lines.push("### 🔀 Active Stage Allowed Transitions");
    for (const tr of activeStage.allowedTransitions) {
      const rolesInfo = tr.allowedRoles && tr.allowedRoles.length > 0
        ? ` (roles: ${tr.allowedRoles.join(", ")})`
        : "";
      lines.push(`- \`${tr.action}\` ➔ \`${tr.targetStageId}\`${rolesInfo}`);
    }
    lines.push("");
  }

  if (task.acceptanceNotes && task.acceptanceNotes.length > 0) {
    lines.push("### 📝 Accumulated Acceptance Notes");
    for (const note of task.acceptanceNotes) {
      lines.push(`- ${note}`);
    }
    lines.push("");
  }

  if (task.rejectedApproaches && task.rejectedApproaches.length > 0) {
    lines.push("### ⚠️ Rejected Approaches (Do Not Repeat)");
    for (const app of task.rejectedApproaches) {
      lines.push(`- ❌ ${app}`);
    }
    lines.push("");
  }

  const history = pipeline.history || [];
  if (history.length > 0) {
    lines.push(`### 📜 Transition & Override Audit Log (${history.length} events)`);
    lines.push("| Time | Action | Transition | Triggered By | Reason |");
    lines.push("|:---|:---|:---|:---|:---|");
    for (const h of history) {
      const timeStr = h.timestamp.slice(0, 19).replace("T", " ");
      const transitionStr = `\`${h.fromStageId}\` ➔ \`${h.toStageId}\``;
      lines.push(
        `| ${timeStr} | \`${h.action}\` | ${transitionStr} | \`${h.triggeredBy}\` | ${
          h.reason.replace(/\|/g, "/")
        } |`,
      );
    }
  }

  return lines.join("\n");
}

export const taskPipelineStatusTool = defineTool({
  name: "task_pipeline_status",
  description:
    "Returns a formatted diagnostic inspection of a task's pipeline progress, active stage, role constraints, transition matrix, and transition audit history.",
  schema: TaskPipelineStatusSchema,
  execute: async ({ task, taskId, format }) => {
    const identifier = (taskId ?? task)!.trim();
    const resolved = await resolveTask(identifier);
    if (!resolved) {
      return createErrorResponse(
        `Task "${identifier}" not found. Specify a valid task ID or title.`,
      );
    }

    const pipeline: TaskPipeline | undefined = resolved.pipeline;
    const stages = pipeline?.stages || [];
    const currentIdx = pipeline?.currentStageIndex ?? 0;
    const activeStage = stages[currentIdx];

    const completedCount = stages.filter((s) => s.status === "completed").length;
    const totalCount = stages.length;
    const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
    const isCircuitBreakerTripped = Boolean(
      pipeline && (pipeline.rejectionCount ?? 0) >= (pipeline.maxRejectionCycles ?? 3),
    );

    const diagnostic = {
      task: {
        id: resolved.id,
        title: resolved.title,
        status: resolved.status,
        role: resolved.role,
        assignee: resolved.assignee,
      },
      isPipelined: Boolean(pipeline),
      pipeline: pipeline
        ? {
          templateId: pipeline.templateId,
          templateVersion: pipeline.templateVersion,
          strictMode: pipeline.strictMode,
          progressPercent,
          completedStages: completedCount,
          totalStages: totalCount,
          currentStageIndex: currentIdx,
          currentStageId: pipeline.currentStageId,
          activeStage,
          rejectionCount: pipeline.rejectionCount ?? 0,
          maxRejectionCycles: pipeline.maxRejectionCycles ?? 3,
          isCircuitBreakerTripped,
          rejectionLoopPolicy: pipeline.rejectionLoopPolicy,
          stages,
          historyCount: pipeline.history?.length ?? 0,
          latestAudit: pipeline.history?.[(pipeline.history?.length ?? 1) - 1],
        }
        : null,
      acceptanceNotes: resolved.acceptanceNotes ?? [],
      rejectedApproaches: resolved.rejectedApproaches ?? [],
    };

    const markdown = formatPipelineStatusMarkdown(resolved);

    if (format === "json") {
      return jsonResponse(diagnostic);
    }

    if (format === "markdown") {
      return {
        content: [{ type: "text", text: markdown }],
      };
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(diagnostic, null, 2),
        },
        {
          type: "text",
          text: markdown,
        },
      ],
    };
  },
});
