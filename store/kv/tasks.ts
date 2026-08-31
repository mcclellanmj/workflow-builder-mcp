/**
 * Deno KV persistence for tasks, task dependencies, atomic claiming, and ready frontier computation.
 */

import type {
  DependencyType,
  ExecutionId,
  HandoffRecord,
  NodeId,
  PipelineTransitionAuditRecord,
  StageAction,
  StageTransitionRule,
  Task,
  TaskComment,
  TaskDependency,
  TaskId,
  TaskPipeline,
  TaskPipelineStage,
  TaskPriority,
  TaskStatus,
  TaskType,
  WorkflowId,
} from "../types.ts";
import {
  ERR_PIPELINE_INVALID_TRANSITION,
  ERR_PIPELINE_MISSING_MANDATORY_NOTES,
  ERR_PIPELINE_PREMATURE_CLOSE,
  ERR_PIPELINE_REJECTION_LIMIT_EXCEEDED,
  ERR_PIPELINE_ROLE_MUTATION_RESTRICTED,
  ERR_PIPELINE_STAGE_ROLE_MISMATCH,
} from "../types.ts";
import { getKv, MAX_ATOMIC_OPS, MAX_GET_MANY_KEYS, resolveUserId } from "./client.ts";
import { ensureRole } from "./roles.ts";
import { getFlowTemplate, instantiatePipelineFromTemplate } from "./pipeline_templates.ts";
import { recordHandoff } from "./handoffs.ts";

/** Input payload for creating a new task. */
export interface CreateTaskInput {
  id?: TaskId;
  userId?: string;
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  type?: TaskType;
  role?: string;
  assignee?: string;
  claimedAt?: string;
  workflowId?: WorkflowId;
  executionId?: ExecutionId;
  nodeId?: NodeId;
  parentTaskId?: TaskId;
  context?: string;
  rejectedApproaches?: string[];
  inputs?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  pipelineTemplateId?: string;
  pipeline?: TaskPipeline;
  acceptanceNotes?: string[];
  closedReason?: string;
  comments?: TaskComment[];
  createdAt?: string;
  updatedAt?: string;
  closedAt?: string;
}

/** Filter criteria for listing tasks. */
export interface TaskFilters {
  workflowId?: WorkflowId;
  executionId?: ExecutionId;
  nodeId?: NodeId;
  status?: TaskStatus | TaskStatus[];
  type?: TaskType | TaskType[];
  assignee?: string;
  role?: string;
  parentTaskId?: TaskId;
  limit?: number;
  userId?: string;
}

/** Filter criteria for computing the ready frontier. */
export interface FrontierFilters {
  workflowId?: WorkflowId;
  executionId?: ExecutionId;
  role?: string;
  type?: TaskType | TaskType[];
  limit?: number;
  userId?: string;
  /** Optional flag: if true, returns only open (unclaimed) ready tasks. Defaults to false. */
  unclaimedOnly?: boolean;
  /** Optional flag: if true, includes epics in the ready frontier. Defaults to false. */
  includeEpics?: boolean;
}

/**
 * Generates a collision-free hash-based task ID, e.g. "tk-a1b2c3".
 */
export function generateTaskId(_title?: string): TaskId {
  const raw = crypto.randomUUID().replace(/-/g, "").slice(0, 6);
  return `tk-${raw}`;
}

/**
 * Creates a new task and updates all relevant secondary indexes.
 * If a role is specified, automatically ensures the role exists.
 */
export async function createTask(
  taskInput: CreateTaskInput,
  userId?: string,
): Promise<Task> {
  const title = taskInput.title?.trim();
  if (!title) {
    throw new Error("Task title cannot be empty");
  }

  const uid = resolveUserId(userId || taskInput.userId);
  const kv = await getKv();

  let pipeline = taskInput.pipeline;
  if (taskInput.pipelineTemplateId && !pipeline) {
    const template = await getFlowTemplate(taskInput.pipelineTemplateId, uid);
    if (!template) {
      throw new Error(`Pipeline template not found: ${taskInput.pipelineTemplateId}`);
    }
    pipeline = instantiatePipelineFromTemplate(template);
  }

  let role = taskInput.role?.trim();
  if (!role && pipeline && pipeline.stages && pipeline.stages.length > 0) {
    const activeStage = pipeline.stages[pipeline.currentStageIndex ?? 0];
    if (activeStage?.role) {
      role = activeStage.role;
    }
  }

  // If role is set, auto-ensure role
  if (role && role.length > 0) {
    await ensureRole(role, uid);
  }

  // Generate a unique ID if not provided, ensuring no collision
  let id = taskInput.id;
  if (!id) {
    let attempts = 0;
    while (attempts < 10) {
      const candidate = generateTaskId(title);
      const existing = await kv.get<Task>(["users", uid, "tasks", candidate]);
      if (!existing.value) {
        id = candidate;
        break;
      }
      attempts++;
    }
    if (!id) {
      id = `tk-${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
    }
  }

  const now = new Date().toISOString();
  const task: Task = {
    ...taskInput,
    id,
    userId: uid,
    title,
    role: role || undefined,
    pipeline,
    acceptanceNotes: taskInput.acceptanceNotes ?? [],
    description: taskInput.description ?? "",
    status: taskInput.status || (taskInput.assignee ? "claimed" : "open"),
    type: taskInput.type || "task",
    comments: taskInput.comments ?? [],
    createdAt: taskInput.createdAt || now,
    updatedAt: taskInput.updatedAt || now,
  };

  const atomic = kv.atomic().set(["users", uid, "tasks", id], task);

  // Secondary indexes
  if (task.type) {
    atomic.set(["users", uid, "tasks_by_type", task.type, id], id);
  }
  if (task.workflowId) {
    atomic.set(["users", uid, "tasks_by_workflow", task.workflowId, id], id);
  }
  if (task.executionId) {
    atomic.set(["users", uid, "tasks_by_execution", task.executionId, id], id);
  }
  if (task.parentTaskId) {
    atomic.set(["users", uid, "tasks_by_parent", task.parentTaskId, id], id);
    atomic.set(["users", uid, "parent_children", task.parentTaskId, id], id);
  }
  if (task.assignee) {
    atomic.set(["users", uid, "tasks_by_assignee", task.assignee, id], id);
  }
  if (task.role) {
    atomic.set(["users", uid, "tasks_by_role", task.role, id], id);
  }

  const res = await atomic.commit();
  if (!res.ok) {
    throw new Error(`Failed to persist task ${id}`);
  }

  return task;
}

/**
 * Creates multiple tasks in bulk with atomic batch commits and secondary index synchronization.
 */
export async function createTasks(
  taskInputs: CreateTaskInput[],
  userId?: string,
): Promise<Task[]> {
  if (taskInputs.length === 0) return [];
  const uid = resolveUserId(userId || taskInputs[0]?.userId);
  const kv = await getKv();

  // Auto-resolve pipelines and roles
  const preparedInputs: Array<
    CreateTaskInput & { resolvedPipeline?: TaskPipeline; resolvedRole?: string }
  > = [];
  const roles = new Set<string>();

  for (const input of taskInputs) {
    let pipeline = input.pipeline;
    if (input.pipelineTemplateId && !pipeline) {
      const template = await getFlowTemplate(input.pipelineTemplateId, uid);
      if (!template) {
        throw new Error(`Pipeline template not found: ${input.pipelineTemplateId}`);
      }
      pipeline = instantiatePipelineFromTemplate(template);
    }

    let role = input.role?.trim();
    if (!role && pipeline && pipeline.stages && pipeline.stages.length > 0) {
      const activeStage = pipeline.stages[pipeline.currentStageIndex ?? 0];
      if (activeStage?.role) {
        role = activeStage.role;
      }
    }

    if (role && role.length > 0) {
      roles.add(role);
    }

    preparedInputs.push({
      ...input,
      resolvedPipeline: pipeline,
      resolvedRole: role,
    });
  }

  for (const role of roles) {
    await ensureRole(role, uid);
  }

  const now = new Date().toISOString();
  const createdTasks: Task[] = [];
  let atomic = kv.atomic();
  let opCount = 0;

  for (const taskInput of preparedInputs) {
    const title = taskInput.title?.trim();
    if (!title) {
      throw new Error("Task title cannot be empty");
    }

    const id = taskInput.id || generateTaskId(title);
    const task: Task = {
      ...taskInput,
      id,
      userId: uid,
      title,
      role: taskInput.resolvedRole || undefined,
      pipeline: taskInput.resolvedPipeline,
      acceptanceNotes: taskInput.acceptanceNotes ?? [],
      description: taskInput.description ?? "",
      status: taskInput.status || (taskInput.assignee ? "claimed" : "open"),
      type: taskInput.type || "task",
      comments: taskInput.comments ?? [],
      createdAt: taskInput.createdAt || now,
      updatedAt: taskInput.updatedAt || now,
    };

    atomic.set(["users", uid, "tasks", id], task);
    opCount++;

    if (task.type) {
      atomic.set(["users", uid, "tasks_by_type", task.type, id], id);
      opCount++;
    }
    if (task.workflowId) {
      atomic.set(["users", uid, "tasks_by_workflow", task.workflowId, id], id);
      opCount++;
    }
    if (task.executionId) {
      atomic.set(["users", uid, "tasks_by_execution", task.executionId, id], id);
      opCount++;
    }
    if (task.parentTaskId) {
      atomic.set(["users", uid, "tasks_by_parent", task.parentTaskId, id], id);
      atomic.set(["users", uid, "parent_children", task.parentTaskId, id], id);
      opCount += 2;
    }
    if (task.assignee) {
      atomic.set(["users", uid, "tasks_by_assignee", task.assignee, id], id);
      opCount++;
    }
    if (task.role) {
      atomic.set(["users", uid, "tasks_by_role", task.role, id], id);
      opCount++;
    }

    createdTasks.push(task);

    if (opCount >= MAX_ATOMIC_OPS - 10) {
      const res = await atomic.commit();
      if (!res.ok) {
        throw new Error("Failed to persist task batch");
      }
      atomic = kv.atomic();
      opCount = 0;
    }
  }

  if (opCount > 0) {
    const res = await atomic.commit();
    if (!res.ok) {
      throw new Error("Failed to persist task batch");
    }
  }

  return createdTasks;
}

/**
 * Retrieves a task by its ID. Returns null if not found.
 */
export async function getTask(taskId: TaskId, userId?: string): Promise<Task | null> {
  const uid = resolveUserId(userId);
  const kv = await getKv();

  // Try active tasks namespace first
  const entry = await kv.get<Task>(["users", uid, "tasks", taskId]);
  if (entry.value) {
    return { ...entry.value, comments: entry.value.comments ?? [] };
  }

  // Fallback to closed tasks namespace
  const closedEntry = await kv.get<Task>(["users", uid, "closedTasks", taskId]);
  if (closedEntry.value) {
    return { ...closedEntry.value, comments: closedEntry.value.comments ?? [] };
  }

  return null;
}

/**
 * Fetches multiple tasks by their IDs in bulk using chunked kv.getMany calls.
 * Checks active tasks namespace first, and falls back to closed tasks namespace for missing entries.
 */
export async function getTasks(taskIds: TaskId[], userId?: string): Promise<Task[]> {
  if (taskIds.length === 0) return [];
  const uid = resolveUserId(userId);
  const kv = await getKv();
  const foundMap = new Map<string, Task>();
  const missingIds: string[] = [];

  for (let i = 0; i < taskIds.length; i += MAX_GET_MANY_KEYS) {
    const chunk = taskIds.slice(i, i + MAX_GET_MANY_KEYS);
    const keys = chunk.map((id) => ["users", uid, "tasks", id]);
    const entries = await kv.getMany<Task[]>(keys);
    for (let j = 0; j < entries.length; j++) {
      const entry = entries[j];
      const id = chunk[j];
      if (entry.value) {
        foundMap.set(id, { ...entry.value, comments: entry.value.comments ?? [] });
      } else {
        missingIds.push(id);
      }
    }
  }

  if (missingIds.length > 0) {
    for (let i = 0; i < missingIds.length; i += MAX_GET_MANY_KEYS) {
      const chunk = missingIds.slice(i, i + MAX_GET_MANY_KEYS);
      const keys = chunk.map((id) => ["users", uid, "closedTasks", id]);
      const entries = await kv.getMany<Task[]>(keys);
      for (let j = 0; j < entries.length; j++) {
        const entry = entries[j];
        const id = chunk[j];
        if (entry.value) {
          foundMap.set(id, { ...entry.value, comments: entry.value.comments ?? [] });
        }
      }
    }
  }

  const results: Task[] = [];
  for (const id of taskIds) {
    const t = foundMap.get(id);
    if (t) results.push(t);
  }
  return results;
}

/**
 * Lists tasks matching the specified filters.
 */
export async function listTasks(
  filters?: TaskFilters,
  options?: { userId?: string },
): Promise<Task[]> {
  const uid = resolveUserId(filters?.userId || options?.userId);
  const kv = await getKv();

  let candidateTasks: Task[] = [];

  // Use secondary index if applicable
  if (filters?.workflowId) {
    const ids: string[] = [];
    for await (
      const entry of kv.list<string>({
        prefix: ["users", uid, "tasks_by_workflow", filters.workflowId],
      })
    ) {
      if (entry.value) ids.push(entry.value);
    }
    candidateTasks = await fetchTasksByIds(kv, uid, ids);
  } else if (filters?.executionId) {
    const ids: string[] = [];
    for await (
      const entry of kv.list<string>({
        prefix: ["users", uid, "tasks_by_execution", filters.executionId],
      })
    ) {
      if (entry.value) ids.push(entry.value);
    }
    candidateTasks = await fetchTasksByIds(kv, uid, ids);
  } else if (filters?.parentTaskId) {
    const ids: string[] = [];
    for await (
      const entry of kv.list<string>({
        prefix: ["users", uid, "tasks_by_parent", filters.parentTaskId],
      })
    ) {
      if (entry.value) ids.push(entry.value);
    }
    candidateTasks = await fetchTasksByIds(kv, uid, ids);
  } else if (filters?.assignee) {
    const ids: string[] = [];
    for await (
      const entry of kv.list<string>({
        prefix: ["users", uid, "tasks_by_assignee", filters.assignee],
      })
    ) {
      if (entry.value) ids.push(entry.value);
    }
    candidateTasks = await fetchTasksByIds(kv, uid, ids);
  } else if (filters?.role) {
    const ids: string[] = [];
    for await (
      const entry of kv.list<string>({
        prefix: ["users", uid, "tasks_by_role", filters.role],
      })
    ) {
      if (entry.value) ids.push(entry.value);
    }
    candidateTasks = await fetchTasksByIds(kv, uid, ids);
  } else {
    for await (const entry of kv.list<Task>({ prefix: ["users", uid, "tasks"] })) {
      if (entry.value && typeof entry.value === "object") {
        candidateTasks.push({
          ...entry.value,
          comments: entry.value.comments ?? [],
        });
      }
    }
  }

  // In-memory filter for remaining fields
  let filtered = candidateTasks.filter((t) => {
    if (filters?.workflowId && t.workflowId !== filters.workflowId) return false;
    if (filters?.executionId && t.executionId !== filters.executionId) return false;
    if (filters?.nodeId && t.nodeId !== filters.nodeId) return false;
    if (filters?.assignee && t.assignee !== filters.assignee) return false;
    if (filters?.role && t.role !== filters.role) return false;
    if (filters?.parentTaskId && t.parentTaskId !== filters.parentTaskId) return false;
    if (filters?.type) {
      if (Array.isArray(filters.type)) {
        if (!t.type || !filters.type.includes(t.type)) return false;
      } else {
        if (t.type !== filters.type) return false;
      }
    }
    if (filters?.status) {
      if (Array.isArray(filters.status)) {
        if (!filters.status.includes(t.status)) return false;
      } else {
        if (t.status !== filters.status) return false;
      }
    }
    return true;
  });

  if (filters?.limit && filters.limit > 0) {
    filtered = filtered.slice(0, filters.limit);
  }

  return filtered;
}

/** Helper to fetch multiple tasks by IDs using getMany chunks. */
async function fetchTasksByIds(kv: Deno.Kv, uid: string, ids: string[]): Promise<Task[]> {
  const results: Task[] = [];
  for (let i = 0; i < ids.length; i += MAX_GET_MANY_KEYS) {
    const chunk = ids.slice(i, i + MAX_GET_MANY_KEYS);
    const keys = chunk.map((id) => ["users", uid, "tasks", id]);
    const entries = await kv.getMany<Task[]>(keys);
    for (const entry of entries) {
      if (entry.value) {
        results.push({
          ...entry.value,
          comments: entry.value.comments ?? [],
        });
      }
    }
  }
  return results;
}
export async function moveTaskToClosed(uid: string, task: Task): Promise<void> {
  const kv = await getKv();
  // Atomic: set closed entry, delete active entry, remove secondary indexes
  let atomic = kv.atomic()
    .set(["users", uid, "closedTasks", task.id], task)
    .delete(["users", uid, "tasks", task.id]);
  // Remove secondary indexes (only for active namespace)
  if (task.type) atomic = atomic.delete(["users", uid, "tasks_by_type", task.type, task.id]);
  if (task.workflowId) {
    atomic = atomic.delete(["users", uid, "tasks_by_workflow", task.workflowId, task.id]);
  }
  if (task.executionId) {
    atomic = atomic.delete(["users", uid, "tasks_by_execution", task.executionId, task.id]);
  }
  if (task.parentTaskId) {
    atomic = atomic.delete(["users", uid, "tasks_by_parent", task.parentTaskId, task.id]);
  }
  if (task.assignee) {
    atomic = atomic.delete(["users", uid, "tasks_by_assignee", task.assignee, task.id]);
  }
  const res = await atomic.commit();
  if (!res.ok) {
    throw new Error(`Failed to move task ${task.id} to closed namespace`);
  }
}

export async function moveTaskToActive(uid: string, task: Task): Promise<void> {
  const kv = await getKv();
  // Atomic: set active entry, delete closed entry, add secondary indexes
  let atomic = kv.atomic()
    .set(["users", uid, "tasks", task.id], task)
    .delete(["users", uid, "closedTasks", task.id]);
  // Recreate secondary indexes
  if (task.type) atomic = atomic.set(["users", uid, "tasks_by_type", task.type, task.id], task.id);
  if (task.workflowId) {
    atomic = atomic.set(["users", uid, "tasks_by_workflow", task.workflowId, task.id], task.id);
  }
  if (task.executionId) {
    atomic = atomic.set(["users", uid, "tasks_by_execution", task.executionId, task.id], task.id);
  }
  if (task.parentTaskId) {
    atomic = atomic.set(["users", uid, "tasks_by_parent", task.parentTaskId, task.id], task.id);
  }
  if (task.assignee) {
    atomic = atomic.set(["users", uid, "tasks_by_assignee", task.assignee, task.id], task.id);
  }
  const res = await atomic.commit();
  if (!res.ok) {
    throw new Error(`Failed to move task ${task.id} to active namespace`);
  }
}
export async function listClosedTasks(
  filters?: TaskFilters,
  options?: { userId?: string },
): Promise<Task[]> {
  const uid = resolveUserId(filters?.userId || options?.userId);
  const kv = await getKv();

  const candidateTasks: Task[] = [];
  // Iterate over closedTasks namespace (no secondary indexes)
  for await (const entry of kv.list<Task>({ prefix: ["users", uid, "closedTasks"] })) {
    if (entry.value && typeof entry.value === "object") {
      candidateTasks.push({
        ...entry.value,
        comments: entry.value.comments ?? [],
      });
    }
  }

  // In-memory filter similar to listTasks
  let filtered = candidateTasks.filter((t) => {
    if (filters?.workflowId && t.workflowId !== filters.workflowId) return false;
    if (filters?.executionId && t.executionId !== filters.executionId) return false;
    if (filters?.nodeId && t.nodeId !== filters.nodeId) return false;
    if (filters?.assignee && t.assignee !== filters.assignee) return false;
    if (filters?.role && t.role !== filters.role) return false;
    if (filters?.parentTaskId && t.parentTaskId !== filters.parentTaskId) return false;
    if (filters?.type) {
      if (Array.isArray(filters.type)) {
        if (!t.type || !filters.type.includes(t.type)) return false;
      } else {
        if (t.type !== filters.type) return false;
      }
    }
    if (filters?.status) {
      if (Array.isArray(filters.status)) {
        if (!filters.status.includes(t.status)) return false;
      } else {
        if (t.status !== filters.status) return false;
      }
    }
    return true;
  });

  if (filters?.limit && filters.limit > 0) {
    filtered = filtered.slice(0, filters.limit);
  }
  return filtered;
}

/**
 * Updates an existing task and synchronizes secondary indexes.
 */
export async function updateTask(
  taskId: TaskId,
  updates: Partial<Task>,
  userId?: string,
  options?: { allowPipelineOverride?: boolean },
): Promise<Task> {
  const uid = resolveUserId(userId);
  const kv = await getKv();
  // Determine current namespace (active or closed)
  let entry = await kv.get<Task>(["users", uid, "tasks", taskId]);
  let namespace = "tasks";
  if (!entry.value) {
    entry = await kv.get<Task>(["users", uid, "closedTasks", taskId]);
    namespace = "closedTasks";
  }
  if (!entry.value) {
    throw new Error(`Task not found: ${taskId}`);
  }
  const existing = entry.value;

  if (existing.pipeline && !options?.allowPipelineOverride) {
    if (updates.role !== undefined && updates.role !== existing.role) {
      throw new Error(
        `${ERR_PIPELINE_ROLE_MUTATION_RESTRICTED}: Cannot directly mutate role on pipelined task '${taskId}'. Role is determined by the active pipeline stage. Use handoffTask or overrideTaskPipeline.`,
      );
    }
  }

  if (updates.role && updates.role.trim().length > 0 && updates.role !== existing.role) {
    await ensureRole(updates.role.trim(), uid);
  }

  const now = new Date().toISOString();
  const updated: Task = {
    ...existing,
    ...updates,
    id: taskId,
    userId: uid,
    updatedAt: now,
  };

  const atomic = kv.atomic().check(entry).set(["users", uid, namespace, taskId], updated);

  // Synchronize secondary indexes on change
  if (existing.workflowId !== updated.workflowId) {
    if (existing.workflowId) {
      atomic.delete(["users", uid, "tasks_by_workflow", existing.workflowId, taskId]);
    }
    if (updated.workflowId) {
      atomic.set(["users", uid, "tasks_by_workflow", updated.workflowId, taskId], taskId);
    }
  }

  if (existing.executionId !== updated.executionId) {
    if (existing.executionId) {
      atomic.delete(["users", uid, "tasks_by_execution", existing.executionId, taskId]);
    }
    if (updated.executionId) {
      atomic.set(["users", uid, "tasks_by_execution", updated.executionId, taskId], taskId);
    }
  }

  if (existing.parentTaskId !== updated.parentTaskId) {
    if (existing.parentTaskId) {
      atomic.delete(["users", uid, "tasks_by_parent", existing.parentTaskId, taskId]);
    }
    if (updated.parentTaskId) {
      atomic.set(["users", uid, "tasks_by_parent", updated.parentTaskId, taskId], taskId);
    }
  }

  if (existing.assignee !== updated.assignee) {
    if (existing.assignee) {
      atomic.delete(["users", uid, "tasks_by_assignee", existing.assignee, taskId]);
    }
    if (updated.assignee) {
      atomic.set(["users", uid, "tasks_by_assignee", updated.assignee, taskId], taskId);
    }
  }

  if (existing.role !== updated.role) {
    if (existing.role) {
      atomic.delete(["users", uid, "tasks_by_role", existing.role, taskId]);
    }
    if (updated.role) {
      atomic.set(["users", uid, "tasks_by_role", updated.role, taskId], taskId);
    }
  }

  if (existing.type !== updated.type) {
    if (existing.type) {
      atomic.delete(["users", uid, "tasks_by_type", existing.type, taskId]);
    }
    if (updated.type) {
      atomic.set(["users", uid, "tasks_by_type", updated.type, taskId], taskId);
    }
  }

  const res = await atomic.commit();
  if (!res.ok) {
    throw new Error(`Failed to update task ${taskId}: concurrent modification detected`);
  }

  return updated;
}

/**
 * Deletes a task, all its secondary indexes, and its dependency edges.
 */
export async function deleteTask(taskId: TaskId, userId?: string): Promise<void> {
  const uid = resolveUserId(userId);
  const kv = await getKv();

  const task = await getTask(taskId, uid);
  if (!task) return;

  let atomic = kv.atomic();
  let opCount = 0;

  const commitBatch = async (): Promise<void> => {
    if (opCount > 0) {
      await atomic.commit();
      atomic = kv.atomic();
      opCount = 0;
    }
  };

  // Determine namespace based on task status (closed or active)
  const namespace = task.status === "closed" || task.status === "wontfix" ? "closedTasks" : "tasks";

  // 1. Delete main task entry from the appropriate namespace
  atomic.delete(["users", uid, namespace, taskId]);
  opCount++;

  // 2. Delete secondary indexes only for active tasks namespace
  if (namespace === "tasks") {
    if (task.type) {
      atomic.delete(["users", uid, "tasks_by_type", task.type, taskId]);
      opCount++;
    }
    if (task.workflowId) {
      atomic.delete(["users", uid, "tasks_by_workflow", task.workflowId, taskId]);
      opCount++;
    }
    if (task.executionId) {
      atomic.delete(["users", uid, "tasks_by_execution", task.executionId, taskId]);
      opCount++;
    }
    if (task.parentTaskId) {
      atomic.delete(["users", uid, "tasks_by_parent", task.parentTaskId, taskId]);
      atomic.delete(["users", uid, "parent_children", task.parentTaskId, taskId]);
      opCount += 2;
    }
    if (task.assignee) {
      atomic.delete(["users", uid, "tasks_by_assignee", task.assignee, taskId]);
      opCount++;
    }
    if (task.role) {
      atomic.delete(["users", uid, "tasks_by_role", task.role, taskId]);
      opCount++;
    }
  }

  // 3. Delete outbound dependencies (tasks this task blocks or relates to)
  for await (
    const entry of kv.list<TaskDependency>({ prefix: ["users", uid, "task_deps", taskId] })
  ) {
    atomic.delete(entry.key);
    atomic.delete(["users", uid, "task_deps_rev", entry.value.toTaskId, taskId]);
    opCount += 2;
    if (opCount >= MAX_ATOMIC_OPS) await commitBatch();
  }

  // 4. Delete inbound dependencies (tasks that block this task)
  for await (
    const entry of kv.list<TaskDependency>({ prefix: ["users", uid, "task_deps_rev", taskId] })
  ) {
    atomic.delete(entry.key);
    atomic.delete(["users", uid, "task_deps", entry.value.fromTaskId, taskId]);
    opCount += 2;
    if (opCount >= MAX_ATOMIC_OPS) await commitBatch();
  }

  // 5. Delete handoff records for this task
  for await (const entry of kv.list({ prefix: ["users", uid, "handoffs", taskId] })) {
    atomic.delete(entry.key);
    opCount++;
    if (opCount >= MAX_ATOMIC_OPS) await commitBatch();
  }

  await commitBatch();
}

// ---------------------------------------------------------------------------
// Dependency Management
// ---------------------------------------------------------------------------

/**
 * Adds a directional dependency between two tasks.
 * If type is "blocks" or "waits-for" and fromTask is not closed, marks toTask as "blocked" if it is "open".
 */
export async function addDependency(
  fromTaskId: TaskId,
  toTaskId: TaskId,
  type: DependencyType = "blocks",
  userId?: string,
): Promise<TaskDependency> {
  if (fromTaskId === toTaskId) {
    throw new Error("A task cannot depend on itself");
  }

  const uid = resolveUserId(userId);
  const kv = await getKv();

  const [fromTask, toTask] = await Promise.all([
    getTask(fromTaskId, uid),
    getTask(toTaskId, uid),
  ]);

  if (!fromTask) {
    throw new Error(`Source task not found: ${fromTaskId}`);
  }
  if (!toTask) {
    throw new Error(`Target task not found: ${toTaskId}`);
  }

  const dep: TaskDependency = {
    id: crypto.randomUUID(),
    fromTaskId,
    toTaskId,
    type,
    createdAt: new Date().toISOString(),
  };

  const atomic = kv.atomic()
    .set(["users", uid, "task_deps", fromTaskId, toTaskId], dep)
    .set(["users", uid, "task_deps_rev", toTaskId, fromTaskId], dep);

  // If adding a blocking dependency from an unclosed task to an open task, mark target blocked
  const isBlockingType = type === "blocks" || type === "waits-for";
  const isFromOpen = fromTask.status !== "closed" && fromTask.status !== "wontfix";
  if (isBlockingType && isFromOpen && toTask.status === "open") {
    const updatedToTask: Task = {
      ...toTask,
      status: "blocked",
      updatedAt: new Date().toISOString(),
    };
    atomic.set(["users", uid, "tasks", toTaskId], updatedToTask);
  }

  const res = await atomic.commit();
  if (!res.ok) {
    throw new Error(`Failed to add dependency between ${fromTaskId} and ${toTaskId}`);
  }

  return dep;
}

/**
 * Adds multiple task dependencies in bulk with atomic batch commits and automatic status transitions.
 */
export async function addDependencies(
  dependencies: Array<{ fromTaskId: TaskId; toTaskId: TaskId; type?: DependencyType }>,
  userId?: string,
): Promise<TaskDependency[]> {
  if (dependencies.length === 0) return [];
  const uid = resolveUserId(userId);
  const kv = await getKv();

  // Collect all unique task IDs to batch-fetch
  const taskIdsSet = new Set<TaskId>();
  for (const dep of dependencies) {
    if (dep.fromTaskId === dep.toTaskId) {
      throw new Error("A task cannot depend on itself");
    }
    taskIdsSet.add(dep.fromTaskId);
    taskIdsSet.add(dep.toTaskId);
  }

  const fetchedTasks = await getTasks(Array.from(taskIdsSet), uid);
  const taskMap = new Map<string, Task>(fetchedTasks.map((t) => [t.id, t]));

  const createdDeps: TaskDependency[] = [];
  const now = new Date().toISOString();
  let atomic = kv.atomic();
  let opCount = 0;

  for (const { fromTaskId, toTaskId, type = "blocks" } of dependencies) {
    const fromTask = taskMap.get(fromTaskId);
    const toTask = taskMap.get(toTaskId);
    if (!fromTask) throw new Error(`Source task not found: ${fromTaskId}`);
    if (!toTask) throw new Error(`Target task not found: ${toTaskId}`);

    const dep: TaskDependency = {
      id: crypto.randomUUID(),
      fromTaskId,
      toTaskId,
      type,
      createdAt: now,
    };

    atomic.set(["users", uid, "task_deps", fromTaskId, toTaskId], dep);
    atomic.set(["users", uid, "task_deps_rev", toTaskId, fromTaskId], dep);
    opCount += 2;

    const isBlockingType = type === "blocks" || type === "waits-for";
    const isFromOpen = fromTask.status !== "closed" && fromTask.status !== "wontfix";
    if (isBlockingType && isFromOpen && toTask.status === "open") {
      toTask.status = "blocked";
      toTask.updatedAt = now;
      atomic.set(["users", uid, "tasks", toTaskId], toTask);
      opCount++;
    }

    createdDeps.push(dep);

    if (opCount >= MAX_ATOMIC_OPS - 10) {
      const res = await atomic.commit();
      if (!res.ok) throw new Error("Failed to commit dependency batch");
      atomic = kv.atomic();
      opCount = 0;
    }
  }

  if (opCount > 0) {
    const res = await atomic.commit();
    if (!res.ok) throw new Error("Failed to commit dependency batch");
  }

  return createdDeps;
}

/**
 * Removes a dependency between two tasks.
 * If removing this unblocks toTask (i.e. all remaining blockers are closed), transitions toTask from "blocked" to "open".
 */
export async function removeDependency(
  fromTaskId: TaskId,
  toTaskId: TaskId,
  userId?: string,
): Promise<void> {
  const uid = resolveUserId(userId);
  const kv = await getKv();

  const atomic = kv.atomic()
    .delete(["users", uid, "task_deps", fromTaskId, toTaskId])
    .delete(["users", uid, "task_deps_rev", toTaskId, fromTaskId]);

  const res = await atomic.commit();
  if (!res.ok) {
    throw new Error(`Failed to remove dependency between ${fromTaskId} and ${toTaskId}`);
  }

  // Check if toTask was blocked and now has zero unresolved blockers
  const toTask = await getTask(toTaskId, uid);
  if (toTask && toTask.status === "blocked") {
    const remainingDeps = await getDependencies(toTaskId, "blocked-by", uid);
    let allResolved = true;
    for (const dep of remainingDeps) {
      if (dep.type === "blocks" || dep.type === "waits-for") {
        const blocker = await getTask(dep.fromTaskId, uid);
        if (blocker && blocker.status !== "closed" && blocker.status !== "wontfix") {
          allResolved = false;
          break;
        }
      }
    }
    if (allResolved) {
      await updateTask(toTaskId, { status: "open" }, uid);
    }
  }
}

/**
 * Retrieves dependencies for a task.
 * - "blocking": returns tasks that THIS task is blocking (outbound dependencies)
 * - "blocked-by": returns tasks that block THIS task (inbound dependencies)
 */
export async function getDependencies(
  taskId: TaskId,
  direction: "blocking" | "blocked-by",
  userId?: string,
): Promise<TaskDependency[]> {
  const uid = resolveUserId(userId);
  const kv = await getKv();
  const deps: TaskDependency[] = [];

  const prefix = direction === "blocking"
    ? ["users", uid, "task_deps", taskId]
    : ["users", uid, "task_deps_rev", taskId];

  for await (const entry of kv.list<TaskDependency>({ prefix })) {
    if (entry.value) {
      deps.push(entry.value);
    }
  }

  return deps;
}

// ---------------------------------------------------------------------------
// Ready Frontier & Work Claiming
// ---------------------------------------------------------------------------

/**
 * Computes the claimable ready frontier:
 * Finds candidate tasks with status "open", "claimed", or "blocked".
 * For each, evaluates inbound blocking dependencies ("blocks" and "waits-for").
 * If all blockers are closed/wontfix (or none exist), the task is ready.
 * Unblocks tasks currently marked "blocked" to "open".
 */
export async function computeReadyFrontier(
  filters?: FrontierFilters,
): Promise<Task[]> {
  const uid = resolveUserId(filters?.userId);

  // 1. Find all candidate tasks (status: open, claimed, or blocked)
  const candidateStatuses: TaskStatus[] = filters?.unclaimedOnly
    ? ["open", "blocked"]
    : ["open", "claimed", "blocked"];

  let candidateTasks = await listTasks({
    workflowId: filters?.workflowId,
    executionId: filters?.executionId,
    role: filters?.role,
    status: candidateStatuses,
    userId: uid,
  });

  // By default, exclude tasks with type: "epic" from ready frontier unless explicitly requested
  if (!filters?.includeEpics && !filters?.type) {
    candidateTasks = candidateTasks.filter((t) => t.type !== "epic");
  } else if (filters?.type) {
    const allowed = Array.isArray(filters.type) ? filters.type : [filters.type];
    candidateTasks = candidateTasks.filter((t) => t.type && allowed.includes(t.type));
  }

  if (candidateTasks.length === 0) {
    return [];
  }

  const kv = await getKv();

  // 2. Fetch all inbound dependencies in a single batch prefix query and group by toTaskId in memory
  const inboundDepsByTarget = new Map<TaskId, TaskDependency[]>();
  for await (
    const entry of kv.list<TaskDependency>({ prefix: ["users", uid, "task_deps_rev"] })
  ) {
    if (entry.value) {
      const targetId = entry.value.toTaskId;
      let deps = inboundDepsByTarget.get(targetId);
      if (!deps) {
        deps = [];
        inboundDepsByTarget.set(targetId, deps);
      }
      deps.push(entry.value);
    }
  }

  // 3. Deduplicate all required blocker task IDs (dep.fromTaskId) across all candidates
  const blockerIdsSet = new Set<TaskId>();
  for (const task of candidateTasks) {
    const inboundDeps = inboundDepsByTarget.get(task.id) ?? [];
    for (const dep of inboundDeps) {
      if (dep.type === "blocks" || dep.type === "waits-for") {
        blockerIdsSet.add(dep.fromTaskId);
      }
    }
  }

  // 4. Batch fetch all blocker tasks using kv.getMany (via fetchTasksByIds) and construct map
  const blockerTasks = blockerIdsSet.size > 0
    ? await fetchTasksByIds(kv, uid, Array.from(blockerIdsSet))
    : [];
  const blockerMap = new Map<TaskId, Task>();
  for (const task of blockerTasks) {
    blockerMap.set(task.id, task);
  }

  // 5. Evaluate blocker status in-memory with zero extra KV round-trips
  const readyTasks: Task[] = [];

  for (const task of candidateTasks) {
    const inboundDeps = inboundDepsByTarget.get(task.id) ?? [];
    let isBlocked = false;

    for (const dep of inboundDeps) {
      if (dep.type === "blocks" || dep.type === "waits-for") {
        const blocker = blockerMap.get(dep.fromTaskId);
        if (blocker && blocker.status !== "closed" && blocker.status !== "wontfix") {
          isBlocked = true;
          break;
        }
      }
    }

    if (!isBlocked) {
      // If task was blocked, transition to open
      if (task.status === "blocked") {
        const updated = await updateTask(task.id, { status: "open" }, uid);
        readyTasks.push(updated);
      } else {
        readyTasks.push(task);
      }
    } else if (task.status === "open") {
      // If task was open but has unresolved blockers, ensure its status is marked blocked
      await updateTask(task.id, { status: "blocked" }, uid);
    }
  }

  if (filters?.limit && filters.limit > 0) {
    return readyTasks.slice(0, filters.limit);
  }

  return readyTasks;
}

/**
 * Atomically claims a task for an assignee using Deno KV optimistic check-and-set.
 * Throws an error if the task does not exist, cannot be claimed, or is concurrently modified.
 */
export async function claimTask(
  taskId: TaskId,
  assignee: string,
  userId?: string,
  claimantRole?: string,
): Promise<Task> {
  const trimmedAssignee = assignee.trim();
  if (!trimmedAssignee) {
    throw new Error("Assignee cannot be empty");
  }

  const uid = resolveUserId(userId);
  const kv = await getKv();

  const entry = await kv.get<Task>(["users", uid, "tasks", taskId]);
  if (!entry.value) {
    throw new Error(`Task not found: ${taskId}`);
  }

  const current = entry.value;
  if (current.status !== "open" && current.status !== "blocked") {
    throw new Error(
      `Task ${taskId} cannot be claimed because its current status is "${current.status}"`,
    );
  }

  const now = new Date().toISOString();
  let updatedPipeline = current.pipeline;

  // Enforce pipeline role matching if task is pipelined
  if (current.pipeline) {
    const currentStageIndex = current.pipeline.currentStageIndex ?? 0;
    const activeStage = current.pipeline.stages[currentStageIndex] ||
      current.pipeline.stages.find((s) => s.id === current.pipeline!.currentStageId);

    if (activeStage) {
      if (claimantRole && claimantRole.trim() && claimantRole.trim() !== activeStage.role) {
        throw new Error(
          `${ERR_PIPELINE_STAGE_ROLE_MISMATCH}: Task '${taskId}' active stage '${activeStage.id}' requires role '${activeStage.role}', but claimant specified role '${claimantRole.trim()}'`,
        );
      }

      const updatedStages = current.pipeline.stages.map((st, idx) => {
        if (idx === currentStageIndex) {
          return {
            ...st,
            status: "active" as const,
            assignee: trimmedAssignee,
            startedAt: st.startedAt || now,
          };
        }
        return st;
      });

      updatedPipeline = {
        ...current.pipeline,
        stages: updatedStages,
      };
    }
  }

  // If currently blocked, check if blockers have resolved
  if (current.status === "blocked") {
    const blockers = await getDependencies(taskId, "blocked-by", uid);
    for (const dep of blockers) {
      if (dep.type === "blocks" || dep.type === "waits-for") {
        const blockerTask = await getTask(dep.fromTaskId, uid);
        if (blockerTask && blockerTask.status !== "closed" && blockerTask.status !== "wontfix") {
          throw new Error(
            `Task ${taskId} cannot be claimed because it is blocked by task ${dep.fromTaskId}`,
          );
        }
      }
    }
  }

  const updated: Task = {
    ...current,
    status: "claimed",
    assignee: trimmedAssignee,
    claimedAt: now,
    updatedAt: now,
    pipeline: updatedPipeline,
  };

  const atomic = kv.atomic()
    .check(entry)
    .set(["users", uid, "tasks", taskId], updated)
    .set(["users", uid, "tasks_by_assignee", trimmedAssignee, taskId], taskId);

  if (current.assignee && current.assignee !== trimmedAssignee) {
    atomic.delete(["users", uid, "tasks_by_assignee", current.assignee, taskId]);
  }

  const commitRes = await atomic.commit();
  if (!commitRes.ok) {
    throw new Error(`Failed to claim task ${taskId}: concurrent modification detected`);
  }

  return updated;
}

/**
 * Closes a task, records reason and timestamp, evaluates all dependent tasks,
 * and unblocks any whose blocking dependencies are now completely resolved.
 * Returns the closed task and the list of newly unblocked tasks.
 */
export async function closeTask(
  taskId: TaskId,
  reason?: string,
  userId?: string,
  options?: { allowPipelineOverride?: boolean },
): Promise<{ task: Task; unblockedTasks: Task[] }> {
  const uid = resolveUserId(userId);
  const task = await getTask(taskId, uid);
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }

  // Pipeline check
  if (task.pipeline && !options?.allowPipelineOverride) {
    const currentStageIndex = task.pipeline.currentStageIndex ?? 0;
    const totalStages = task.pipeline.stages.length;
    if (currentStageIndex < totalStages - 1) {
      const currentStage = task.pipeline.stages[currentStageIndex];
      throw new Error(
        `${ERR_PIPELINE_PREMATURE_CLOSE}: Cannot close task '${taskId}' at non-terminal pipeline stage '${
          currentStage?.name || currentStage?.id || currentStageIndex
        }' (${
          currentStageIndex + 1
        }/${totalStages}). Task must progress through all pipeline stages or be overridden by a manager.`,
      );
    }
  }

  const now = new Date().toISOString();
  let updatedPipeline = task.pipeline;
  let updatedAcceptanceNotes = task.acceptanceNotes;

  if (task.pipeline) {
    const currentStageIndex = task.pipeline.currentStageIndex ?? (task.pipeline.stages.length - 1);
    const updatedStages = task.pipeline.stages.map((st, idx) => {
      if (idx === currentStageIndex) {
        return {
          ...st,
          status: "completed" as const,
          completedAt: now,
        };
      }
      return st;
    });

    updatedPipeline = {
      ...task.pipeline,
      stages: updatedStages,
    };

    if (reason && reason.trim()) {
      updatedAcceptanceNotes = [...(task.acceptanceNotes ?? []), reason.trim()];
    }
  }

  const closedTaskData: Task = {
    ...task,
    status: "closed",
    closedReason: reason,
    closedAt: now,
    pipeline: updatedPipeline,
    acceptanceNotes: updatedAcceptanceNotes,
  };
  // Move task to closed namespace with updated fields
  await moveTaskToClosed(uid, closedTaskData);
  const closedTask = closedTaskData;

  // Walk outbound dependencies to find affected tasks
  const outboundDeps = await getDependencies(taskId, "blocking", uid);
  const unblockedTasks: Task[] = [];

  if (outboundDeps.length > 0) {
    const blockingOutbound = outboundDeps.filter((d) =>
      d.type === "blocks" || d.type === "waits-for"
    );
    const targetTaskIds = Array.from(new Set(blockingOutbound.map((d) => d.toTaskId)));
    const targetTasks = await getTasks(targetTaskIds, uid);

    const evaluationResults = await Promise.all(
      targetTasks.map(async (dependentTask) => {
        if (dependentTask && dependentTask.status === "blocked") {
          // Check if all blockers for dependentTask are now resolved
          const inboundDeps = await getDependencies(dependentTask.id, "blocked-by", uid);
          const blockerIds = inboundDeps
            .filter((d) => d.type === "blocks" || d.type === "waits-for")
            .map((d) => d.fromTaskId);
          const blockers = await getTasks(blockerIds, uid);
          const allClosed = blockers.every((b) => b.status === "closed" || b.status === "wontfix");

          if (allClosed) {
            return await updateTask(dependentTask.id, { status: "open" }, uid);
          }
        }
        return null;
      }),
    );

    for (const unblocked of evaluationResults) {
      if (unblocked) {
        unblockedTasks.push(unblocked);
      }
    }
  }

  // Check if parent task (epic) should auto-close when all children are closed
  if (task.parentTaskId) {
    const childIds: string[] = [];
    const kv = await getKv();
    for await (
      const entry of kv.list<string>({
        prefix: ["users", uid, "parent_children", task.parentTaskId],
      })
    ) {
      if (entry.value) childIds.push(entry.value);
    }

    if (childIds.length > 0) {
      const children = await getTasks(childIds, uid);
      const allDone = children.length > 0 &&
        children.every((c) => c.status === "closed" || c.status === "wontfix");
      if (allDone) {
        const parent = await getTask(task.parentTaskId, uid);
        if (parent && parent.status !== "closed" && parent.status !== "wontfix") {
          const parentCloseResult = await closeTask(
            parent.id,
            `All child tasks completed (${children.length} tasks)`,
            uid,
          );
          for (const unblocked of parentCloseResult.unblockedTasks) {
            if (!unblockedTasks.some((t) => t.id === unblocked.id)) {
              unblockedTasks.push(unblocked);
            }
          }
        }
      }
    } else {
      const activeChildren = await listTasks({ parentTaskId: task.parentTaskId, userId: uid });
      if (activeChildren.length === 0) {
        const parent = await getTask(task.parentTaskId, uid);
        if (parent && parent.status !== "closed" && parent.status !== "wontfix") {
          const parentCloseResult = await closeTask(
            parent.id,
            "All child tasks completed",
            uid,
          );
          for (const unblocked of parentCloseResult.unblockedTasks) {
            if (!unblockedTasks.some((t) => t.id === unblocked.id)) {
              unblockedTasks.push(unblocked);
            }
          }
        }
      }
    }
  }

  return { task: closedTask, unblockedTasks };
}

// ---------------------------------------------------------------------------
// Task Comments (Max 256 chars)
// ---------------------------------------------------------------------------

/**
 * Adds a short comment to a task (max 256 characters).
 * Validates character limit and updates task with atomic concurrency protection.
 */
export async function addTaskComment(
  taskId: TaskId,
  commentInput: { author?: string; content: string },
  userId?: string,
): Promise<TaskComment> {
  const content = commentInput.content?.trim();
  if (!content) {
    throw new Error("Comment content cannot be empty");
  }
  if (content.length > 256) {
    throw new Error(
      `Comment exceeds maximum length of 256 characters (received ${content.length} characters)`,
    );
  }

  const uid = resolveUserId(userId);
  const kv = await getKv();

  const entry = await kv.get<Task>(["users", uid, "tasks", taskId]);
  if (!entry.value) {
    throw new Error(`Task not found: ${taskId}`);
  }

  const existing = entry.value;
  const now = new Date().toISOString();
  const comment: TaskComment = {
    id: `cm-${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`,
    taskId,
    userId: uid,
    author: commentInput.author?.trim() || "anonymous",
    content,
    createdAt: now,
  };

  const updatedComments = [...(existing.comments ?? []), comment];
  const updatedTask: Task = {
    ...existing,
    comments: updatedComments,
    updatedAt: now,
  };

  const res = await kv.atomic()
    .check(entry)
    .set(["users", uid, "tasks", taskId], updatedTask)
    .commit();

  if (!res.ok) {
    throw new Error(`Failed to add comment to task ${taskId}: concurrent modification detected`);
  }

  return comment;
}

/**
 * Retrieves all comments for a task in chronological order.
 */
export async function getTaskComments(
  taskId: TaskId,
  userId?: string,
): Promise<TaskComment[]> {
  const task = await getTask(taskId, userId);
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }
  return task.comments ?? [];
}

// ---------------------------------------------------------------------------
// Task Handoffs & Multi-Stage Pipeline Transitions
// ---------------------------------------------------------------------------

export interface HandoffTaskInput {
  taskId: TaskId;
  action?: StageAction;
  targetStageId?: string;
  fromAssignee?: string;
  toAssignee?: string;
  toRole?: string;
  reason: string;
  contextSummary?: string;
  acceptanceNotes?: string | string[];
  rejectionReasons?: string[];
  rejectedApproaches?: string[];
  managerOverrideJustification?: string;
}

export interface HandoffTaskResult {
  task: Task;
  handoffRecord: HandoffRecord;
  auditRecord?: PipelineTransitionAuditRecord;
}

/**
 * Transfers a task between agents or roles, handling both standard unpipelined handoffs
 * and multi-stage pipeline transitions (advances, rejection loopbacks, circuit breaker, audit logging).
 */
export async function handoffTask(
  input: HandoffTaskInput,
  userId?: string,
): Promise<HandoffTaskResult> {
  const targetTaskId = input.taskId?.trim();
  if (!targetTaskId) {
    throw new Error("Task ID cannot be empty");
  }
  const reason = input.reason?.trim();
  if (!reason) {
    throw new Error("Handoff reason cannot be empty");
  }

  const uid = resolveUserId(userId);
  const task = await getTask(targetTaskId, uid);
  if (!task) {
    throw new Error(`Task not found: ${targetTaskId}`);
  }

  const now = new Date().toISOString();

  // -------------------------------------------------------------------------
  // Case 1: Unpipelined Task (100% Backward Compatible)
  // -------------------------------------------------------------------------
  if (!task.pipeline) {
    let newContext = task.context;
    if (input.contextSummary && input.contextSummary.trim()) {
      newContext = task.context && task.context.trim()
        ? `${task.context.trim()}\n\n${input.contextSummary.trim()}`
        : input.contextSummary.trim();
    }

    let newRejectedApproaches = task.rejectedApproaches ? [...task.rejectedApproaches] : [];
    if (input.rejectedApproaches && input.rejectedApproaches.length > 0) {
      newRejectedApproaches = [...newRejectedApproaches, ...input.rejectedApproaches];
    }

    const handoffRecord = await recordHandoff({
      taskId: task.id,
      fromAssignee: input.fromAssignee || task.assignee || "unassigned",
      toAssignee: input.toAssignee ? input.toAssignee.trim() : undefined,
      toRole: input.toRole ? input.toRole.trim() : undefined,
      reason,
      contextSummary: input.contextSummary ?? "",
      rejectedApproaches: input.rejectedApproaches ?? [],
      timestamp: now,
    }, uid);

    const updates: Partial<Task> = {
      context: newContext,
      rejectedApproaches: newRejectedApproaches,
    };

    if (input.toAssignee && input.toAssignee.trim()) {
      updates.assignee = input.toAssignee.trim();
      updates.claimedAt = now;
      updates.status = "claimed";
    } else {
      updates.assignee = undefined;
      updates.claimedAt = undefined;
      if (task.status === "claimed" || task.status === "in_progress") {
        updates.status = "open";
      }
    }

    if (input.toRole && input.toRole.trim()) {
      updates.role = input.toRole.trim();
    }

    const updatedTask = await updateTask(task.id, updates, uid);
    return { task: updatedTask, handoffRecord };
  }

  // -------------------------------------------------------------------------
  // Case 2: Pipelined Task Multi-Stage Transition & Guards
  // -------------------------------------------------------------------------
  const action: StageAction = input.action || "advance";
  const currentStageIndex = task.pipeline.currentStageIndex ?? 0;
  const currentStage = task.pipeline.stages[currentStageIndex];
  if (!currentStage) {
    throw new Error(
      `Current pipeline stage index ${currentStageIndex} not found in task ${task.id}`,
    );
  }

  let nextStageIndex = currentStageIndex;
  let nextStageId = currentStage.id;
  let newRejectionCount = task.pipeline.rejectionCount ?? 0;
  let updatedStages = [...task.pipeline.stages];
  let targetRole = input.toRole ? input.toRole.trim() : "";

  // 1. Advance Action
  if (action === "advance") {
    if (currentStage.allowedTransitions && currentStage.allowedTransitions.length > 0) {
      const allowedAdvance = currentStage.allowedTransitions.filter((t) => t.action === "advance");
      if (allowedAdvance.length > 0 && input.targetStageId) {
        const match = allowedAdvance.find((t) => t.targetStageId === input.targetStageId);
        if (!match) {
          throw new Error(
            `${ERR_PIPELINE_INVALID_TRANSITION}: Cannot advance from stage '${currentStage.id}' to '${input.targetStageId}'. Allowed targets: ${
              allowedAdvance.map((t) => t.targetStageId).join(", ")
            }`,
          );
        }
      }
    }

    if (input.targetStageId) {
      const foundIdx = task.pipeline.stages.findIndex((s) => s.id === input.targetStageId);
      if (foundIdx === -1) {
        throw new Error(
          `${ERR_PIPELINE_INVALID_TRANSITION}: Target stage '${input.targetStageId}' not found in pipeline`,
        );
      }
      nextStageIndex = foundIdx;
    } else {
      nextStageIndex = currentStageIndex + 1;
    }

    if (nextStageIndex >= task.pipeline.stages.length) {
      throw new Error(
        `${ERR_PIPELINE_INVALID_TRANSITION}: Cannot advance beyond final pipeline stage '${
          currentStage.name || currentStage.id
        }'`,
      );
    }

    const nextStage = task.pipeline.stages[nextStageIndex];
    nextStageId = nextStage.id;
    if (!targetRole) {
      targetRole = nextStage.role;
    }

    updatedStages = task.pipeline.stages.map((st, idx) => {
      if (idx === currentStageIndex) {
        return {
          ...st,
          status: "completed" as const,
          completedAt: now,
        };
      } else if (idx === nextStageIndex) {
        return {
          ...st,
          status: "active" as const,
          startedAt: now,
          completedAt: undefined,
          assignee: input.toAssignee ? input.toAssignee.trim() : undefined,
        };
      }
      return st;
    });
  } // 2. Reject Action
  else if (action === "reject") {
    const hasRejectionReasons = (input.rejectionReasons && input.rejectionReasons.length > 0) ||
      (reason.length > 0);
    if (!hasRejectionReasons) {
      throw new Error(
        `${ERR_PIPELINE_MISSING_MANDATORY_NOTES}: Rejection requires rejection reasons or detailed reason`,
      );
    }

    if (
      currentStage.validationRules?.requireRejectedApproachesOnReject &&
      (!input.rejectedApproaches || input.rejectedApproaches.length === 0)
    ) {
      throw new Error(
        `${ERR_PIPELINE_MISSING_MANDATORY_NOTES}: Current stage '${currentStage.id}' requires rejected approaches to be documented upon rejection`,
      );
    }

    // Circuit Breaker
    const maxRejections = task.pipeline.maxRejectionCycles ?? 3;
    if (newRejectionCount >= maxRejections) {
      throw new Error(
        `${ERR_PIPELINE_REJECTION_LIMIT_EXCEEDED}: Task '${task.id}' exceeded maximum rejection limit (${newRejectionCount}/${maxRejections}). Manager intervention required.`,
      );
    }
    newRejectionCount += 1;

    const policy = task.pipeline.rejectionLoopPolicy || "rollback_to_stage";

    if (input.targetStageId) {
      const foundIdx = task.pipeline.stages.findIndex((s) => s.id === input.targetStageId);
      if (foundIdx === -1) {
        throw new Error(
          `${ERR_PIPELINE_INVALID_TRANSITION}: Rejection target stage '${input.targetStageId}' not found in pipeline`,
        );
      }
      nextStageIndex = foundIdx;
    } else if (policy === "restart_stage") {
      nextStageIndex = currentStageIndex;
    } else {
      // rollback_to_stage or reset_all_subsequent
      nextStageIndex = Math.max(0, currentStageIndex - 1);
    }

    const targetStage = task.pipeline.stages[nextStageIndex];
    nextStageId = targetStage.id;
    if (!targetRole) {
      targetRole = targetStage.role;
    }

    updatedStages = task.pipeline.stages.map((st, idx) => {
      if (idx === currentStageIndex) {
        return {
          ...st,
          status: (idx === nextStageIndex ? "active" : "rejected") as TaskPipelineStage["status"],
          startedAt: idx === nextStageIndex ? now : st.startedAt,
          completedAt: idx === nextStageIndex ? undefined : now,
          assignee: idx === nextStageIndex
            ? (input.toAssignee ? input.toAssignee.trim() : undefined)
            : st.assignee,
        };
      } else if (idx === nextStageIndex) {
        return {
          ...st,
          status: "active" as const,
          startedAt: now,
          completedAt: undefined,
          assignee: input.toAssignee ? input.toAssignee.trim() : undefined,
        };
      } else if (policy === "reset_all_subsequent" && idx > nextStageIndex) {
        return {
          ...st,
          status: "pending" as const,
          startedAt: undefined,
          completedAt: undefined,
          assignee: undefined,
        };
      }
      return st;
    });
  } // 3. Escalate / Delegate Action
  else {
    if (!targetRole) {
      targetRole = currentStage.role;
    }
    if (input.toAssignee) {
      updatedStages = task.pipeline.stages.map((st, idx) => {
        if (idx === currentStageIndex) {
          return {
            ...st,
            assignee: input.toAssignee ? input.toAssignee.trim() : undefined,
          };
        }
        return st;
      });
    }
  }

  // Acceptance notes
  const accNotesList: string[] = [];
  if (input.acceptanceNotes) {
    if (Array.isArray(input.acceptanceNotes)) {
      accNotesList.push(...input.acceptanceNotes.filter((n) => n && n.trim()));
    } else if (input.acceptanceNotes.trim()) {
      accNotesList.push(input.acceptanceNotes.trim());
    }
  }

  // Create Audit Record
  const auditRecord: PipelineTransitionAuditRecord = {
    id: `aud-${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`,
    timestamp: now,
    fromStageId: currentStage.id,
    toStageId: nextStageId,
    fromRole: currentStage.role,
    toRole: targetRole,
    triggeredBy: input.fromAssignee || task.assignee || "system",
    action,
    reason,
    structuredNotes: {
      contextSummary: input.contextSummary?.trim() || undefined,
      acceptanceCriteriaMet: accNotesList.length > 0 ? accNotesList : undefined,
      rejectionReasons: input.rejectionReasons && input.rejectionReasons.length > 0
        ? input.rejectionReasons
        : (action === "reject" ? [reason] : undefined),
      rejectedApproaches: input.rejectedApproaches && input.rejectedApproaches.length > 0
        ? input.rejectedApproaches
        : undefined,
      managerOverrideJustification: input.managerOverrideJustification?.trim() || undefined,
    },
  };

  const updatedPipeline: TaskPipeline = {
    ...task.pipeline,
    currentStageId: nextStageId,
    currentStageIndex: nextStageIndex,
    rejectionCount: newRejectionCount,
    stages: updatedStages,
    history: [...(task.pipeline.history ?? []), auditRecord],
  };

  let newContext = task.context;
  if (input.contextSummary && input.contextSummary.trim()) {
    const prefix = action === "reject" ? "[REJECTION NOTES]: " : "";
    newContext = task.context && task.context.trim()
      ? `${task.context.trim()}\n\n${prefix}${input.contextSummary.trim()}`
      : `${prefix}${input.contextSummary.trim()}`;
  }

  let newRejectedApproaches = task.rejectedApproaches ? [...task.rejectedApproaches] : [];
  if (input.rejectedApproaches && input.rejectedApproaches.length > 0) {
    newRejectedApproaches = [...newRejectedApproaches, ...input.rejectedApproaches];
  }

  const newAcceptanceNotes = accNotesList.length > 0
    ? [...(task.acceptanceNotes ?? []), ...accNotesList]
    : task.acceptanceNotes;

  const handoffRecord = await recordHandoff({
    taskId: task.id,
    fromAssignee: input.fromAssignee || task.assignee || "unassigned",
    toAssignee: input.toAssignee ? input.toAssignee.trim() : undefined,
    toRole: targetRole,
    reason: action === "reject" ? `[REJECTED]: ${reason}` : reason,
    contextSummary: input.contextSummary ?? "",
    rejectedApproaches: input.rejectedApproaches ?? [],
    timestamp: now,
  }, uid);

  const taskUpdates: Partial<Task> = {
    role: targetRole,
    pipeline: updatedPipeline,
    context: newContext,
    rejectedApproaches: newRejectedApproaches,
    acceptanceNotes: newAcceptanceNotes,
    assignee: input.toAssignee ? input.toAssignee.trim() : undefined,
    claimedAt: input.toAssignee ? now : undefined,
    status: input.toAssignee ? "claimed" : "open",
  };

  const updatedTask = await updateTask(task.id, taskUpdates, uid, {
    allowPipelineOverride: true,
  });
  return { task: updatedTask, handoffRecord, auditRecord };
}

/**
 * Attaches a FlowTemplate or custom pipeline configuration to an existing task (manager intervention).
 */
export async function attachPipelineToTask(
  taskId: TaskId,
  templateIdOrPipeline: string | TaskPipeline,
  userId?: string,
  justification?: string,
): Promise<Task> {
  const uid = resolveUserId(userId);
  const task = await getTask(taskId, uid);
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }

  let pipeline: TaskPipeline;
  if (typeof templateIdOrPipeline === "string") {
    const template = await getFlowTemplate(templateIdOrPipeline, uid);
    if (!template) {
      throw new Error(`Flow template not found: ${templateIdOrPipeline}`);
    }
    pipeline = instantiatePipelineFromTemplate(template);
  } else {
    pipeline = templateIdOrPipeline;
  }

  const now = new Date().toISOString();
  const activeStage = pipeline.stages[pipeline.currentStageIndex ?? 0];
  const targetRole = activeStage?.role || task.role || "";

  if (justification && justification.trim()) {
    const auditRecord: PipelineTransitionAuditRecord = {
      id: `aud-${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`,
      timestamp: now,
      fromStageId: "unpipelined",
      toStageId: activeStage?.id || "stage-0",
      fromRole: task.role || "unassigned",
      toRole: targetRole,
      triggeredBy: "manager",
      action: "emergency_override",
      reason: justification.trim(),
      structuredNotes: {
        managerOverrideJustification: justification.trim(),
      },
    };
    pipeline.history = [...(pipeline.history ?? []), auditRecord];
  }

  const updates: Partial<Task> = {
    pipeline,
    role: targetRole,
  };

  return await updateTask(task.id, updates, uid, { allowPipelineOverride: true });
}

/** Input parameters for emergency manager pipeline overrides. */
export interface PipelineOverrideOptions {
  action?:
    | "force_advance"
    | "skip_stage"
    | "insert_stage"
    | "reset_rejections"
    | "emergency_override";
  targetStageId?: string;
  targetStageIndex?: number;
  resetRejectionCount?: boolean;
  skipCurrentStage?: boolean;
  insertStage?: {
    id: string;
    name: string;
    role: string;
    description?: string;
    allowedTransitions?: StageTransitionRule[];
    requiredFields?: string[];
    validationRules?: {
      minCommentLength?: number;
      requireStructuredHandoff?: boolean;
      requireRejectedApproachesOnReject?: boolean;
      customGuards?: string[];
    };
    position?: "before_current" | "after_current" | "at_index";
    index?: number;
  };
  justification: string;
  managerId?: string;
}

/**
 * Allows managers to execute emergency pipeline overrides (stage jumps, skipping stages, un-tripping rejection circuit breaker).
 */
export async function overrideTaskPipeline(
  taskId: TaskId,
  override: PipelineOverrideOptions,
  userId?: string,
): Promise<Task> {
  const uid = resolveUserId(userId);
  const task = await getTask(taskId, uid);
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }
  if (!task.pipeline) {
    throw new Error(`Task ${taskId} is not managed by a pipeline`);
  }
  const justification = override.justification?.trim();
  if (!justification) {
    throw new Error("Manager override requires a justification");
  }

  const now = new Date().toISOString();
  const workingStages = [...task.pipeline.stages];
  let currentStageIndex = task.pipeline.currentStageIndex ?? 0;
  const currentStage = workingStages[currentStageIndex];

  // Handle stage insertion if provided
  if (override.insertStage) {
    const stageInput = override.insertStage;
    await ensureRole(stageInput.role, uid);
    const newStage: TaskPipelineStage = {
      id: stageInput.id,
      name: stageInput.name,
      role: stageInput.role,
      description: stageInput.description,
      allowedTransitions: stageInput.allowedTransitions ?? [],
      requiredFields: stageInput.requiredFields,
      validationRules: stageInput.validationRules,
      status: "pending",
    };

    const position = stageInput.position ?? "after_current";
    let insertIdx = currentStageIndex + 1;
    if (position === "before_current") {
      insertIdx = currentStageIndex;
    } else if (position === "at_index" && stageInput.index !== undefined) {
      insertIdx = Math.max(0, Math.min(workingStages.length, stageInput.index));
    }

    workingStages.splice(insertIdx, 0, newStage);
    if (position === "before_current") {
      currentStageIndex += 1;
    }
  }

  const action = override.action;
  let targetStageIndex = currentStageIndex;
  const shouldSkipCurrent = Boolean(override.skipCurrentStage || action === "skip_stage");
  const shouldResetRejections = Boolean(
    override.resetRejectionCount || action === "reset_rejections",
  );

  if (override.targetStageId) {
    const foundIdx = workingStages.findIndex((s) => s.id === override.targetStageId);
    if (foundIdx === -1) {
      throw new Error(`Override target stage '${override.targetStageId}' not found in pipeline`);
    }
    targetStageIndex = foundIdx;
  } else if (override.targetStageIndex !== undefined) {
    if (override.targetStageIndex < 0 || override.targetStageIndex >= workingStages.length) {
      throw new Error(`Override target stage index ${override.targetStageIndex} is out of bounds`);
    }
    targetStageIndex = override.targetStageIndex;
  } else if (action === "force_advance" || action === "skip_stage") {
    if (currentStageIndex + 1 < workingStages.length) {
      targetStageIndex = currentStageIndex + 1;
    }
  }

  const targetStage = workingStages[targetStageIndex];

  const updatedStages = workingStages.map((st, idx) => {
    if (idx === currentStageIndex && idx !== targetStageIndex) {
      return {
        ...st,
        status: (shouldSkipCurrent ? "skipped" : "completed") as TaskPipelineStage["status"],
        completedAt: now,
      };
    } else if (idx === targetStageIndex) {
      return {
        ...st,
        status: "active" as const,
        startedAt: now,
        completedAt: undefined,
      };
    }
    return st;
  });

  const auditAction = action === "force_advance"
    ? "force_advance"
    : action === "skip_stage" || shouldSkipCurrent
    ? "skip"
    : action === "insert_stage" || override.insertStage
    ? "insert_stage"
    : "emergency_override";

  const auditRecord: PipelineTransitionAuditRecord = {
    id: `aud-${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`,
    timestamp: now,
    fromStageId: currentStage?.id || "unknown",
    toStageId: targetStage.id,
    fromRole: currentStage?.role || "",
    toRole: targetStage.role,
    triggeredBy: override.managerId || "manager",
    action: auditAction as PipelineTransitionAuditRecord["action"],
    reason: justification,
    structuredNotes: {
      managerOverrideJustification: justification,
    },
  };

  const updatedPipeline: TaskPipeline = {
    ...task.pipeline,
    currentStageId: targetStage.id,
    currentStageIndex: targetStageIndex,
    rejectionCount: shouldResetRejections ? 0 : task.pipeline.rejectionCount,
    stages: updatedStages,
    history: [...(task.pipeline.history ?? []), auditRecord],
  };

  const updates: Partial<Task> = {
    role: targetStage.role,
    pipeline: updatedPipeline,
  };

  return await updateTask(task.id, updates, uid, { allowPipelineOverride: true });
}
