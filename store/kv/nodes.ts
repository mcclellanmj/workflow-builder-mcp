/**
 * Deno KV persistence for workflow nodes and subworkflow reference indexing.
 */

import type { WorkflowId, WorkflowNode } from "../types.ts";
import { getKv, type ListOptions, listEntries, MAX_ATOMIC_OPS, resolveUserId } from "./client.ts";

export async function saveNode(node: WorkflowNode, userId?: string): Promise<void> {
  const uid = resolveUserId(userId || node.userId);
  node.userId = uid;
  const kv = await getKv();
  const atomic = kv.atomic().set(["users", uid, "nodes", node.workflowId, node.id], node);
  if (node.type === "subworkflow" && typeof node.config?.childWorkflowId === "string") {
    const childId = (node.config.childWorkflowId as string).trim();
    if (childId) {
      atomic.set(["users", uid, "subworkflow_refs", childId, node.workflowId, node.id], true);
    }
  }
  await atomic.commit();
}

export async function saveNodes(nodes: WorkflowNode[], userId?: string): Promise<void> {
  if (nodes.length === 0) return;
  const kv = await getKv();
  let atomic = kv.atomic();
  let opCount = 0;

  for (const node of nodes) {
    const uid = resolveUserId(userId || node.userId);
    node.userId = uid;
    atomic.set(["users", uid, "nodes", node.workflowId, node.id], node);
    opCount++;
    if (node.type === "subworkflow" && typeof node.config?.childWorkflowId === "string") {
      const childId = (node.config.childWorkflowId as string).trim();
      if (childId) {
        atomic.set(["users", uid, "subworkflow_refs", childId, node.workflowId, node.id], true);
        opCount++;
      }
    }
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

export async function getNode(
  workflowId: WorkflowId,
  nodeId: string,
  userId?: string,
): Promise<WorkflowNode | null> {
  const uid = resolveUserId(userId);
  const kv = await getKv();
  const entry = await kv.get<WorkflowNode>(["users", uid, "nodes", workflowId, nodeId]);
  return entry.value;
}

export function listNodes(
  workflowId: WorkflowId,
  options?: ListOptions,
): Promise<WorkflowNode[]> {
  const uid = resolveUserId(options?.userId);
  return listEntries<WorkflowNode>(["users", uid, "nodes", workflowId], options);
}

export async function deleteNode(
  workflowId: WorkflowId,
  nodeId: string,
  userId?: string,
): Promise<void> {
  const uid = resolveUserId(userId);
  const kv = await getKv();
  const existing = await kv.get<WorkflowNode>(["users", uid, "nodes", workflowId, nodeId]);
  const atomic = kv.atomic().delete(["users", uid, "nodes", workflowId, nodeId]);
  if (
    existing.value?.type === "subworkflow" &&
    typeof existing.value.config?.childWorkflowId === "string"
  ) {
    const childId = (existing.value.config.childWorkflowId as string).trim();
    if (childId) {
      atomic.delete(["users", uid, "subworkflow_refs", childId, workflowId, nodeId]);
    }
  }
  await atomic.commit();
}

/** Finds all workflow IDs that are referenced as child workflows in any subworkflow node via index. */
export async function listReferencedChildWorkflowIds(userId?: string): Promise<Set<string>> {
  const uid = resolveUserId(userId);
  const kv = await getKv();
  const referencedIds = new Set<string>();
  for await (const entry of kv.list({ prefix: ["users", uid, "subworkflow_refs"] })) {
    const childId = entry.key[3];
    if (typeof childId === "string" && childId.length > 0) {
      referencedIds.add(childId);
    }
  }

  // Fallback for legacy data not yet indexed: scan nodes once and record sentinel
  if (referencedIds.size === 0) {
    const indexedFlag = await kv.get<boolean>(["users", uid, "subworkflow_refs_indexed"]);
    if (!indexedFlag.value) {
      for await (const entry of kv.list<WorkflowNode>({ prefix: ["users", uid, "nodes"] })) {
        const node = entry.value;
        if (node && node.type === "subworkflow") {
          const childId = node.config?.childWorkflowId;
          if (typeof childId === "string" && childId.trim().length > 0) {
            const trimmed = childId.trim();
            referencedIds.add(trimmed);
            await kv.set(
              ["users", uid, "subworkflow_refs", trimmed, node.workflowId, node.id],
              true,
            );
          }
        }
      }
      await kv.set(["users", uid, "subworkflow_refs_indexed"], true);
    }
  }

  return referencedIds;
}
