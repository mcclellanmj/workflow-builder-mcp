/**
 * Deno KV persistence for tasks, task dependencies, atomic claiming, and ready frontier computation.
 */

import type {
  DependencyType,
  ExecutionId,
  HandoffRecord,
  NodeId,
  Task,
  TaskComment,
  TaskDependency,
  TaskId,
  TaskPriority,
  TaskStatus,
  TaskType,
  WorkflowId,
} from "../types.ts";
import { getKv, MAX_ATOMIC_OPS, MAX_GET_MANY_KEYS, resolveUserId } from "./client.ts";
import { ensureRole } from "./roles.ts";
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

  // Origin linkage (where this task came from)
  originWorkflowId?: WorkflowId;
  originExecutionId?: ExecutionId;
  originNodeId?: NodeId;

  // Subworkflow assignment (subworkflow to be run to accomplish this task)
  assignedWorkflowId?: WorkflowId;
  activeExecutionId?: ExecutionId;

  // Direct / legacy aliases
  workflowId?: WorkflowId;
  executionId?: ExecutionId;
  nodeId?: NodeId;

  parentTaskId?: TaskId;
  context?: string;
  rejectedApproaches?: string[];
  rejectionCount?: number;
  inputs?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  acceptanceNotes?: string[];
  closedReason?: string;
  comments?: TaskComment[];
  createdAt?: string;
  updatedAt?: string;
  closedAt?: string;
}

/** Filter criteria for listing tasks. */
export interface TaskFilters {
  originWorkflowId?: WorkflowId;
  originExecutionId?: ExecutionId;
  originNodeId?: NodeId;
  assignedWorkflowId?: WorkflowId;
  activeExecutionId?: ExecutionId;
  workflowId?: WorkflowId;
  executionId?: ExecutionId;
  nodeId?: NodeId;
  status?: TaskStatus | TaskStatus[];
  type?: TaskType | TaskType[];
  assignee?: string;
  role?: string;
  parentTaskId?: TaskId;
  readyOnly?: boolean;
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
 * Creates multiple tasks in bulk with atomic batch commits and secondary index synchronization.
 */
export async function createTasks(
  taskInputs: CreateTaskInput[],
  userId?: string,
): Promise<Task[]> {
  if (taskInputs.length === 0) return [];
  const uid = resolveUserId(userId || taskInputs[0]?.userId);
  const kv = await getKv();

  const now = new Date().toISOString();
  const createdTasks: Task[] = [];
  let atomic = kv.atomic();
  let opCount = 0;

  for (const taskInput of taskInputs) {
    const title = taskInput.title?.trim();
    if (!title) {
      throw new Error("Task title cannot be empty");
    }

    const id = taskInput.id || generateTaskId(title);
    const originWf = taskInput.originWorkflowId || taskInput.workflowId;
    const originExec = taskInput.originExecutionId || taskInput.executionId;
    const originNd = taskInput.originNodeId || taskInput.nodeId;

    const task: Task = {
      id,
      userId: uid,
      title,
      description: taskInput.description ?? "",
      status: taskInput.status || (taskInput.assignee ? "claimed" : "open"),
      priority: taskInput.priority,
      type: taskInput.type || "task",
      role: taskInput.role?.trim() || undefined,
      assignee: taskInput.assignee?.trim() || undefined,
      claimedAt: taskInput.claimedAt || (taskInput.assignee ? now : undefined),

      originWorkflowId: originWf,
      originExecutionId: originExec,
      originNodeId: originNd,
      assignedWorkflowId: taskInput.assignedWorkflowId,
      activeExecutionId: taskInput.activeExecutionId,

      workflowId: originWf,
      executionId: originExec,
      nodeId: originNd,

      parentTaskId: taskInput.parentTaskId,
      context: taskInput.context,
      rejectedApproaches: taskInput.rejectedApproaches ?? [],
      rejectionCount: taskInput.rejectionCount ?? 0,
      inputs: taskInput.inputs,
      metadata: taskInput.metadata,
      acceptanceNotes: taskInput.acceptanceNotes ?? [],
      closedReason: taskInput.closedReason,
      comments: taskInput.comments ?? [],
      createdAt: taskInput.createdAt || now,
      updatedAt: taskInput.updatedAt || now,
      closedAt: taskInput.closedAt,
    };

    if (task.role) {
      await ensureRole(task.originWorkflowId || task.workflowId || "default", task.role, uid);
    }

    atomic.set(["users", uid, "tasks", id], task);
    opCount++;

    if (task.type) {
      atomic.set(["users", uid, "tasks_by_type", task.type, id], id);
      opCount++;
    }
    if (task.originWorkflowId) {
      atomic.set(["users", uid, "tasks_by_workflow", task.originWorkflowId, id], id);
      opCount++;
    }
    if (task.originExecutionId) {
      atomic.set(["users", uid, "tasks_by_execution", task.originExecutionId, id], id);
      opCount++;
    }
    if (task.originNodeId) {
      atomic.set(["users", uid, "tasks_by_node", task.originNodeId, id], id);
      opCount++;
    }
    if (task.assignedWorkflowId) {
      atomic.set(["users", uid, "tasks_by_assigned_workflow", task.assignedWorkflowId, id], id);
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
 * Creates a single task and updates secondary indexes.
 */
export async function createTask(
  taskInput: CreateTaskInput,
  userId?: string,
): Promise<Task> {
  const [created] = await createTasks([taskInput], userId);
  return created;
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
 * Retrieves multiple tasks by their IDs.
 */
export async function getTasks(taskIds: TaskId[], userId?: string): Promise<Task[]> {
  if (taskIds.length === 0) return [];
  const uid = resolveUserId(userId);
  const kv = await getKv();

  const foundMap = new Map<TaskId, Task>();

  // Chunk getMany for active tasks
  for (let i = 0; i < taskIds.length; i += MAX_GET_MANY_KEYS) {
    const chunk = taskIds.slice(i, i + MAX_GET_MANY_KEYS);
    const keys = chunk.map((id) => ["users", uid, "tasks", id]);
    const entries = await kv.getMany<Task[]>(keys);
    for (const entry of entries) {
      if (entry.value) {
        foundMap.set(entry.value.id, {
          ...entry.value,
          comments: entry.value.comments ?? [],
        });
      }
    }
  }

  // Check closed tasks for missing IDs
  const missing = taskIds.filter((id) => !foundMap.has(id));
  if (missing.length > 0) {
    for (let i = 0; i < missing.length; i += MAX_GET_MANY_KEYS) {
      const chunk = missing.slice(i, i + MAX_GET_MANY_KEYS);
      const keys = chunk.map((id) => ["users", uid, "closedTasks", id]);
      const entries = await kv.getMany<Task[]>(keys);
      for (const entry of entries) {
        if (entry.value) {
          foundMap.set(entry.value.id, {
            ...entry.value,
            comments: entry.value.comments ?? [],
          });
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

/**
 * Lists tasks matching the specified filters.
 * If readyOnly is true, delegates to computeReadyFrontier.
 */
export async function listTasks(
  filters?: TaskFilters,
  options?: { userId?: string },
): Promise<Task[]> {
  const uid = resolveUserId(filters?.userId || options?.userId);

  if (filters?.readyOnly) {
    return await computeReadyFrontier({
      workflowId: filters.workflowId || filters.originWorkflowId,
      executionId: filters.executionId || filters.originExecutionId,
      role: filters.role,
      type: filters.type,
      limit: filters.limit,
      userId: uid,
    });
  }

  const kv = await getKv();
  let candidateTasks: Task[] = [];

  const targetWorkflow = filters?.originWorkflowId || filters?.workflowId;
  const targetExecution = filters?.originExecutionId || filters?.executionId;
  const targetNode = filters?.originNodeId || filters?.nodeId;

  if (targetWorkflow) {
    const ids: string[] = [];
    for await (
      const entry of kv.list<string>({
        prefix: ["users", uid, "tasks_by_workflow", targetWorkflow],
      })
    ) {
      if (entry.value) ids.push(entry.value);
    }
    candidateTasks = await fetchTasksByIds(kv, uid, ids);
  } else if (targetExecution) {
    const ids: string[] = [];
    for await (
      const entry of kv.list<string>({
        prefix: ["users", uid, "tasks_by_execution", targetExecution],
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

  let filtered = candidateTasks.filter((t) => {
    if (targetWorkflow && t.originWorkflowId !== targetWorkflow && t.workflowId !== targetWorkflow) {
      return false;
    }
    if (targetExecution && t.originExecutionId !== targetExecution && t.executionId !== targetExecution) {
      return false;
    }
    if (targetNode && t.originNodeId !== targetNode && t.nodeId !== targetNode) {
      return false;
    }
    if (filters?.assignedWorkflowId && t.assignedWorkflowId !== filters.assignedWorkflowId) {
      return false;
    }
    if (filters?.activeExecutionId && t.activeExecutionId !== filters.activeExecutionId) {
      return false;
    }
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

export async function moveTaskToClosed(uid: string, task: Task): Promise<void> {
  const kv = await getKv();
  let atomic = kv.atomic()
    .set(["users", uid, "closedTasks", task.id], task)
    .delete(["users", uid, "tasks", task.id]);

  if (task.type) atomic = atomic.delete(["users", uid, "tasks_by_type", task.type, task.id]);
  const wf = task.originWorkflowId || task.workflowId;
  if (wf) atomic = atomic.delete(["users", uid, "tasks_by_workflow", wf, task.id]);
  const exec = task.originExecutionId || task.executionId;
  if (exec) atomic = atomic.delete(["users", uid, "tasks_by_execution", exec, task.id]);
  const nd = task.originNodeId || task.nodeId;
  if (nd) atomic = atomic.delete(["users", uid, "tasks_by_node", nd, task.id]);
  if (task.assignedWorkflowId) {
    atomic = atomic.delete(["users", uid, "tasks_by_assigned_workflow", task.assignedWorkflowId, task.id]);
  }
  if (task.parentTaskId) {
    atomic = atomic.delete(["users", uid, "tasks_by_parent", task.parentTaskId, task.id]);
  }
  if (task.assignee) {
    atomic = atomic.delete(["users", uid, "tasks_by_assignee", task.assignee, task.id]);
  }
  if (task.role) {
    atomic = atomic.delete(["users", uid, "tasks_by_role", task.role, task.id]);
  }
  await atomic.commit();
}

export async function moveTaskToActive(uid: string, task: Task): Promise<void> {
  const kv = await getKv();
  let atomic = kv.atomic()
    .set(["users", uid, "tasks", task.id], task)
    .delete(["users", uid, "closedTasks", task.id]);

  if (task.type) atomic = atomic.set(["users", uid, "tasks_by_type", task.type, task.id], task.id);
  const wf = task.originWorkflowId || task.workflowId;
  if (wf) atomic = atomic.set(["users", uid, "tasks_by_workflow", wf, task.id], task.id);
  const exec = task.originExecutionId || task.executionId;
  if (exec) atomic = atomic.set(["users", uid, "tasks_by_execution", exec, task.id], task.id);
  const nd = task.originNodeId || task.nodeId;
  if (nd) atomic = atomic.set(["users", uid, "tasks_by_node", nd, task.id], task.id);
  if (task.assignedWorkflowId) {
    atomic = atomic.set(["users", uid, "tasks_by_assigned_workflow", task.assignedWorkflowId, task.id], task.id);
  }
  if (task.parentTaskId) {
    atomic = atomic.set(["users", uid, "tasks_by_parent", task.parentTaskId, task.id], task.id);
  }
  if (task.assignee) {
    atomic = atomic.set(["users", uid, "tasks_by_assignee", task.assignee, task.id], task.id);
  }
  if (task.role) {
    atomic = atomic.set(["users", uid, "tasks_by_role", task.role, task.id], task.id);
  }
  await atomic.commit();
}

export async function listClosedTasks(
  filters?: TaskFilters,
  options?: { userId?: string },
): Promise<Task[]> {
  const uid = resolveUserId(filters?.userId || options?.userId);
  const kv = await getKv();
  const closed: Task[] = [];

  for await (const entry of kv.list<Task>({ prefix: ["users", uid, "closedTasks"] })) {
    if (entry.value && typeof entry.value === "object") {
      closed.push({
        ...entry.value,
        comments: entry.value.comments ?? [],
      });
    }
  }

  let filtered = closed;
  const targetWorkflow = filters?.originWorkflowId || filters?.workflowId;
  if (targetWorkflow) {
    filtered = filtered.filter((t) => t.originWorkflowId === targetWorkflow || t.workflowId === targetWorkflow);
  }
  const targetExecution = filters?.originExecutionId || filters?.executionId;
  if (targetExecution) {
    filtered = filtered.filter((t) => t.originExecutionId === targetExecution || t.executionId === targetExecution);
  }
  const targetNode = filters?.originNodeId || filters?.nodeId;
  if (targetNode) {
    filtered = filtered.filter((t) => t.originNodeId === targetNode || t.nodeId === targetNode);
  }
  if (filters?.assignee) {
    filtered = filtered.filter((t) => t.assignee === filters.assignee);
  }
  if (filters?.role) {
    filtered = filtered.filter((t) => t.role === filters.role);
  }
  if (filters?.limit && filters.limit > 0) {
    filtered = filtered.slice(0, filters.limit);
  }
  return filtered;
}

/**
 * Saves a task record directly.
 */
export async function saveTask(task: Task, userId?: string): Promise<void> {
  const uid = resolveUserId(userId || task.userId);
  task.userId = uid;
  const kv = await getKv();
  const isClosed = task.status === "closed" || task.status === "wontfix";
  const namespace = isClosed ? "closedTasks" : "tasks";
  const otherNamespace = isClosed ? "tasks" : "closedTasks";
  const atomic = kv.atomic()
    .set(["users", uid, namespace, task.id], task)
    .delete(["users", uid, otherNamespace, task.id]);

  const wf = task.originWorkflowId || task.workflowId;
  if (wf) atomic.set(["users", uid, "tasks_by_workflow", wf, task.id], task.id);
  const exec = task.originExecutionId || task.executionId;
  if (exec) atomic.set(["users", uid, "tasks_by_execution", exec, task.id], task.id);
  const nd = task.originNodeId || task.nodeId;
  if (nd) atomic.set(["users", uid, "tasks_by_node", nd, task.id], task.id);
  if (task.assignedWorkflowId) {
    atomic.set(["users", uid, "tasks_by_assigned_workflow", task.assignedWorkflowId, task.id], task.id);
  }
  if (task.assignee) {
    atomic.set(["users", uid, "tasks_by_assignee", task.assignee, task.id], task.id);
  }
  if (task.role) {
    atomic.set(["users", uid, "tasks_by_role", task.role, task.id], task.id);
  }
  await atomic.commit();
}

/**
 * Updates an existing task and synchronizes secondary indexes.
 */
export async function updateTask(
  taskId: TaskId,
  updates: Partial<Task>,
  userId?: string,
): Promise<Task> {
  const uid = resolveUserId(userId);
  const kv = await getKv();

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

  const now = new Date().toISOString();
  const updated: Task = {
    ...existing,
    ...updates,
    id: taskId,
    userId: uid,
    updatedAt: now,
  };

  // If status changed between open/claimed/blocked and closed/wontfix
  const wasClosed = existing.status === "closed" || existing.status === "wontfix";
  const nowClosed = updated.status === "closed" || updated.status === "wontfix";

  if (!wasClosed && nowClosed) {
    await moveTaskToClosed(uid, updated);
    return updated;
  } else if (wasClosed && !nowClosed) {
    await moveTaskToActive(uid, updated);
    return updated;
  }

  const atomic = kv.atomic().check(entry).set(["users", uid, namespace, taskId], updated);

  const oldWf = existing.originWorkflowId || existing.workflowId;
  const newWf = updated.originWorkflowId || updated.workflowId;
  if (oldWf !== newWf) {
    if (oldWf) atomic.delete(["users", uid, "tasks_by_workflow", oldWf, taskId]);
    if (newWf) atomic.set(["users", uid, "tasks_by_workflow", newWf, taskId], taskId);
  }

  const oldExec = existing.originExecutionId || existing.executionId;
  const newExec = updated.originExecutionId || updated.executionId;
  if (oldExec !== newExec) {
    if (oldExec) atomic.delete(["users", uid, "tasks_by_execution", oldExec, taskId]);
    if (newExec) atomic.set(["users", uid, "tasks_by_execution", newExec, taskId], taskId);
  }

  const oldNode = existing.originNodeId || existing.nodeId;
  const newNode = updated.originNodeId || updated.nodeId;
  if (oldNode !== newNode) {
    if (oldNode) atomic.delete(["users", uid, "tasks_by_node", oldNode, taskId]);
    if (newNode) atomic.set(["users", uid, "tasks_by_node", newNode, taskId], taskId);
  }

  if (existing.assignedWorkflowId !== updated.assignedWorkflowId) {
    if (existing.assignedWorkflowId) {
      atomic.delete(["users", uid, "tasks_by_assigned_workflow", existing.assignedWorkflowId, taskId]);
    }
    if (updated.assignedWorkflowId) {
      atomic.set(["users", uid, "tasks_by_assigned_workflow", updated.assignedWorkflowId, taskId], taskId);
    }
  }

  if (existing.parentTaskId !== updated.parentTaskId) {
    if (existing.parentTaskId) atomic.delete(["users", uid, "tasks_by_parent", existing.parentTaskId, taskId]);
    if (updated.parentTaskId) atomic.set(["users", uid, "tasks_by_parent", updated.parentTaskId, taskId], taskId);
  }

  if (existing.assignee !== updated.assignee) {
    if (existing.assignee) atomic.delete(["users", uid, "tasks_by_assignee", existing.assignee, taskId]);
    if (updated.assignee) atomic.set(["users", uid, "tasks_by_assignee", updated.assignee, taskId], taskId);
  }

  if (existing.role !== updated.role) {
    if (existing.role) atomic.delete(["users", uid, "tasks_by_role", existing.role, taskId]);
    if (updated.role) atomic.set(["users", uid, "tasks_by_role", updated.role, taskId], taskId);
  }

  if (existing.type !== updated.type) {
    if (existing.type) atomic.delete(["users", uid, "tasks_by_type", existing.type, taskId]);
    if (updated.type) atomic.set(["users", uid, "tasks_by_type", updated.type, taskId], taskId);
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

  atomic.delete(["users", uid, "tasks", taskId]);
  atomic.delete(["users", uid, "closedTasks", taskId]);
  opCount += 2;

  if (task.type) {
    atomic.delete(["users", uid, "tasks_by_type", task.type, taskId]);
    opCount++;
  }
  const wf = task.originWorkflowId || task.workflowId;
  if (wf) {
    atomic.delete(["users", uid, "tasks_by_workflow", wf, taskId]);
    opCount++;
  }
  const exec = task.originExecutionId || task.executionId;
  if (exec) {
    atomic.delete(["users", uid, "tasks_by_execution", exec, taskId]);
    opCount++;
  }
  const nd = task.originNodeId || task.nodeId;
  if (nd) {
    atomic.delete(["users", uid, "tasks_by_node", nd, taskId]);
    opCount++;
  }
  if (task.assignedWorkflowId) {
    atomic.delete(["users", uid, "tasks_by_assigned_workflow", task.assignedWorkflowId, taskId]);
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

  // Delete dependencies
  const outDeps = await getDependencies(taskId, "all", uid);
  for (const dep of outDeps) {
    atomic.delete(["users", uid, "task_deps", dep.fromTaskId, dep.toTaskId]);
    atomic.delete(["users", uid, "task_deps_rev", dep.toTaskId, dep.fromTaskId]);
    opCount += 2;
    if (opCount >= MAX_ATOMIC_OPS) {
      await commitBatch();
    }
  }

  await commitBatch();
}

/**
 * Adds a directed dependency between two tasks with cycle detection.
 */
export async function addDependency(
  fromTaskId: TaskId,
  toTaskId: TaskId,
  type: DependencyType = "blocks",
  userId?: string,
): Promise<TaskDependency> {
  const [created] = await addDependencies([{ fromTaskId, toTaskId, type }], userId);
  return created;
}

/**
 * Adds multiple directed dependencies in batch with global cycle detection.
 */
export async function addDependencies(
  dependencies: Array<{ fromTaskId: TaskId; toTaskId: TaskId; type?: DependencyType }>,
  userId?: string,
): Promise<TaskDependency[]> {
  if (dependencies.length === 0) return [];
  const uid = resolveUserId(userId);
  const kv = await getKv();

  for (const dep of dependencies) {
    if (dep.fromTaskId === dep.toTaskId) {
      throw new Error("A task cannot depend on itself");
    }
  }

  // Detect cycles
  const adj = new Map<TaskId, Set<TaskId>>();
  for await (
    const entry of kv.list<TaskDependency>({ prefix: ["users", uid, "task_deps"] })
  ) {
    if (entry.value) {
      let neighbors = adj.get(entry.value.fromTaskId);
      if (!neighbors) {
        neighbors = new Set();
        adj.set(entry.value.fromTaskId, neighbors);
      }
      neighbors.add(entry.value.toTaskId);
    }
  }

  for (const dep of dependencies) {
    let neighbors = adj.get(dep.fromTaskId);
    if (!neighbors) {
      neighbors = new Set();
      adj.set(dep.fromTaskId, neighbors);
    }
    neighbors.add(dep.toTaskId);
  }

  // DFS cycle detection
  const visited = new Set<TaskId>();
  const recStack = new Set<TaskId>();

  const hasCycle = (curr: TaskId): boolean => {
    visited.add(curr);
    recStack.add(curr);
    const neighbors = adj.get(curr);
    if (neighbors) {
      for (const next of neighbors) {
        if (!visited.has(next)) {
          if (hasCycle(next)) return true;
        } else if (recStack.has(next)) {
          return true;
        }
      }
    }
    recStack.delete(curr);
    return false;
  };

  for (const dep of dependencies) {
    visited.clear();
    recStack.clear();
    if (hasCycle(dep.fromTaskId)) {
      throw new Error(
        `Circular dependency detected: adding edge from ${dep.fromTaskId} to ${dep.toTaskId} forms a cycle`,
      );
    }
  }

  const now = new Date().toISOString();
  const created: TaskDependency[] = [];
  let atomic = kv.atomic();
  let opCount = 0;

  for (const dep of dependencies) {
    const record: TaskDependency = {
      id: `dep-${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`,
      fromTaskId: dep.fromTaskId,
      toTaskId: dep.toTaskId,
      type: dep.type || "blocks",
      createdAt: now,
    };

    atomic.set(["users", uid, "task_deps", dep.fromTaskId, dep.toTaskId], record);
    atomic.set(["users", uid, "task_deps_rev", dep.toTaskId, dep.fromTaskId], record);
    opCount += 2;
    created.push(record);

    if (opCount >= MAX_ATOMIC_OPS) {
      await atomic.commit();
      atomic = kv.atomic();
      opCount = 0;
    }
  }

  if (opCount > 0) {
    await atomic.commit();
  }

  for (const dep of dependencies) {
    const depType = dep.type || "blocks";
    if (depType === "blocks" || depType === "waits-for") {
      const fromTask = await getTask(dep.fromTaskId, uid);
      if (fromTask && fromTask.status !== "closed" && fromTask.status !== "wontfix") {
        const toTask = await getTask(dep.toTaskId, uid);
        if (toTask && toTask.status === "open") {
          await updateTask(toTask.id, { status: "blocked" }, uid);
        }
      }
    }
  }

  return created;
}

export async function removeDependency(
  fromTaskId: TaskId,
  toTaskId: TaskId,
  userId?: string,
): Promise<void> {
  const uid = resolveUserId(userId);
  const kv = await getKv();
  await kv.atomic()
    .delete(["users", uid, "task_deps", fromTaskId, toTaskId])
    .delete(["users", uid, "task_deps_rev", toTaskId, fromTaskId])
    .commit();

  // Check if toTaskId is blocked and has any remaining blockers
  const remainingDeps = await getDependencies(toTaskId, "blocked-by", uid);
  const blockerIds = remainingDeps
    .filter((d) => d.type === "blocks" || d.type === "waits-for")
    .map((d) => d.fromTaskId);
  const blockers = await getTasks(blockerIds, uid);
  const allClosed = blockers.every((b) => b.status === "closed" || b.status === "wontfix");
  if (allClosed) {
    const toTask = await getTask(toTaskId, uid);
    if (toTask && toTask.status === "blocked") {
      await updateTask(toTaskId, { status: "open" }, uid);
    }
  }
}

export async function getDependencies(
  taskId: TaskId,
  direction: "blocking" | "blocked-by" | "all" = "all",
  userId?: string,
): Promise<TaskDependency[]> {
  const uid = resolveUserId(userId);
  const kv = await getKv();
  const results: TaskDependency[] = [];

  if (direction === "blocking" || direction === "all") {
    for await (
      const entry of kv.list<TaskDependency>({
        prefix: ["users", uid, "task_deps", taskId],
      })
    ) {
      if (entry.value) results.push(entry.value);
    }
  }

  if (direction === "blocked-by" || direction === "all") {
    for await (
      const entry of kv.list<TaskDependency>({
        prefix: ["users", uid, "task_deps_rev", taskId],
      })
    ) {
      if (entry.value) results.push(entry.value);
    }
  }

  return results;
}

/**
 * Computes the ready frontier: open tasks with all dependencies satisfied.
 */
export async function computeReadyFrontier(
  filters?: FrontierFilters,
): Promise<Task[]> {
  const uid = resolveUserId(filters?.userId);
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

  const blockerIdsSet = new Set<TaskId>();
  for (const task of candidateTasks) {
    const inboundDeps = inboundDepsByTarget.get(task.id) ?? [];
    for (const dep of inboundDeps) {
      if (dep.type === "blocks" || dep.type === "waits-for") {
        blockerIdsSet.add(dep.fromTaskId);
      }
    }
  }

  const blockerTasks = blockerIdsSet.size > 0
    ? await fetchTasksByIds(kv, uid, Array.from(blockerIdsSet))
    : [];
  const blockerMap = new Map<TaskId, Task>();
  for (const task of blockerTasks) {
    blockerMap.set(task.id, task);
  }

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
      if (task.status === "blocked") {
        const updated = await updateTask(task.id, { status: "open" }, uid);
        readyTasks.push(updated);
      } else {
        readyTasks.push(task);
      }
    } else if (task.status === "open") {
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
 */
export async function claimTask(
  taskId: TaskId,
  assignee: string,
  userId?: string,
  _claimantRole?: string,
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

  // Check blockers if blocked
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

  const now = new Date().toISOString();
  const updated: Task = {
    ...current,
    status: "claimed",
    assignee: trimmedAssignee,
    claimedAt: now,
    updatedAt: now,
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
 */
export async function closeTask(
  taskId: TaskId,
  reason?: string,
  userId?: string,
): Promise<{ task: Task; unblockedTasks: Task[] }> {
  const uid = resolveUserId(userId);
  const task = await getTask(taskId, uid);
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }

  const now = new Date().toISOString();
  const updatedAcceptanceNotes = reason && reason.trim()
    ? [...(task.acceptanceNotes ?? []), reason.trim()]
    : task.acceptanceNotes;

  const closedTaskData: Task = {
    ...task,
    status: "closed",
    closedReason: reason,
    closedAt: now,
    acceptanceNotes: updatedAcceptanceNotes,
  };

  await moveTaskToClosed(uid, closedTaskData);
  const closedTask = closedTaskData;

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

  // Check parent task (epic) auto-close
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
    }
  }

  return { task: closedTask, unblockedTasks };
}

/**
 * Adds a short comment to a task (max 256 characters).
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

export interface HandoffTaskInput {
  taskId: TaskId;
  action?: "advance" | "reject" | "escalate";
  fromAssignee?: string;
  toAssignee?: string;
  toRole?: string;
  fromRole?: string;
  reason: string;
  contextSummary?: string;
  feedback?: string[];
  rejectedApproaches?: string[];
  acceptanceNotes?: string | string[];
}

export interface HandoffTaskResult {
  task: Task;
  handoffRecord: HandoffRecord;
}

/**
 * Transfers a task between agents/roles using role-to-role handoff protocol.
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

  const action = input.action || "advance";
  const handoffRecord = await recordHandoff({
    taskId: targetTaskId,
    fromAssignee: input.fromAssignee || task.assignee || "unassigned",
    toAssignee: input.toAssignee ? input.toAssignee.trim() : undefined,
    fromRole: input.fromRole ? input.fromRole.trim() : task.role,
    toRole: input.toRole ? input.toRole.trim() : undefined,
    action,
    reason,
    contextSummary: input.contextSummary ?? "",
    feedback: input.feedback ?? [],
    rejectedApproaches: input.rejectedApproaches ?? [],
  }, uid);

  const updatedTask = await getTask(targetTaskId, uid);
  return {
    task: updatedTask || task,
    handoffRecord,
  };
}
