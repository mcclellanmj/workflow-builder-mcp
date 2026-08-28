import { z } from "zod";
import { addDependency, getTask, removeDependency } from "../../store/kv.ts";
import type { DependencyType } from "../../store/types.ts";
import { createErrorResponse, defineTool, jsonResponse } from "../helpers.ts";
import { resolveTask } from "./task_helpers.ts";

const TaskDependSchema = z.object({
  action: z.enum(["add", "remove"]).describe(
    "Whether to 'add' or 'remove' the dependency relationship.",
  ),
  fromTask: z.string().min(1).describe(
    "The prerequisite task (the blocker/source). Accepts task ID, title, or slug.",
  ),
  toTask: z.string().min(1).describe(
    "The dependent task (the blocked/target). Accepts task ID, title, or slug.",
  ),
  type: z.enum([
    "blocks",
    "parent-child",
    "waits-for",
    "conditional-blocks",
    "discovered-from",
    "related",
  ]).optional().default("blocks").describe(
    "The type of dependency (defaults to 'blocks'). 'blocks' and 'waits-for' enforce ready frontier ordering.",
  ),
});

export const dependTaskTool = defineTool({
  name: "task_depend",
  description:
    "Adds or removes a typed dependency edge between two tasks. Adding a blocking dependency automatically marks the target task as 'blocked' if open. Removing a dependency unblocks downstream tasks if all blockers are resolved.",
  schema: TaskDependSchema,
  execute: async ({ action, fromTask, toTask, type }) => {
    const [resolvedFrom, resolvedTo] = await Promise.all([
      resolveTask(fromTask),
      resolveTask(toTask),
    ]);

    if (!resolvedFrom) {
      return createErrorResponse(
        `Prerequisite task (fromTask) "${fromTask}" not found.`,
      );
    }
    if (!resolvedTo) {
      return createErrorResponse(
        `Dependent task (toTask) "${toTask}" not found.`,
      );
    }

    if (action === "add") {
      const dep = await addDependency(
        resolvedFrom.id,
        resolvedTo.id,
        type as DependencyType,
      );
      const updatedTarget = await getTask(resolvedTo.id);
      return jsonResponse({
        action: "add",
        dependency: dep,
        affectedTasks: updatedTarget ? [updatedTarget] : [],
      });
    } else {
      await removeDependency(resolvedFrom.id, resolvedTo.id);
      const updatedTarget = await getTask(resolvedTo.id);
      return jsonResponse({
        action: "remove",
        affectedTasks: updatedTarget ? [updatedTarget] : [],
      });
    }
  },
});
