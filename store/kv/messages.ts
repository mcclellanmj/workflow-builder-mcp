/**
 * Deno KV persistence for execution message boards with task/role filtering
 * and hierarchical subworkflow querying.
 */

import type { ExecutionId, ExecutionMessage, NodeId, TaskId } from "../types.ts";
import { getKv } from "./client.ts";

export interface ListMessagesFilters {
  taskId?: TaskId;
  nodeId?: NodeId;
  role?: string;
  topic?: string;
  includeSubworkflows?: boolean;
  limit?: number;
}

/**
 * Posts a message to an execution's message board.
 * Stored at key: ["executions", message.executionId, "messages", message.id]
 */
export async function postMessage(message: ExecutionMessage): Promise<ExecutionMessage> {
  const kv = await getKv();
  const id = message.id || crypto.randomUUID();
  const createdAt = message.createdAt || new Date().toISOString();

  const record: ExecutionMessage = {
    ...message,
    id,
    createdAt,
  };

  await kv.set(["executions", record.executionId, "messages", record.id], record);
  return record;
}

/**
 * Lists messages for an execution with multi-level filtering.
 * If includeSubworkflows is true, also retrieves messages from all child executions
 * whose parentExecutionId matches executionId and merges them chronologically.
 */
export async function listMessages(
  executionId: ExecutionId,
  filters?: ListMessagesFilters,
): Promise<ExecutionMessage[]> {
  const kv = await getKv();
  const messages: ExecutionMessage[] = [];

  // 1. Fetch messages for the target execution
  for await (
    const entry of kv.list<ExecutionMessage>({
      prefix: ["executions", executionId, "messages"],
    })
  ) {
    if (entry.value) {
      messages.push(entry.value);
    }
  }

  // 2. If includeSubworkflows is requested, find child executions and collect their messages
  if (filters?.includeSubworkflows) {
    const childIds: string[] = [];
    for await (
      const entry of kv.list<string>({
        prefix: ["executions_by_parent", executionId],
      })
    ) {
      if (entry.value) {
        childIds.push(entry.value);
      }
    }

    for (const childId of childIds) {
      for await (
        const entry of kv.list<ExecutionMessage>({
          prefix: ["executions", childId, "messages"],
        })
      ) {
        if (entry.value) {
          messages.push(entry.value);
        }
      }
    }
  }

  // 3. Apply filters
  let filtered = messages;
  if (filters?.taskId) {
    filtered = filtered.filter((m) => m.taskId === filters.taskId);
  }
  if (filters?.nodeId) {
    filtered = filtered.filter((m) => m.nodeId === filters.nodeId);
  }
  if (filters?.role) {
    filtered = filtered.filter((m) => m.role === filters.role);
  }
  if (filters?.topic) {
    filtered = filtered.filter((m) => m.topic === filters.topic);
  }

  // 4. Sort chronologically ascending
  filtered.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  // 5. Apply limit
  if (filters?.limit && filters.limit > 0) {
    filtered = filtered.slice(0, filters.limit);
  }

  return filtered;
}

/**
 * Deletes all messages for an execution.
 */
export async function deleteMessagesForExecution(executionId: ExecutionId): Promise<void> {
  const kv = await getKv();
  for await (
    const entry of kv.list<ExecutionMessage>({
      prefix: ["executions", executionId, "messages"],
    })
  ) {
    await kv.delete(entry.key);
  }
}
