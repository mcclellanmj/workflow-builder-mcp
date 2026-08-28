/**
 * Deno KV persistence for workflow edges.
 */

import type { WorkflowEdge, WorkflowId } from "../types.ts";
import { getKv, listEntries, type ListOptions, MAX_ATOMIC_OPS, resolveUserId } from "./client.ts";

export async function saveEdge(edge: WorkflowEdge, userId?: string): Promise<void> {
  const uid = resolveUserId(userId || edge.userId);
  edge.userId = uid;
  const kv = await getKv();
  await kv.set(["users", uid, "edges", edge.workflowId, edge.id], edge);
}

/** Saves multiple workflow edges in atomic batches. */
export async function saveEdges(edges: WorkflowEdge[], userId?: string): Promise<void> {
  if (edges.length === 0) return;
  const kv = await getKv();
  let atomic = kv.atomic();
  let opCount = 0;

  for (const edge of edges) {
    const uid = resolveUserId(userId || edge.userId);
    edge.userId = uid;
    atomic.set(["users", uid, "edges", edge.workflowId, edge.id], edge);
    opCount++;
    if (opCount >= MAX_ATOMIC_OPS) {
      await atomic.commit();
      atomic = kv.atomic();
      opCount = 0;
    }
  }

  if (opCount > 0) {
    await atomic.commit();
  }
}

export async function getEdge(
  workflowId: WorkflowId,
  edgeId: string,
  userId?: string,
): Promise<WorkflowEdge | null> {
  const uid = resolveUserId(userId);
  const kv = await getKv();
  const entry = await kv.get<WorkflowEdge>(["users", uid, "edges", workflowId, edgeId]);
  return entry.value;
}

/** Fetches multiple edges by their IDs in bulk using chunked kv.getMany calls. */
export async function getEdges(
  workflowId: WorkflowId,
  edgeIds: string[],
  userId?: string,
): Promise<WorkflowEdge[]> {
  if (edgeIds.length === 0) return [];
  const uid = resolveUserId(userId);
  const kv = await getKv();
  const results: WorkflowEdge[] = [];

  for (let i = 0; i < edgeIds.length; i += 10) {
    const chunk = edgeIds.slice(i, i + 10);
    const keys = chunk.map((id) => ["users", uid, "edges", workflowId, id]);
    const entries = await kv.getMany<WorkflowEdge[]>(keys);
    for (const entry of entries) {
      if (entry.value) {
        results.push(entry.value);
      }
    }
  }

  return results;
}

export function listEdges(
  workflowId: WorkflowId,
  options?: ListOptions,
): Promise<WorkflowEdge[]> {
  const uid = resolveUserId(options?.userId);
  return listEntries<WorkflowEdge>(["users", uid, "edges", workflowId], options);
}

export async function deleteEdge(
  workflowId: WorkflowId,
  edgeId: string,
  userId?: string,
): Promise<void> {
  const uid = resolveUserId(userId);
  const kv = await getKv();
  await kv.delete(["users", uid, "edges", workflowId, edgeId]);
}

/** Deletes multiple workflow edges by their IDs in bulk using atomic batches. */
export async function deleteEdges(
  workflowId: WorkflowId,
  edgeIds: string[],
  userId?: string,
): Promise<void> {
  if (edgeIds.length === 0) return;
  const uid = resolveUserId(userId);
  const kv = await getKv();
  let atomic = kv.atomic();
  let opCount = 0;

  for (const edgeId of edgeIds) {
    atomic.delete(["users", uid, "edges", workflowId, edgeId]);
    opCount++;
    if (opCount >= MAX_ATOMIC_OPS) {
      await atomic.commit();
      atomic = kv.atomic();
      opCount = 0;
    }
  }

  if (opCount > 0) {
    await atomic.commit();
  }
}

/** Deletes all edges that reference the given node (inbound or outbound) atomically. */
export async function deleteEdgesForNode(
  workflowId: WorkflowId,
  nodeId: string,
  userId?: string,
): Promise<WorkflowEdge[]> {
  const uid = resolveUserId(userId);
  const edges = await listEdges(workflowId, { userId: uid });
  const removed: WorkflowEdge[] = [];
  const kv = await getKv();
  let atomic = kv.atomic();
  let opCount = 0;

  for (const edge of edges) {
    if (edge.fromNodeId === nodeId || edge.toNodeId === nodeId) {
      atomic.delete(["users", uid, "edges", workflowId, edge.id]);
      removed.push(edge);
      opCount++;
      if (opCount >= MAX_ATOMIC_OPS) {
        await atomic.commit();
        atomic = kv.atomic();
        opCount = 0;
      }
    }
  }

  if (opCount > 0) {
    await atomic.commit();
  }
  return removed;
}
