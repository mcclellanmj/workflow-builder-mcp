/**
 * Deno KV persistence for workflow, node, and task memories with access tracking.
 */

import type {
  ExecutionId,
  Memory,
  MemoryAccessRecord,
  MemoryScope,
  NodeId,
  TaskId,
  WorkflowId,
} from "../types.ts";
import { getKv, MAX_ATOMIC_OPS, MAX_GET_MANY_KEYS, resolveUserId } from "./client.ts";

/** Input payload for saving or updating a memory. */
export interface SaveMemoryInput {
  workflowId: WorkflowId;
  key: string;
  summary: string;
  content: string;
  scope?: MemoryScope;
  nodeId?: NodeId;
  taskId?: TaskId;
  tags?: string[];
  source?: string;
  embedding?: number[];
  // Backwards compatibility / optional fields
  roleId?: string;
}

/** Result returned after saving a memory. */
export interface SaveMemoryResult {
  memory: Memory;
  created: boolean;
}

/** Short memory summary returned when listing memories. Content is intentionally omitted. */
export interface MemorySummary {
  id: string;
  workflowId: WorkflowId;
  nodeId?: NodeId;
  taskId?: TaskId;
  roleId?: string;
  scope?: MemoryScope;
  key: string;
  summary: string;
  tags: string[];
  source?: string;
  lastAccessed?: string;
  accessCount?: number;
  createdAt: string;
  updatedAt: string;
}

/** Filters for listing memories. */
export interface MemoryFilters {
  workflowId?: WorkflowId;
  nodeId?: NodeId;
  taskId?: TaskId;
  scope?: MemoryScope;
  tags?: string[];
  limit?: number;
  userId?: string;
  // Backwards compatibility
  roleId?: string;
}

/** Parameters for recalling a memory. */
export interface RecallMemoryParams {
  key?: string;
  id?: string;
  workflowId?: WorkflowId;
  nodeId?: NodeId;
  taskId?: TaskId;
  accessedBy?: string;
  executionId?: ExecutionId;
}

/** Parameters for deleting a memory. */
export interface DeleteMemoryParams {
  id?: string;
  key?: string;
  workflowId?: WorkflowId;
  nodeId?: NodeId;
  taskId?: TaskId;
}

/**
 * Saves a memory entry. If a memory with the same key exists in the workflow,
 * it updates the existing entry (upsert behavior).
 */
export async function saveMemory(
  input: SaveMemoryInput,
  userId?: string,
): Promise<SaveMemoryResult> {
  const workflowId = input.workflowId?.trim();
  if (!workflowId) {
    throw new Error("Workflow ID is required to save memory");
  }

  const trimmedKey = input.key?.trim();
  if (!trimmedKey) {
    throw new Error("Memory key cannot be empty");
  }
  if (!input.summary || !input.summary.trim()) {
    throw new Error("Memory summary cannot be empty");
  }
  if (input.content === undefined || input.content === null) {
    throw new Error("Memory content cannot be undefined");
  }

  const uid = resolveUserId(userId);
  const kv = await getKv();

  // Check if a memory with this key already exists in this workflow
  const keyIndex = await kv.get<string>(["users", uid, "memory_keys", workflowId, trimmedKey]);
  const now = new Date().toISOString();

  if (keyIndex.value) {
    const existingEntry = await kv.get<Memory>(["users", uid, "memories", keyIndex.value]);
    if (existingEntry.value) {
      const existing = existingEntry.value;
      const scope: MemoryScope = input.scope || (input.nodeId ? "node" : (input.taskId ? "task" : (workflowId && workflowId !== "global" ? "workflow" : "global")));
      const updated: Memory = {
        ...existing,
        workflowId,
        nodeId: input.nodeId !== undefined ? input.nodeId : existing.nodeId,
        taskId: input.taskId !== undefined ? input.taskId : existing.taskId,
        roleId: input.roleId !== undefined ? input.roleId : existing.roleId,
        summary: input.summary.trim(),
        content: input.content,
        scope: input.scope !== undefined ? input.scope : (existing.scope ?? scope),
        source: input.source !== undefined ? input.source : existing.source,
        tags: input.tags !== undefined ? input.tags : (existing.tags ?? []),
        embedding: input.embedding !== undefined ? input.embedding : existing.embedding,
        updatedAt: now,
      };

      const atomic = kv.atomic()
        .set(["users", uid, "memories", updated.id], updated)
        .set(["users", uid, "memories_by_workflow", workflowId, updated.id], updated.id);

      if (updated.nodeId) {
        atomic.set(["users", uid, "memories_by_node", workflowId, updated.nodeId, updated.id], updated.id);
      }
      if (updated.taskId) {
        atomic.set(["users", uid, "memories_by_task", updated.taskId, updated.id], updated.id);
      }

      const res = await atomic.commit();
      if (!res.ok) {
        throw new Error(`Failed to update memory with key "${trimmedKey}"`);
      }
      return { memory: updated, created: false };
    }
  }

  // Create new memory
  const id = `mem-${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
  const scope: MemoryScope = input.scope || (input.nodeId ? "node" : (input.taskId ? "task" : (workflowId && workflowId !== "global" ? "workflow" : "global")));
  const memory: Memory = {
    id,
    userId: uid,
    key: trimmedKey,
    summary: input.summary.trim(),
    content: input.content,
    scope,
    workflowId,
    nodeId: input.nodeId,
    taskId: input.taskId,
    roleId: input.roleId,
    tags: input.tags ?? [],
    source: input.source,
    embedding: input.embedding,
    accessCount: 0,
    createdAt: now,
    updatedAt: now,
  };

  const atomic = kv.atomic()
    .set(["users", uid, "memories", id], memory)
    .set(["users", uid, "memory_keys", workflowId, trimmedKey], id)
    .set(["users", uid, "memories_by_workflow", workflowId, id], id);

  if (memory.nodeId) {
    atomic.set(["users", uid, "memories_by_node", workflowId, memory.nodeId, id], id);
  }
  if (memory.taskId) {
    atomic.set(["users", uid, "memories_by_task", memory.taskId, id], id);
  }

  const res = await atomic.commit();
  if (!res.ok) {
    throw new Error(`Failed to save memory with key "${trimmedKey}"`);
  }

  return { memory, created: true };
}

/**
 * Retrieves a memory directly by its ID.
 */
export async function getMemory(memoryId: string, userId?: string): Promise<Memory | null> {
  const uid = resolveUserId(userId);
  const kv = await getKv();
  const entry = await kv.get<Memory>(["users", uid, "memories", memoryId]);
  return entry.value;
}

/**
 * Lists memories matching the given filters. Returns summaries only (no content).
 */
export async function listMemories(
  filters?: MemoryFilters,
  options?: { userId?: string },
): Promise<MemorySummary[]> {
  const uid = resolveUserId(filters?.userId || options?.userId);
  const kv = await getKv();

  let candidateIds: string[] | null = null;

  if (filters?.taskId) {
    const ids: string[] = [];
    for await (
      const entry of kv.list<string>({ prefix: ["users", uid, "memories_by_task", filters.taskId] })
    ) {
      if (entry.value) ids.push(entry.value);
    }
    candidateIds = ids;
  } else if (filters?.nodeId && filters?.workflowId) {
    const ids: string[] = [];
    for await (
      const entry of kv.list<string>({
        prefix: ["users", uid, "memories_by_node", filters.workflowId, filters.nodeId],
      })
    ) {
      if (entry.value) ids.push(entry.value);
    }
    candidateIds = ids;
  } else if (filters?.workflowId) {
    const ids: string[] = [];
    for await (
      const entry of kv.list<string>({
        prefix: ["users", uid, "memories_by_workflow", filters.workflowId],
      })
    ) {
      if (entry.value) ids.push(entry.value);
    }
    candidateIds = ids;
  }

  const memories: Memory[] = [];
  if (candidateIds !== null) {
    for (let i = 0; i < candidateIds.length; i += MAX_GET_MANY_KEYS) {
      const chunk = candidateIds.slice(i, i + MAX_GET_MANY_KEYS);
      const keys = chunk.map((id) => ["users", uid, "memories", id]);
      const entries = await kv.getMany<Memory[]>(keys);
      for (const entry of entries) {
        if (entry.value) memories.push(entry.value);
      }
    }
  } else {
    for await (const entry of kv.list<Memory>({ prefix: ["users", uid, "memories"] })) {
      if (entry.value && typeof entry.value === "object") {
        memories.push(entry.value);
      }
    }
  }

  // Filter remaining criteria
  let filtered = memories.filter((m) => {
    if (filters?.scope && m.scope !== filters.scope) return false;
    if (filters?.roleId && m.roleId !== filters.roleId) return false;
    if (filters?.workflowId && m.workflowId !== filters.workflowId) return false;
    if (filters?.nodeId && m.nodeId !== filters.nodeId) return false;
    if (filters?.taskId && m.taskId !== filters.taskId) return false;
    if (filters?.tags && filters.tags.length > 0) {
      const memTags = m.tags || [];
      const hasAllTags = filters.tags.every((t) => memTags.includes(t));
      if (!hasAllTags) return false;
    }
    return true;
  });

  if (filters?.limit && filters.limit > 0) {
    filtered = filtered.slice(0, filters.limit);
  }

  return filtered.map((m) => ({
    id: m.id,
    workflowId: m.workflowId,
    nodeId: m.nodeId,
    taskId: m.taskId,
    roleId: m.roleId,
    scope: m.scope,
    key: m.key,
    summary: m.summary,
    tags: m.tags || [],
    source: m.source,
    lastAccessed: m.lastAccessed,
    accessCount: m.accessCount ?? 0,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  }));
}

/**
 * Recalls a memory by key or ID. Returns full memory content and writes a
 * MemoryAccessRecord to the access log while atomically updating denormalized access stats.
 */
export async function recallMemory(
  params: RecallMemoryParams,
  userId?: string,
): Promise<Memory | null> {
  const uid = resolveUserId(userId);
  const kv = await getKv();

  let memory: Memory | null = null;

  if (params.id) {
    memory = await getMemory(params.id, uid);
  } else if (params.key) {
    const trimmedKey = params.key.trim();
    if (params.workflowId) {
      const keyEntry = await kv.get<string>([
        "users",
        uid,
        "memory_keys",
        params.workflowId,
        trimmedKey,
      ]);
      if (keyEntry.value) {
        memory = await getMemory(keyEntry.value, uid);
      }
    } else {
      // Search memory_keys across workflows
      for await (
        const entry of kv.list<string>({ prefix: ["users", uid, "memory_keys"] })
      ) {
        // key format: ["users", uid, "memory_keys", workflowId, key]
        if (entry.key[4] === trimmedKey && entry.value) {
          const candidate = await getMemory(entry.value, uid);
          if (candidate) {
            memory = candidate;
            break;
          }
        }
      }
    }
  }

  if (!memory) {
    return null;
  }

  // Record access in memory_access_log and atomically update memory document
  const accessId = crypto.randomUUID();
  const accessedAt = new Date().toISOString();
  const accessRecord: MemoryAccessRecord = {
    id: accessId,
    memoryId: memory.id,
    memoryKey: memory.key,
    accessedAt,
    accessedBy: params.accessedBy,
    executionId: params.executionId,
    taskId: params.taskId,
  };

  const updatedMemory: Memory = {
    ...memory,
    accessCount: (memory.accessCount || 0) + 1,
    lastAccessed: accessedAt,
  };

  const atomicRes = await kv.atomic()
    .set(["users", uid, "memory_access_log", memory.id, accessId], accessRecord)
    .set(["users", uid, "memories", memory.id], updatedMemory)
    .commit();

  if (!atomicRes.ok) {
    throw new Error(`Failed to update memory access record for memory "${memory.id}"`);
  }

  return updatedMemory;
}

/**
 * Records an access event for a memory in telemetry / access log and atomically increments accessCount.
 */
export async function recordMemoryAccess(
  memoryId: string,
  params?: {
    accessedBy?: string;
    executionId?: ExecutionId;
    taskId?: TaskId;
    userId?: string;
  },
): Promise<void> {
  const uid = resolveUserId(params?.userId);
  const kv = await getKv();
  const memory = await getMemory(memoryId, uid);
  if (!memory) return;

  const accessId = crypto.randomUUID();
  const accessedAt = new Date().toISOString();
  const accessRecord: MemoryAccessRecord = {
    id: accessId,
    memoryId: memory.id,
    memoryKey: memory.key,
    accessedAt,
    accessedBy: params?.accessedBy,
    executionId: params?.executionId,
    taskId: params?.taskId,
  };

  const updatedMemory: Memory = {
    ...memory,
    accessCount: (memory.accessCount || 0) + 1,
    lastAccessed: accessedAt,
  };

  const res = await kv.atomic()
    .set(["users", uid, "memory_access_log", memory.id, accessId], accessRecord)
    .set(["users", uid, "memories", memory.id], updatedMemory)
    .commit();

  if (!res.ok) {
    throw new Error(`Failed to record memory access for memory "${memory.id}"`);
  }
}

/**
 * Deletes a memory and all its index entries and access logs.
 */
export async function deleteMemory(
  params: DeleteMemoryParams,
  userId?: string,
): Promise<{ deleted: boolean; accessCount: number }> {
  const uid = resolveUserId(userId);
  const kv = await getKv();

  let memory: Memory | null = null;
  if (params.id) {
    memory = await getMemory(params.id, uid);
  } else if (params.key && params.workflowId) {
    const trimmedKey = params.key.trim();
    const keyEntry = await kv.get<string>([
      "users",
      uid,
      "memory_keys",
      params.workflowId,
      trimmedKey,
    ]);
    if (keyEntry.value) {
      memory = await getMemory(keyEntry.value, uid);
    }
  }

  if (!memory) {
    return { deleted: false, accessCount: 0 };
  }

  const accessLogKeys: Deno.KvKey[] = [];
  for await (
    const entry of kv.list<MemoryAccessRecord>({
      prefix: ["users", uid, "memory_access_log", memory.id],
    })
  ) {
    accessLogKeys.push(entry.key);
  }
  const accessCount = memory.accessCount ?? accessLogKeys.length;

  let atomic = kv.atomic();
  let opCount = 0;

  const commitBatch = async (): Promise<void> => {
    if (opCount > 0) {
      await atomic.commit();
      atomic = kv.atomic();
      opCount = 0;
    }
  };

  // 1. Delete main memory entry
  atomic.delete(["users", uid, "memories", memory.id]);
  opCount++;

  // 2. Delete key index
  atomic.delete(["users", uid, "memory_keys", memory.workflowId, memory.key]);
  opCount++;

  // 3. Delete secondary indexes
  atomic.delete(["users", uid, "memories_by_workflow", memory.workflowId, memory.id]);
  opCount++;

  if (memory.nodeId) {
    atomic.delete(["users", uid, "memories_by_node", memory.workflowId, memory.nodeId, memory.id]);
    opCount++;
  }
  if (memory.taskId) {
    atomic.delete(["users", uid, "memories_by_task", memory.taskId, memory.id]);
    opCount++;
  }

  // 4. Delete all access logs
  for (const logKey of accessLogKeys) {
    atomic.delete(logKey);
    opCount++;
    if (opCount >= MAX_ATOMIC_OPS) {
      await commitBatch();
    }
  }

  await commitBatch();
  return { deleted: true, accessCount };
}

/**
 * Retrieves the complete access log for a memory.
 */
export async function getMemoryAccessLog(
  memoryId: string,
  options?: { limit?: number; userId?: string },
): Promise<MemoryAccessRecord[]> {
  const uid = resolveUserId(options?.userId);
  const kv = await getKv();
  const records: MemoryAccessRecord[] = [];

  for await (
    const entry of kv.list<MemoryAccessRecord>(
      { prefix: ["users", uid, "memory_access_log", memoryId] },
    )
  ) {
    if (entry.value) {
      records.push(entry.value);
    }
  }

  records.sort((a, b) => a.accessedAt.localeCompare(b.accessedAt));
  return options?.limit ? records.slice(0, options.limit) : records;
}
