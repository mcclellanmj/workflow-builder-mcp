/**
 * Deno KV persistence for task handoff records with role-to-role transitions
 * and review rejection tracking.
 */

import type { HandoffRecord, TaskId } from "../types.ts";
import { getKv, resolveUserId } from "./client.ts";
import { getTask, saveTask } from "./tasks.ts";

/** Input payload for recording a work handoff. */
export interface CreateHandoffInput {
  id?: string;
  taskId: TaskId;
  fromAssignee: string;
  toAssignee?: string;
  fromRole?: string;
  toRole?: string;
  action: "advance" | "reject" | "escalate";
  reason: string;
  contextSummary?: string;
  feedback?: string[];
  rejectedApproaches?: string[];
  timestamp?: string;
}

/**
 * Records a handoff for a task.
 * Supports role transitions (fromRole -> toRole) and actions (advance, reject, escalate).
 * On action === "reject", increments rejectionCount on the task, reverts task to open,
 * and appends feedback and audit comments.
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
  const action = handoff.action;
  if (!action || !["advance", "reject", "escalate"].includes(action)) {
    throw new Error("Action must be 'advance', 'reject', or 'escalate'");
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
    fromRole: handoff.fromRole?.trim() || undefined,
    toRole: handoff.toRole?.trim() || undefined,
    action,
    reason,
    contextSummary: handoff.contextSummary ?? "",
    feedback: handoff.feedback ?? [],
    rejectedApproaches: handoff.rejectedApproaches ?? [],
    timestamp,
  };

  await kv.set(["users", uid, "handoffs", taskId, id], record);

  // Update task if it exists (active or closed)
  const existingTask = await getTask(taskId, uid);
  if (existingTask) {
    const task = { ...existingTask };
    const comments = Array.isArray(task.comments) ? [...task.comments] : [];

    if (action === "reject") {
      task.rejectionCount = (task.rejectionCount ?? 0) + 1;
      task.status = "open";
      task.assignee = handoff.toAssignee?.trim() || undefined;
      task.claimedAt = handoff.toAssignee?.trim() ? timestamp : undefined;
    } else if (action === "advance") {
      if (handoff.toAssignee && handoff.toAssignee.trim()) {
        task.assignee = handoff.toAssignee.trim();
        task.claimedAt = timestamp;
      }
    }

    if (handoff.toRole && handoff.toRole.trim()) {
      task.role = handoff.toRole.trim();
    }

    if (handoff.rejectedApproaches && handoff.rejectedApproaches.length > 0) {
      task.rejectedApproaches = [
        ...(task.rejectedApproaches ?? []),
        ...handoff.rejectedApproaches,
      ];
    }

    if (handoff.contextSummary && handoff.contextSummary.trim()) {
      task.context = task.context
        ? `${task.context}\n\n${handoff.contextSummary.trim()}`
        : handoff.contextSummary.trim();
    }

    // Append feedback as comment(s)
    let commentText = `[${action.toUpperCase()}] ${reason}`;
    if (handoff.feedback && handoff.feedback.length > 0) {
      commentText += ` | Feedback: ${handoff.feedback.join("; ")}`;
    }
    const truncatedText = commentText.length > 256 ? commentText.slice(0, 253) + "..." : commentText;

    comments.push({
      id: crypto.randomUUID().slice(0, 8),
      taskId,
      userId: uid,
      author: fromAssignee,
      content: truncatedText,
      createdAt: timestamp,
    });

    task.comments = comments;
    task.updatedAt = timestamp;

    await saveTask(task, uid);
  }

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
