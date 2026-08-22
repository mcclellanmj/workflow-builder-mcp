/**
 * Deno KV persistence for workflow execution run instances and indexing.
 */

import type { ExecutionId, WorkflowExecution, WorkflowId } from "../types.ts";
import { getKv, resolveUserId } from "./client.ts";

/** Saves a workflow execution (both the main record and the by-workflow index entry). */
export async function saveExecution(
  execution: WorkflowExecution,
  userId?: string,
): Promise<void> {
  const uid = resolveUserId(userId || execution.userId);
  execution.userId = uid;
  const kv = await getKv();
  await kv.atomic()
    .set(["users", uid, "executions", execution.id], execution)
    .set(["users", uid, "executions_by_workflow", execution.workflowId, execution.id], execution.id)
    .commit();
}

/** Retrieves a workflow execution by its ID. Returns null if not found. */
export async function getExecution(
  id: ExecutionId,
  userId?: string,
): Promise<WorkflowExecution | null> {
  const uid = resolveUserId(userId);
  const kv = await getKv();
  const entry = await kv.get<WorkflowExecution>(["users", uid, "executions", id]);
  return entry.value;
}

/**
 * Lists all workflow executions, optionally filtered to a specific workflow.
 * If workflowId is provided, uses the by-workflow index with batched lookups.
 */
export async function listExecutions(
  workflowId?: WorkflowId,
  options?: { userId?: string },
): Promise<WorkflowExecution[]> {
  const uid = resolveUserId(options?.userId);
  const kv = await getKv();
  const results: WorkflowExecution[] = [];

  if (workflowId) {
    const ids: string[] = [];
    for await (
      const entry of kv.list<string>({
        prefix: ["users", uid, "executions_by_workflow", workflowId],
      })
    ) {
      if (entry.value) {
        ids.push(entry.value);
      }
    }
    // Batch lookup using getMany in chunks of 128 keys
    for (let i = 0; i < ids.length; i += 128) {
      const chunk = ids.slice(i, i + 128);
      const keys = chunk.map((id) => ["users", uid, "executions", id]);
      const entries = await kv.getMany<WorkflowExecution[]>(keys);
      for (const entry of entries) {
        if (entry.value) {
          results.push(entry.value);
        }
      }
    }
  } else {
    for await (
      const entry of kv.list<WorkflowExecution>({ prefix: ["users", uid, "executions"] })
    ) {
      if (entry.value && typeof entry.value === "object") {
        results.push(entry.value);
      }
    }
  }

  return results;
}

/** Deletes a workflow execution by its ID (removes both the record and the by-workflow index entry). */
export async function deleteExecution(
  execution: WorkflowExecution,
  userId?: string,
): Promise<void> {
  const uid = resolveUserId(userId || execution.userId);
  const kv = await getKv();
  await kv.atomic()
    .delete(["users", uid, "executions", execution.id])
    .delete(["users", uid, "executions_by_workflow", execution.workflowId, execution.id])
    .commit();
}
