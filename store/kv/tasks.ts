/**
 * Deno KV persistence for tasks, task dependencies, atomic claiming, and ready frontier computation.
 */

import type {
  DependencyType,
  ExecutionId,
  NodeId,
  Task,
  TaskDependency,
  TaskId,
  TaskPriority,
  TaskStatus,
  TaskType,
  WorkflowId,
} from "../types.ts";
import { getKv, MAX_ATOMIC_OPS, resolveUserId } from "./client.ts";
import { ensureRole } from "./roles.ts";

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
  closedReason?: string;
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

  // If role is set, auto-ensure role
  if (taskInput.role && taskInput.role.trim().length > 0) {
    await ensureRole(taskInput.role.trim(), uid);
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
    description: taskInput.description ?? "",
    status: taskInput.status || (taskInput.assignee ? "claimed" : "open"),
    type: taskInput.type || "task",
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
 * Retrieves a task by its ID. Returns null if not found.
 */
export async function getTask(taskId: TaskId, userId?: string): Promise<Task | null> {
  const uid = resolveUserId(userId);
  const kv = await getKv();
  const entry = await kv.get<Task>(["users", uid, "tasks", taskId]);
  return entry.value;
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
        candidateTasks.push(entry.value);
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
  for (let i = 0; i < ids.length; i += 128) {
    const chunk = ids.slice(i, i + 128);
    const keys = chunk.map((id) => ["users", uid, "tasks", id]);
    const entries = await kv.getMany<Task[]>(keys);
    for (const entry of entries) {
      if (entry.value) {
        results.push(entry.value);
      }
    }
  }
  return results;
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

  const entry = await kv.get<Task>(["users", uid, "tasks", taskId]);
  if (!entry.value) {
    throw new Error(`Task not found: ${taskId}`);
  }
  const existing = entry.value;

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

  const atomic = kv.atomic().check(entry).set(["users", uid, "tasks", taskId], updated);

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

  // 1. Delete main task entry
  atomic.delete(["users", uid, "tasks", taskId]);
  opCount++;

  // 2. Delete secondary indexes
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
    opCount++;
  }
  if (task.assignee) {
    atomic.delete(["users", uid, "tasks_by_assignee", task.assignee, taskId]);
    opCount++;
  }
  if (task.role) {
    atomic.delete(["users", uid, "tasks_by_role", task.role, taskId]);
    opCount++;
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

  const readyTasks: Task[] = [];

  for (const task of candidateTasks) {
    const inboundDeps = await getDependencies(task.id, "blocked-by", uid);
    let isBlocked = false;

    for (const dep of inboundDeps) {
      if (dep.type === "blocks" || dep.type === "waits-for") {
        const blocker = await getTask(dep.fromTaskId, uid);
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
 * Returns the closed task and the list of newly unblocked tasks.
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
  const closedTask = await updateTask(
    taskId,
    {
      status: "closed",
      closedReason: reason,
      closedAt: now,
    },
    uid,
  );

  // Walk outbound dependencies to find affected tasks
  const outboundDeps = await getDependencies(taskId, "blocking", uid);
  const unblockedTasks: Task[] = [];

  for (const dep of outboundDeps) {
    if (dep.type === "blocks" || dep.type === "waits-for") {
      const dependentTask = await getTask(dep.toTaskId, uid);
      if (dependentTask && dependentTask.status === "blocked") {
        // Check if all blockers for dependentTask are now resolved
        const inboundDeps = await getDependencies(dependentTask.id, "blocked-by", uid);
        let allClosed = true;
        for (const inDep of inboundDeps) {
          if (inDep.type === "blocks" || inDep.type === "waits-for") {
            const blocker = await getTask(inDep.fromTaskId, uid);
            if (blocker && blocker.status !== "closed" && blocker.status !== "wontfix") {
              allClosed = false;
              break;
            }
          }
        }
        if (allClosed) {
          const unblocked = await updateTask(dependentTask.id, { status: "open" }, uid);
          unblockedTasks.push(unblocked);
        }
      }
    }
  }

  // Check if parent task (epic) should auto-close when all children are closed
  if (task.parentTaskId) {
    const siblings = await listTasks({ parentTaskId: task.parentTaskId }, { userId: uid });
    const allSiblingsClosed = siblings.length > 0 &&
      siblings.every((s) => s.status === "closed" || s.status === "wontfix");
    if (allSiblingsClosed) {
      const parent = await getTask(task.parentTaskId, uid);
      if (parent && parent.status !== "closed" && parent.status !== "wontfix") {
        const parentCloseResult = await closeTask(
          parent.id,
          `All child tasks completed (${siblings.length} tasks)`,
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

  return { task: closedTask, unblockedTasks };
}
