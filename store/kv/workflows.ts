/**
 * Deno KV persistence for workflow aggregates.
 */

import type { Workflow, WorkflowId, WorkflowNode } from "../types.ts";
import { getKv, listEntries, type ListOptions, MAX_ATOMIC_OPS, resolveUserId } from "./client.ts";
import { invalidateWorkflowCache } from "../resolvers.ts";

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

  const commitPromises: Promise<Deno.KvCommitResult | Deno.KvCommitError>[] = [];
  let atomic = kv.atomic();
  let opCount = 0;

  const queueDelete = (key: Deno.KvKey) => {
    atomic.delete(key);
    opCount++;
    if (opCount >= MAX_ATOMIC_OPS) {
      commitPromises.push(
        atomic.commit().catch((e) => {
          throw e;
        }),
      );
      atomic = kv.atomic();
      opCount = 0;
    }
  };

  const batchSize = 500;

  const processNodes = async () => {
    for await (
      const entry of kv.list<WorkflowNode>({ prefix: ["users", uid, "nodes", id] }, { batchSize })
    ) {
      queueDelete(entry.key);
      if (
        entry.value?.type === "subworkflow" &&
        typeof entry.value.config?.childWorkflowId === "string"
      ) {
        const childId = (entry.value.config.childWorkflowId as string).trim();
        if (childId) {
          queueDelete(["users", uid, "subworkflow_refs", childId, id, entry.value.id]);
        }
      }
    }
  };

  const processEdges = async () => {
    for await (const entry of kv.list({ prefix: ["users", uid, "edges", id] }, { batchSize })) {
      queueDelete(entry.key);
    }
  };

  const processExecutions = async () => {
    for await (
      const entry of kv.list<string>({ prefix: ["users", uid, "executions_by_workflow", id] }, {
        batchSize,
      })
    ) {
      const executionId = entry.value;
      queueDelete(["users", uid, "executions", executionId]);
      queueDelete(entry.key);
    }
  };

  // Process list operations concurrently to maximize read throughput
  await Promise.all([processNodes(), processEdges(), processExecutions()]);

  // Delete the workflow itself
  queueDelete(["users", uid, "workflows", id]);

  if (opCount > 0) {
    commitPromises.push(
      atomic.commit().catch((e) => {
        throw e;
      }),
    );
  }

  await Promise.all(commitPromises);
  invalidateWorkflowCache(uid);
}
