/**
 * Helper utilities for Task MCP tools.
 * Includes task resolution by ID, title, or slug, and markdown formatters.
 */

import { getTask, listTasks } from "../../store/kv.ts";
import type { Task } from "../../store/types.ts";
import { toSlug } from "../resolvers.ts";

/**
 * Resolves a task by ID, exact title, or slug.
 */
export async function resolveTask(
  identifier: string,
  userId?: string,
): Promise<Task | null> {
  const trimmed = identifier.trim();
  if (!trimmed) return null;

  // 1. Direct KV lookup by ID
  const direct = await getTask(trimmed, userId);
  if (direct) return direct;

  // 2. Fetch all tasks for user
  const allTasks = await listTasks({}, { userId });
  if (allTasks.length === 0) return null;

  // 3. Exact ID match (case-insensitive)
  const idMatch = allTasks.find(
    (t) => t.id.toLowerCase() === trimmed.toLowerCase(),
  );
  if (idMatch) return idMatch;

  // 4. Exact Title Match
  const titleMatch = allTasks.find(
    (t) => t.title.toLowerCase() === trimmed.toLowerCase(),
  );
  if (titleMatch) return titleMatch;

  // 5. Slug Match on Title
  const targetSlug = toSlug(trimmed);
  const slugMatch = allTasks.find((t) => toSlug(t.title) === targetSlug);
  if (slugMatch) return slugMatch;

  return null;
}

/**
 * Formats a list of tasks into a Markdown summary table.
 */
export function formatTaskListMarkdown(
  tasks: Task[],
  summary: {
    total: number;
    open: number;
    claimed: number;
    in_progress: number;
    blocked: number;
    review: number;
    closed: number;
    wontfix: number;
  },
): string {
  if (tasks.length === 0) {
    return "No tasks found matching the specified criteria.";
  }

  const lines: string[] = [
    `### Tasks (${summary.total} total)`,
    "",
    `**Summary**: ${summary.open} open, ${summary.claimed} claimed, ${summary.in_progress} in progress, ${summary.blocked} blocked, ${summary.review} in review, ${summary.closed} closed, ${summary.wontfix} wontfix`,
    "",
    "| ID | Title | Status | Role | Assignee | Priority |",
    "|:---|:---|:---|:---|:---|:---|",
  ];

  for (const t of tasks) {
    const roleStr = t.role || "-";
    const assigneeStr = t.assignee || "-";
    const priorityStr = t.priority || "-";
    const titleStr = t.type === "epic" ? `📦 **[Epic]** ${t.title}` : t.title;
    lines.push(
      `| \`${t.id}\` | ${titleStr} | \`${t.status}\` | ${roleStr} | ${assigneeStr} | ${priorityStr} |`,
    );
  }

  return lines.join("\n");
}

/**
 * Formats the ready frontier tasks into a Markdown view.
 */
export function formatReadyFrontierMarkdown(tasks: Task[]): string {
  if (tasks.length === 0) {
    return "No tasks currently ready in the frontier. All remaining tasks are either claimed, closed, or blocked by dependencies.";
  }

  const lines: string[] = [
    `### Ready Frontier (${tasks.length} available)`,
    "",
    "The following tasks have no unresolved blockers and are ready to be claimed:",
    "",
    "| ID | Title | Role | Priority | Status |",
    "|:---|:---|:---|:---|:---|",
  ];

  for (const t of tasks) {
    const roleStr = t.role || "-";
    const priorityStr = t.priority || "-";
    lines.push(
      `| \`${t.id}\` | ${t.title} | ${roleStr} | ${priorityStr} | \`${t.status}\` |`,
    );
  }

  lines.push("");
  lines.push('💡 *Claim a task with `task_claim({ task: "<id>", assignee: "<agent-id>" })`.*');

  return lines.join("\n");
}
