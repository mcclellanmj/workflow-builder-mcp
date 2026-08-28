/**
 * Deno KV persistence for workflow aggregates.
 */

import type { Workflow, WorkflowId, WorkflowNode } from "../types.ts";
import { getKv, listEntries, type ListOptions, MAX_ATOMIC_OPS, resolveUserId } from "./client.ts";
import { invalidateWorkflowCache } from "../../mcp/resolvers.ts";

export async function saveWorkflow(workflow: Workflow, userId?: string): Promise<void> {
  const uid = resolveUserId(userId || workflow.userId);
  workflow.userId = uid;
  const kv = await getKv();
  await kv.set(["users", uid, "workflows", workflow.id], workflow);
  invalidateWorkflowCache(uid);
}

export async function getWorkflow(id: WorkflowId, userId?: string): Promise<Workflow | null> {
  const uid = resolveUserId(userId);
  const kv = await getKv();
  const entry = await kv.get<Workflow>(["users", uid, "workflows", id]);
  return entry.value;
}

export function listWorkflows(options?: ListOptions): Promise<Workflow[]> {
  const uid = resolveUserId(options?.userId);
  return listEntries<Workflow>(["users", uid, "workflows"], options);
}

export async function deleteWorkflow(id: WorkflowId, userId?: string): Promise<void> {
  const uid = resolveUserId(userId);
  const kv = await getKv();
  let atomic = kv.atomic();
  let opCount = 0;

  const commitBatch = async (): Promise<void> => {
    if (opCount > 0) {
      await atomic.commit();
      atomic = kv.atomic();
      opCount = 0;
    }
  };

  // Delete all nodes belonging to this workflow (and any subworkflow index refs)
  for await (const entry of kv.list<WorkflowNode>({ prefix: ["users", uid, "nodes", id] })) {
    atomic.delete(entry.key);
    opCount++;
    if (
      entry.value?.type === "subworkflow" && typeof entry.value.config?.childWorkflowId === "string"
    ) {
      const childId = (entry.value.config.childWorkflowId as string).trim();
      if (childId) {
        atomic.delete(["users", uid, "subworkflow_refs", childId, id, entry.value.id]);
        opCount++;
      }
    }
    if (opCount >= MAX_ATOMIC_OPS) {
      await commitBatch();
    }
  }

  // Delete all edges belonging to this workflow
  for await (const entry of kv.list({ prefix: ["users", uid, "edges", id] })) {
    atomic.delete(entry.key);
    opCount++;
    if (opCount >= MAX_ATOMIC_OPS) {
      await commitBatch();
    }
  }

  // Delete all executions belonging to this workflow (via the by-workflow index)
  for await (
    const entry of kv.list<string>({ prefix: ["users", uid, "executions_by_workflow", id] })
  ) {
    const executionId = entry.value;
    atomic.delete(["users", uid, "executions", executionId]);
    atomic.delete(entry.key);
    opCount += 2;
    if (opCount >= MAX_ATOMIC_OPS) {
      await commitBatch();
    }
  }

  // Delete the workflow itself
  atomic.delete(["users", uid, "workflows", id]);
  opCount++;
  await commitBatch();
  invalidateWorkflowCache(uid);
}
