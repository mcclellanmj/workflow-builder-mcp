import { z } from "zod";
import {
  addDependencies,
  computeReadyFrontier,
  type CreateTaskInput,
  createTasks,
  generateTaskId,
  getTasks,
} from "../../store/kv.ts";
import type { DependencyType, TaskId } from "../../store/types.ts";
import {
  createErrorResponse,
  createSuccessResponse,
  defineTool,
  jsonResponse,
  richResponse,
  toSlug,
} from "../helpers.ts";
import { resolveWorkflow } from "../resolvers.ts";
import { formatReadyFrontierMarkdown, resolveTask } from "./task_helpers.ts";

const TaskBatchItemSchema = z.object({
  tempId: z.string().optional().describe(
    "Optional temporary alias for referencing in dependencies (e.g. 'artist', 'qa', 'tk-1').",
  ),
  title: z.string().min(1).describe("The title or headline of the task."),
  description: z.string().optional().describe("Optional detailed description of the task."),
  role: z.string().optional().describe(
    "Optional user-defined role label (e.g. 'frontend', 'security-reviewer', 'artist').",
  ),
  priority: z.enum(["critical", "high", "medium", "low"]).optional().describe(
    "Optional task priority level.",
  ),
  type: z.enum(["task", "epic", "subtask", "bug"]).optional().describe(
    "Optional task type ('task', 'epic', 'subtask', or 'bug'). Defaults to 'task'.",
  ),
  parentTaskId: z.string().optional().describe(
    "Optional parent task ID, title, or tempId to nest this task under.",
  ),
  inputs: z.record(z.unknown()).optional().describe(
    "Optional structured input payload for the task.",
  ),
  metadata: z.record(z.unknown()).optional().describe(
    "Optional key-value metadata for the task.",
  ),
});

const TaskBatchDependencySchema = z.object({
  fromTask: z.string().min(1).describe(
    "The prerequisite task (blocker). Can be a tempId, title, or existing Task ID.",
  ),
  toTask: z.string().min(1).describe(
    "The dependent task (blocked). Can be a tempId, title, or existing Task ID.",
  ),
  type: z.enum([
    "blocks",
    "parent-child",
    "waits-for",
    "conditional-blocks",
    "discovered-from",
    "related",
  ]).optional().default("blocks").describe(
    "The type of dependency (defaults to 'blocks').",
  ),
});

const TaskCreateBatchSchema = z.object({
  tasks: z.array(TaskBatchItemSchema).min(1).describe(
    "Array of tasks to create in this batch.",
  ),
  dependencies: z.array(TaskBatchDependencySchema).optional().describe(
    "Optional array of dependency links between tasks in this batch or existing tasks.",
  ),
  workflow: z.string().optional().describe(
    "Optional workflow ID, name, or slug to link all tasks to.",
  ),
  workflowId: z.string().optional().describe(
    "Alias for 'workflow'.",
  ),
  executionId: z.string().optional().describe(
    "Optional execution ID to link all tasks to an active workflow execution run.",
  ),
  format: z.enum(["json", "markdown", "rich", "both"]).optional().default("json").describe(
    "Optional output format: 'json', 'markdown', 'rich', or 'both'. Defaults to 'json'.",
  ),
});

export const taskCreateBatchTool = defineTool({
  name: "task_create_batch",
  description:
    "Creates multiple tasks and sets up dependency links between them in a single batch operation.",
  schema: TaskCreateBatchSchema,
  execute: async ({
    tasks,
    dependencies,
    workflow,
    workflowId,
    executionId,
    format,
  }) => {
    let actualWorkflowId = workflowId ?? workflow;
    if (actualWorkflowId) {
      const resolvedWf = await resolveWorkflow(actualWorkflowId);
      if (resolvedWf) {
        actualWorkflowId = resolvedWf.id;
      }
    }

    // 1. Generate IDs and build alias lookup map for batch resolution
    const aliasMap = new Map<string, TaskId>();
    const taskPlans: Array<{
      id: TaskId;
      raw: z.infer<typeof TaskBatchItemSchema>;
    }> = [];

    for (const rawTask of tasks) {
      const generatedId = generateTaskId(rawTask.title);
      taskPlans.push({ id: generatedId, raw: rawTask });

      aliasMap.set(generatedId, generatedId);
      aliasMap.set(generatedId.toLowerCase(), generatedId);

      if (rawTask.tempId && rawTask.tempId.trim().length > 0) {
        const temp = rawTask.tempId.trim();
        aliasMap.set(temp, generatedId);
        aliasMap.set(temp.toLowerCase(), generatedId);
      }

      const trimmedTitle = rawTask.title.trim();
      if (trimmedTitle.length > 0) {
        aliasMap.set(trimmedTitle, generatedId);
        aliasMap.set(trimmedTitle.toLowerCase(), generatedId);
        aliasMap.set(toSlug(trimmedTitle), generatedId);
      }
    }

    // 2. Resolve parentTaskId for tasks if present
    const taskInputs: CreateTaskInput[] = [];
    for (const { id, raw } of taskPlans) {
      let resolvedParentId: TaskId | undefined;
      if (raw.parentTaskId && raw.parentTaskId.trim().length > 0) {
        const pKey = raw.parentTaskId.trim();
        const aliasParent = aliasMap.get(pKey) ??
          aliasMap.get(pKey.toLowerCase()) ??
          aliasMap.get(toSlug(pKey));
        if (aliasParent) {
          resolvedParentId = aliasParent;
        } else {
          const resolvedParent = await resolveTask(pKey);
          if (resolvedParent) {
            resolvedParentId = resolvedParent.id;
          } else {
            resolvedParentId = pKey;
          }
        }
      }

      taskInputs.push({
        id,
        title: raw.title.trim(),
        description: raw.description,
        role: raw.role?.trim(),
        priority: raw.priority,
        type: raw.type,
        parentTaskId: resolvedParentId,
        workflowId: actualWorkflowId,
        executionId,
        inputs: raw.inputs,
        metadata: raw.metadata,
      });
    }

    // 3. Persist batch of tasks
    const createdTasks = await createTasks(taskInputs);

    // 4. Resolve and create dependencies if provided
    const resolvedDeps: Array<{ fromTaskId: TaskId; toTaskId: TaskId; type: DependencyType }> = [];
    if (dependencies && dependencies.length > 0) {
      for (const dep of dependencies) {
        const fromKey = dep.fromTask.trim();
        let fromId = aliasMap.get(fromKey) ??
          aliasMap.get(fromKey.toLowerCase()) ??
          aliasMap.get(toSlug(fromKey));

        if (!fromId) {
          const resolvedFrom = await resolveTask(fromKey);
          if (resolvedFrom) {
            fromId = resolvedFrom.id;
          } else {
            return createErrorResponse(
              `Prerequisite task (fromTask) "${dep.fromTask}" not found.`,
            );
          }
        }

        const toKey = dep.toTask.trim();
        let toId = aliasMap.get(toKey) ??
          aliasMap.get(toKey.toLowerCase()) ??
          aliasMap.get(toSlug(toKey));

        if (!toId) {
          const resolvedTo = await resolveTask(toKey);
          if (resolvedTo) {
            toId = resolvedTo.id;
          } else {
            return createErrorResponse(
              `Dependent task (toTask) "${dep.toTask}" not found.`,
            );
          }
        }

        resolvedDeps.push({
          fromTaskId: fromId,
          toTaskId: toId,
          type: (dep.type as DependencyType) ?? "blocks",
        });
      }
    }

    const createdDeps = resolvedDeps.length > 0 ? await addDependencies(resolvedDeps) : [];

    // Re-fetch tasks so their status transitions (e.g. "blocked") are accurately reflected
    const finalTasks = createdDeps.length > 0
      ? await getTasks(taskPlans.map((t) => t.id))
      : createdTasks;

    // 5. Compute ready frontier after creating batch tasks and dependencies
    const readyTasks = await computeReadyFrontier({
      workflowId: actualWorkflowId,
      executionId,
    });

    const responseData = {
      tasks: finalTasks,
      dependencies: createdDeps,
      readyTasks,
      summary: {
        totalCreated: finalTasks.length,
        dependenciesCreated: createdDeps.length,
        readyCount: readyTasks.length,
      },
    };

    if (format === "json") {
      return jsonResponse(responseData);
    }

    // Format markdown output
    const lines: string[] = [
      `### 🚀 Batch Tasks Created (${finalTasks.length})`,
      "",
      "| ID | Title | Role | Priority | Status |",
      "|:---|:---|:---|:---|:---|",
    ];

    for (const t of finalTasks) {
      const roleStr = t.role || "-";
      const priorityStr = t.priority || "-";
      lines.push(`| \`${t.id}\` | ${t.title} | ${roleStr} | ${priorityStr} | \`${t.status}\` |`);
    }

    if (createdDeps.length > 0) {
      lines.push("");
      lines.push(`### 🔗 Dependencies Established (${createdDeps.length})`);
      lines.push("");
      for (const d of createdDeps) {
        lines.push(`- \`${d.fromTaskId}\` ➔ \`${d.toTaskId}\` (\`${d.type}\`)`);
      }
    }

    lines.push("");
    lines.push(formatReadyFrontierMarkdown(readyTasks));
    const markdown = lines.join("\n");

    if (format === "markdown") {
      return createSuccessResponse(markdown);
    }

    return richResponse({
      data: responseData,
      markdown,
      format: "both",
    });
  },
});
