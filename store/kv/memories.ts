/**
 * Deno KV persistence for workflow, node, and role memories with access tracking.
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
  key: string;
  summary: string;
  content: string;
  scope: MemoryScope;
  workflowId?: WorkflowId;
  nodeId?: NodeId;
  roleId?: string;
  source?: string;
  tags?: string[];
}

/** Result returned after saving a memory. */
export interface SaveMemoryResult {
  memory: Memory;
  created: boolean;
}

/** Short memory summary returned when listing memories. Content is intentionally omitted. */
export interface MemorySummary {
  id: string;
  key: string;
  summary: string;
  scope: MemoryScope;
  workflowId?: WorkflowId;
  nodeId?: NodeId;
  roleId?: string;
  source?: string;
  tags?: string[];
  lastAccessed?: string;
  accessCount?: number;
  createdAt: string;
  updatedAt: string;
}

/** Filters for listing memories. */
export interface MemoryFilters {
  workflowId?: WorkflowId;
  nodeId?: NodeId;
  roleId?: string;
  scope?: MemoryScope;
  tags?: string[];
  limit?: number;
  userId?: string;
}

/** Parameters for recalling a memory. */
export interface RecallMemoryParams {
  key?: string;
  id?: string;
  scope?: MemoryScope;
  workflowId?: WorkflowId;
  nodeId?: NodeId;
  roleId?: string;
  accessedBy?: string;
  executionId?: ExecutionId;
  taskId?: TaskId;
}

/** Parameters for deleting a memory. */
export interface DeleteMemoryParams {
  id?: string;
  key?: string;
  scope?: MemoryScope;
  workflowId?: WorkflowId;
  nodeId?: NodeId;
  roleId?: string;
}

/** Helper to compute scope reference identifier. */
export function getScopeRef(
  scope: MemoryScope,
  workflowId?: string,
  nodeId?: string,
  roleId?: string,
): string {
  if (scope === "workflow") {
    return (workflowId && workflowId.trim().length > 0) ? workflowId.trim() : "global";
  } else if (scope === "node") {
    const wf = (workflowId && workflowId.trim().length > 0) ? workflowId.trim() : "_";
    const nd = (nodeId && nodeId.trim().length > 0) ? nodeId.trim() : "_";
    return `${wf}:${nd}`;
  } else if (scope === "role") {
    return (roleId && roleId.trim().length > 0) ? roleId.trim() : "global";
  }
  return "global";
}

/**
 * Saves a memory entry. If a memory with the same key exists in the specified scope,
 * it updates the existing entry (upsert behavior).
 */
export async function saveMemory(
  input: SaveMemoryInput,
  userId?: string,
): Promise<SaveMemoryResult> {
  const trimmedKey = input.key.trim();
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

  const scope = input.scope;
  const scopeRef = getScopeRef(scope, input.workflowId, input.nodeId, input.roleId);

  // Check if a memory with this key already exists in this scope
  const keyIndex = await kv.get<string>(["users", uid, "memory_keys", scope, scopeRef, trimmedKey]);

  const now = new Date().toISOString();

  if (keyIndex.value) {
    // Update existing memory
    const existingEntry = await kv.get<Memory>(["users", uid, "memories", keyIndex.value]);
    if (existingEntry.value) {
      const updated: Memory = {
        ...existingEntry.value,
        summary: input.summary.trim(),
        content: input.content,
        source: input.source !== undefined ? input.source : existingEntry.value.source,
        tags: input.tags !== undefined ? input.tags : existingEntry.value.tags,
        accessCount: existingEntry.value.accessCount,
        lastAccessed: existingEntry.value.lastAccessed,
        updatedAt: now,
      };

      const atomic = kv.atomic()
        .set(["users", uid, "memories", updated.id], updated)
        .set(["users", uid, "memories_by_scope", updated.scope, updated.id], updated.id);
      const res = await atomic.commit();
      if (!res.ok) {
        throw new Error(`Failed to update memory with key "${trimmedKey}"`);
      }
      return { memory: updated, created: false };
    }
  }

  // Create new memory
  const id = `mem-${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
  const memory: Memory = {
    id,
    userId: uid,
    key: trimmedKey,
    summary: input.summary.trim(),
    content: input.content,
    scope,
    workflowId: input.workflowId,
    nodeId: input.nodeId,
    roleId: input.roleId,
    source: input.source,
    tags: input.tags,
    accessCount: 0,
    createdAt: now,
    updatedAt: now,
  };

  const atomic = kv.atomic()
    .set(["users", uid, "memories", id], memory)
    .set(["users", uid, "memory_keys", scope, scopeRef, trimmedKey], id)
    .set(["users", uid, "memories_by_scope", memory.scope, id], id);

  if (scope === "workflow" && memory.workflowId) {
    atomic.set(["users", uid, "memories_by_workflow", memory.workflowId, id], id);
  } else if (scope === "node" && memory.nodeId) {
    atomic.set(["users", uid, "memories_by_node", memory.workflowId || "_", memory.nodeId, id], id);
  } else if (scope === "role" && memory.roleId) {
    atomic.set(["users", uid, "memories_by_role", memory.roleId, id], id);
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
 * Lists memories matching the given filters. Returns summaries only (no content),
 * enriched with the lastAccessed timestamp and access count from the memory document.
 */
export async function listMemories(
  filters?: MemoryFilters,
  options?: { userId?: string },
): Promise<MemorySummary[]> {
  const uid = resolveUserId(filters?.userId || options?.userId);
  const kv = await getKv();

  let candidateIds: string[] | null = null;

  if (filters?.roleId) {
    const ids: string[] = [];
    for await (
      const entry of kv.list<string>({ prefix: ["users", uid, "memories_by_role", filters.roleId] })
    ) {
      if (entry.value) ids.push(entry.value);
    }
    candidateIds = ids;
  } else if (filters?.nodeId) {
    const ids: string[] = [];
    const prefix = filters.workflowId
      ? ["users", uid, "memories_by_node", filters.workflowId, filters.nodeId]
      : ["users", uid, "memories_by_node"];
    for await (const entry of kv.list<string>({ prefix })) {
      if (filters.workflowId) {
        if (entry.value) ids.push(entry.value);
      } else {
        // entry.key: ["users", uid, "memories_by_node", wfId, nodeId, memId]
        if (entry.key[4] === filters.nodeId && entry.value) {
          ids.push(entry.value);
        }
      }
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
  } else if (filters?.scope) {
    const ids: string[] = [];
    for await (
      const entry of kv.list<string>({
        prefix: ["users", uid, "memories_by_scope", filters.scope],
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
    if (filters?.workflowId && m.workflowId !== filters.workflowId) return false;
    if (filters?.nodeId && m.nodeId !== filters.nodeId) return false;
    if (filters?.roleId && m.roleId !== filters.roleId) return false;
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
    key: m.key,
    summary: m.summary,
    scope: m.scope,
    workflowId: m.workflowId,
    nodeId: m.nodeId,
    roleId: m.roleId,
    source: m.source,
    tags: m.tags,
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
    if (params.scope) {
      const scopeRef = getScopeRef(params.scope, params.workflowId, params.nodeId, params.roleId);
      const keyEntry = await kv.get<string>([
        "users",
        uid,
        "memory_keys",
        params.scope,
        scopeRef,
        trimmedKey,
      ]);
      if (keyEntry.value) {
        memory = await getMemory(keyEntry.value, uid);
      }
    } else {
      // Look through memory_keys prefixes to find a match
      for await (
        const entry of kv.list<string>({ prefix: ["users", uid, "memory_keys"] })
      ) {
        // entry.key: ["users", uid, "memory_keys", scope, scopeRef, key]
        if (entry.key[5] === trimmedKey && entry.value) {
          const candidate = await getMemory(entry.value, uid);
          if (candidate) {
            if (params.workflowId && candidate.workflowId !== params.workflowId) continue;
            if (params.nodeId && candidate.nodeId !== params.nodeId) continue;
            if (params.roleId && candidate.roleId !== params.roleId) continue;
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
 * Deletes a memory and all its index entries and access logs.
 * Returns { deleted: boolean, accessCount: number }.
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
  } else if (params.key) {
    const trimmedKey = params.key.trim();
    if (params.scope) {
      const scopeRef = getScopeRef(params.scope, params.workflowId, params.nodeId, params.roleId);
      const keyEntry = await kv.get<string>([
        "users",
        uid,
        "memory_keys",
        params.scope,
        scopeRef,
        trimmedKey,
      ]);
      if (keyEntry.value) {
        memory = await getMemory(keyEntry.value, uid);
      }
    } else {
      for await (
        const entry of kv.list<string>({ prefix: ["users", uid, "memory_keys"] })
      ) {
        if (entry.key[5] === trimmedKey && entry.value) {
          const candidate = await getMemory(entry.value, uid);
          if (candidate) {
            if (params.workflowId && candidate.workflowId !== params.workflowId) continue;
            if (params.nodeId && candidate.nodeId !== params.nodeId) continue;
            if (params.roleId && candidate.roleId !== params.roleId) continue;
            memory = candidate;
            break;
          }
        }
      }
    }
  }

  if (!memory) {
    return { deleted: false, accessCount: 0 };
  }

  // Count and collect access log keys
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
  const scopeRef = getScopeRef(memory.scope, memory.workflowId, memory.nodeId, memory.roleId);
  atomic.delete(["users", uid, "memory_keys", memory.scope, scopeRef, memory.key]);
  opCount++;

  // 3. Delete secondary indexes
  atomic.delete(["users", uid, "memories_by_scope", memory.scope, memory.id]);
  opCount++;

  if (memory.scope === "workflow" && memory.workflowId) {
    atomic.delete(["users", uid, "memories_by_workflow", memory.workflowId, memory.id]);
    opCount++;
  } else if (memory.scope === "node" && memory.nodeId) {
    atomic.delete([
      "users",
      uid,
      "memories_by_node",
      memory.workflowId || "_",
      memory.nodeId,
      memory.id,
    ]);
    opCount++;
  } else if (memory.scope === "role" && memory.roleId) {
    atomic.delete(["users", uid, "memories_by_role", memory.roleId, memory.id]);
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

  // Sort by accessedAt ascending
  records.sort((a, b) => a.accessedAt.localeCompare(b.accessedAt));
  return options?.limit ? records.slice(0, options.limit) : records;
}
