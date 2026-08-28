/**
 * Deno KV persistence for task handoff records.
 */

import type { HandoffRecord, TaskId } from "../types.ts";
import { getKv, resolveUserId } from "./client.ts";

/** Input payload for recording a work handoff. */
export interface CreateHandoffInput {
  id?: string;
  taskId: TaskId;
  fromAssignee: string;
  toAssignee?: string;
  toRole?: string;
  reason: string;
  contextSummary?: string;
  rejectedApproaches?: string[];
  timestamp?: string;
}

/**
 * Records a handoff for a task.
 */
export async function recordHandoff(
  handoff: CreateHandoffInput,
  userId?: string,
): Promise<HandoffRecord> {
  const taskId = handoff.taskId?.trim();
  if (!taskId) {
    throw new Error("Task ID cannot be empty");
  }
  const fromAssignee = handoff.fromAssignee?.trim();
  if (!fromAssignee) {
    throw new Error("fromAssignee cannot be empty");
  }
  const reason = handoff.reason?.trim();
  if (!reason) {
    throw new Error("Handoff reason cannot be empty");
  }

  const uid = resolveUserId(userId);
  const kv = await getKv();

  const id = handoff.id || `ho-${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
  const timestamp = handoff.timestamp || new Date().toISOString();

  const record: HandoffRecord = {
    id,
    userId: uid,
    taskId,
    fromAssignee,
    toAssignee: handoff.toAssignee?.trim() || undefined,
    toRole: handoff.toRole?.trim() || undefined,
    reason,
    contextSummary: handoff.contextSummary ?? "",
    rejectedApproaches: handoff.rejectedApproaches ?? [],
    timestamp,
  };

  await kv.set(["users", uid, "handoffs", taskId, id], record);
  return record;
}

/**
 * Retrieves all handoff records for a given task, ordered by timestamp ascending.
 */
export async function getHandoffsForTask(
  taskId: TaskId,
  options?: { limit?: number; userId?: string },
): Promise<HandoffRecord[]> {
  const uid = resolveUserId(options?.userId);
  const kv = await getKv();
  const records: HandoffRecord[] = [];

  for await (
    const entry of kv.list<HandoffRecord>(
      { prefix: ["users", uid, "handoffs", taskId.trim()] },
    )
  ) {
    if (entry.value) {
      records.push(entry.value);
    }
  }

  records.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return options?.limit ? records.slice(0, options.limit) : records;
}
