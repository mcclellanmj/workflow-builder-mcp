/**
 * Deno KV persistence for workflow execution run instances, indexing,
 * atomic context patching, and barrier / subworkflow completion synchronization.
 */

import type {
  ExecutionId,
  ExecutionStatus,
  NodeExecutionState,
  NodeId,
  NodeStatus,
  TaskComment,
  TaskId,
  WorkflowExecution,
  WorkflowId,
} from "../types.ts";
import { getKv, MAX_GET_MANY_KEYS, resolveUserId } from "./client.ts";
import { getNode, listNodes } from "./nodes.ts";
import { listEdges } from "./edges.ts";
import { getTask, listClosedTasks, listTasks, saveTask } from "./tasks.ts";
import { postMessage } from "./messages.ts";

export interface CreateExecutionInput {
  id?: ExecutionId;
  workflowId: WorkflowId;
  userId?: string;
  initialContext?: Record<string, unknown>;
  parentExecutionId?: ExecutionId;
  originTaskId?: TaskId;
  originNodeId?: NodeId;
  nodeStates?: Record<NodeId, NodeExecutionState>;
  status?: ExecutionStatus;
}

export interface TransitionNodeStateInput {
  executionId: ExecutionId;
  nodeId: NodeId;
  status: NodeStatus;
  error?: string | null;
  feedback?: string;
  contextDiff?: Record<string, unknown>;
  handledBy?: string;
  userId?: string;
}

/**
 * Saves a workflow execution (both the main record and secondary index entries).
 */
export async function saveExecution(
  execution: WorkflowExecution,
  userId?: string,
): Promise<void> {
  const uid = resolveUserId(userId || execution.userId);
  execution.userId = uid;
  const kv = await getKv();
  const atomic = kv.atomic()
    .set(["users", uid, "executions", execution.id], execution)
    .set(["users", uid, "executions_by_workflow", execution.workflowId, execution.id], execution.id);

  if (execution.parentExecutionId) {
    atomic.set(["executions_by_parent", execution.parentExecutionId, execution.id], execution.id);
  }
  if (execution.originTaskId) {
    atomic.set(["executions_by_task", execution.originTaskId, execution.id], execution.id);
  }

  await atomic.commit();
}

/**
 * Creates and initializes a new workflow execution run.
 * Initializes shared runtime context, initial node states, and records hierarchy linkages.
 */
export async function createExecution(
  input: CreateExecutionInput,
  userId?: string,
): Promise<WorkflowExecution> {
  const workflowId = input.workflowId?.trim();
  if (!workflowId) {
    throw new Error("Workflow ID cannot be empty");
  }

  const uid = resolveUserId(userId || input.userId);
  const id = input.id || `exec-${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
  const now = new Date().toISOString();

  let nodeStates = input.nodeStates;
  if (!nodeStates) {
    nodeStates = {};
    const nodes = await listNodes(workflowId, { userId: uid });
    for (const node of nodes) {
      nodeStates[node.id] = {
        nodeId: node.id,
        status: node.type === "start" ? "running" : "pending",
        error: null,
        iteration: node.type === "start" ? 1 : 0,
        iterationHistory: [],
        updatedAt: now,
      };
    }
  }

  const execution: WorkflowExecution = {
    id,
    workflowId,
    userId: uid,
    status: input.status || "in_progress",
    nodeStates,
    context: input.initialContext ? structuredClone(input.initialContext) : {},
    parentExecutionId: input.parentExecutionId?.trim() || undefined,
    originTaskId: input.originTaskId?.trim() || undefined,
    originNodeId: input.originNodeId?.trim() || undefined,
    createdAt: now,
    updatedAt: now,
  };

  await saveExecution(execution, uid);
  return execution;
}

/**
 * Retrieves a workflow execution by its ID. Returns null if not found.
 */
export async function getExecution(
  id: ExecutionId,
  userId?: string,
): Promise<WorkflowExecution | null> {
  const uid = resolveUserId(userId);
  const kv = await getKv();
  const entry = await kv.get<WorkflowExecution>(["users", uid, "executions", id]);
  return entry.value;
}

/**
 * Lists all workflow executions, optionally filtered to a specific workflow.
 */
export async function listExecutions(
  workflowId?: WorkflowId,
  options?: { userId?: string },
): Promise<WorkflowExecution[]> {
  const uid = resolveUserId(options?.userId);
  const kv = await getKv();
  const results: WorkflowExecution[] = [];

  if (workflowId) {
    const ids: string[] = [];
    for await (
      const entry of kv.list<string>({
        prefix: ["users", uid, "executions_by_workflow", workflowId],
      })
    ) {
      if (entry.value) {
        ids.push(entry.value);
      }
    }
    for (let i = 0; i < ids.length; i += MAX_GET_MANY_KEYS) {
      const chunk = ids.slice(i, i + MAX_GET_MANY_KEYS);
      const keys = chunk.map((id) => ["users", uid, "executions", id]);
      const entries = await kv.getMany<WorkflowExecution[]>(keys);
      for (const entry of entries) {
        if (entry.value) {
          results.push(entry.value);
        }
      }
    }
  } else {
    for await (
      const entry of kv.list<WorkflowExecution>({ prefix: ["users", uid, "executions"] })
    ) {
      if (entry.value && typeof entry.value === "object") {
        results.push(entry.value);
      }
    }
  }

  return results;
}

/**
 * Deletes a workflow execution by its ID and cleans up secondary indexes.
 */
export async function deleteExecution(
  execution: WorkflowExecution,
  userId?: string,
): Promise<void> {
  const uid = resolveUserId(userId || execution.userId);
  const kv = await getKv();
  const atomic = kv.atomic()
    .delete(["users", uid, "executions", execution.id])
    .delete(["users", uid, "executions_by_workflow", execution.workflowId, execution.id]);

  if (execution.parentExecutionId) {
    atomic.delete(["executions_by_parent", execution.parentExecutionId, execution.id]);
  }
  if (execution.originTaskId) {
    atomic.delete(["executions_by_task", execution.originTaskId, execution.id]);
  }

  await atomic.commit();
}

/**
 * Applies atomic update operators ($push, $set, deep-merge) to a context object.
 */
export function applyContextPatch(
  target: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const result = structuredClone(target);

  // 1. $set operator: { dotPath: value }
  if (patch.$set && typeof patch.$set === "object" && !Array.isArray(patch.$set)) {
    for (const [dotPath, val] of Object.entries(patch.$set as Record<string, unknown>)) {
      setNestedDotPath(result, dotPath, val);
    }
  }

  // 2. $push operator: { arrayPath: item }
  if (patch.$push && typeof patch.$push === "object" && !Array.isArray(patch.$push)) {
    for (const [arrayPath, item] of Object.entries(patch.$push as Record<string, unknown>)) {
      pushNestedDotPath(result, arrayPath, item);
    }
  }

  // 3. Fallback: standard deep-merge for other properties
  for (const [k, v] of Object.entries(patch)) {
    if (k === "$set" || k === "$push") continue;
    deepMergeProperty(result, k, v);
  }

  return result;
}

// deno-lint-ignore no-explicit-any
function setNestedDotPath(obj: Record<string, any>, path: string, value: unknown): void {
  const parts = path.split(".");
  // deno-lint-ignore no-explicit-any
  let curr: any = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (curr[key] === undefined || curr[key] === null || typeof curr[key] !== "object") {
      curr[key] = {};
    }
    curr = curr[key];
  }
  curr[parts[parts.length - 1]] = value;
}

// deno-lint-ignore no-explicit-any
function pushNestedDotPath(obj: Record<string, any>, path: string, item: unknown): void {
  const parts = path.split(".");
  // deno-lint-ignore no-explicit-any
  let curr: any = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (curr[key] === undefined || curr[key] === null || typeof curr[key] !== "object") {
      curr[key] = {};
    }
    curr = curr[key];
  }
  const lastKey = parts[parts.length - 1];
  if (!Array.isArray(curr[lastKey])) {
    curr[lastKey] = [];
  }
  curr[lastKey].push(item);
}

function deepMergeProperty(target: Record<string, unknown>, key: string, value: unknown): void {
  const existing = target[key];
  if (
    existing &&
    typeof existing === "object" &&
    !Array.isArray(existing) &&
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  ) {
    target[key] = deepMergeObjects(existing as Record<string, unknown>, value as Record<string, unknown>);
  } else {
    target[key] = value;
  }
}

function deepMergeObjects(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const res = { ...target };
  for (const [k, v] of Object.entries(source)) {
    if (
      v &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      res[k] &&
      typeof res[k] === "object" &&
      !Array.isArray(res[k])
    ) {
      res[k] = deepMergeObjects(res[k] as Record<string, unknown>, v as Record<string, unknown>);
    } else {
      res[k] = v;
    }
  }
  return res;
}

/**
 * Atomically updates the shared runtime context for an execution using kv.check()
 * with exponential backoff retry. Supports $push, $set, and deep-merge.
 */
export async function patchExecutionContext(
  executionId: ExecutionId,
  patch: Record<string, unknown>,
  maxRetries = 5,
  userId?: string,
): Promise<WorkflowExecution> {
  const uid = resolveUserId(userId);
  const kv = await getKv();
  const key = ["users", uid, "executions", executionId];

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const entry = await kv.get<WorkflowExecution>(key);
    if (!entry.value) {
      throw new Error(`Execution ${executionId} not found`);
    }

    const current = entry.value;
    const updatedContext = applyContextPatch(current.context || {}, patch);
    const updated: WorkflowExecution = {
      ...current,
      context: updatedContext,
      updatedAt: new Date().toISOString(),
    };

    const res = await kv.atomic()
      .check(entry)
      .set(key, updated)
      .commit();

    if (res.ok) {
      return updated;
    }

    const delay = Math.min(20 * Math.pow(2, attempt) + Math.random() * 20, 500);
    await new Promise((r) => setTimeout(r, delay));
  }

  throw new Error(
    `Failed to patch context for execution ${executionId} after ${maxRetries} retries due to concurrent modifications`,
  );
}

/**
 * Transitions a node's execution state within a workflow run.
 * Enforces barrier synchronization when transitioning to "running" if node.joinPolicy === "all".
 */
export async function transitionNodeState(
  input: TransitionNodeStateInput,
): Promise<WorkflowExecution> {
  const uid = resolveUserId(input.userId);
  const kv = await getKv();
  const key = ["users", uid, "executions", input.executionId];
  const now = new Date().toISOString();

  for (let attempt = 0; attempt < 5; attempt++) {
    const entry = await kv.get<WorkflowExecution>(key);
    if (!entry.value) {
      throw new Error(`Execution ${input.executionId} not found`);
    }

    const execution = entry.value;
    const nodeDef = await getNode(execution.workflowId, input.nodeId, uid);

    // Enforce barrier synchronization rules when node activates
    if (input.status === "running") {
      const joinPolicy = nodeDef?.joinPolicy ?? "all";
      const edges = await listEdges(execution.workflowId, { userId: uid });
      const inboundEdges = edges.filter((e) => e.toNodeId === input.nodeId);

      if (inboundEdges.length > 0) {
        if (joinPolicy === "all") {
          for (const edge of inboundEdges) {
            const srcState = execution.nodeStates[edge.fromNodeId];
            if (!srcState || srcState.status !== "completed") {
              throw new Error(
                `Cannot transition node '${input.nodeId}' to running: inbound dependency '${edge.fromNodeId}' is not completed (current status: '${srcState?.status ?? "unknown"}'). Barrier policy is 'all'.`,
              );
            }
          }
        } else if (joinPolicy === "m_of_n") {
          const threshold = nodeDef?.joinThreshold ?? inboundEdges.length;
          const completedCount = inboundEdges.filter(
            (e) => execution.nodeStates[e.fromNodeId]?.status === "completed",
          ).length;
          if (completedCount < threshold) {
            throw new Error(
              `Cannot transition node '${input.nodeId}' to running: completed dependencies (${completedCount}) < threshold (${threshold}). Barrier policy is 'm_of_n'.`,
            );
          }
        }
      }
    }

    const currentState = execution.nodeStates[input.nodeId] || {
      nodeId: input.nodeId,
      status: "pending",
      error: null,
      iteration: 0,
      iterationHistory: [],
      updatedAt: now,
    };

    const newIterationHistory = currentState.iterationHistory ? [...currentState.iterationHistory] : [];
    if (input.status === "completed" || input.status === "failed") {
      newIterationHistory.push({
        iteration: currentState.iteration ?? 1,
        error: input.error ?? null,
        feedback: input.feedback,
        contextDiff: input.contextDiff,
        handledBy: input.handledBy,
        completedAt: now,
      });
    }

    const nextIteration = input.status === "running"
      ? (currentState.iteration ?? 0) + 1
      : (currentState.iteration ?? 1);

    const updatedNodeState: NodeExecutionState = {
      ...currentState,
      status: input.status,
      error: input.error !== undefined ? input.error : currentState.error,
      iteration: nextIteration,
      iterationHistory: newIterationHistory,
      updatedAt: now,
    };

    const updatedExecution: WorkflowExecution = {
      ...execution,
      nodeStates: {
        ...execution.nodeStates,
        [input.nodeId]: updatedNodeState,
      },
      updatedAt: now,
    };

    const res = await kv.atomic()
      .check(entry)
      .set(key, updatedExecution)
      .commit();

    if (res.ok) {
      return updatedExecution;
    }

    const delay = Math.min(20 * Math.pow(2, attempt) + Math.random() * 20, 500);
    await new Promise((r) => setTimeout(r, delay));
  }

  throw new Error(
    `Failed to transition node state for execution ${input.executionId} due to concurrent modifications`,
  );
}

/**
 * Completes a workflow execution, bubble summaries to origin tasks, posts child_completion messages,
 * and releases parent nodes waiting for children.
 */
export async function completeExecution(
  executionId: ExecutionId,
  status: ExecutionStatus,
  finalSummary?: string,
  error?: string,
  userId?: string,
): Promise<WorkflowExecution> {
  const uid = resolveUserId(userId);
  const execution = await getExecution(executionId, uid);
  if (!execution) {
    throw new Error(`Execution ${executionId} not found`);
  }

  const now = new Date().toISOString();
  execution.status = status;
  execution.updatedAt = now;
  await saveExecution(execution, uid);

  // If execution has originTaskId, update origin task and bubble status
  if (execution.originTaskId) {
    const task = await getTask(execution.originTaskId, uid);
    if (task) {
      task.status = status === "completed" ? "closed" : "open";
      if (status === "completed") {
        task.closedAt = now;
        task.closedReason = finalSummary || "Subworkflow completed successfully";
      }

      // Inject finalSummary and error as a TaskComment
      let commentText = `Subworkflow ${executionId} finished with status '${status}'.`;
      if (finalSummary) commentText += ` Summary: ${finalSummary}`;
      if (error) commentText += ` Error: ${error}`;
      const truncatedComment = commentText.length > 256 ? commentText.slice(0, 253) + "..." : commentText;

      const comment: TaskComment = {
        id: `cm-${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`,
        taskId: task.id,
        userId: uid,
        author: "system",
        content: truncatedComment,
        createdAt: now,
      };
      task.comments = [...(task.comments ?? []), comment];
      task.updatedAt = now;
      await saveTask(task, uid);

      // Post automated message to parent execution's message board with topic "child_completion"
      if (execution.parentExecutionId) {
        await postMessage({
          id: crypto.randomUUID(),
          executionId: execution.parentExecutionId,
          workflowId: execution.workflowId,
          taskId: task.id,
          nodeId: execution.originNodeId || task.originNodeId,
          author: "system",
          role: "orchestrator",
          topic: "child_completion",
          content: commentText,
          createdAt: now,
        });
      }

      // If originNodeId is set, check sibling tasks and release parent node
      const originNodeId = execution.originNodeId || task.originNodeId;
      const parentExecId = execution.parentExecutionId || task.originExecutionId;

      if (originNodeId && parentExecId) {
        const activeTasks = await listTasks({
          originExecutionId: parentExecId,
          originNodeId,
          userId: uid,
        });
        const closedTasks = await listClosedTasks({
          originExecutionId: parentExecId,
          originNodeId,
          userId: uid,
        });

        const siblingActive = activeTasks.filter(
          (t) => (t.originNodeId === originNodeId || t.nodeId === originNodeId) &&
            (t.originExecutionId === parentExecId || t.executionId === parentExecId),
        );
        const siblingClosed = closedTasks.filter(
          (t) => (t.originNodeId === originNodeId || t.nodeId === originNodeId) &&
            (t.originExecutionId === parentExecId || t.executionId === parentExecId),
        );

        const totalSiblings = siblingActive.length + siblingClosed.length;
        const allComplete = totalSiblings > 0 && siblingActive.length === 0;

        if (allComplete) {
          const parentExec = await getExecution(parentExecId, uid);
          if (parentExec && parentExec.nodeStates[originNodeId]) {
            if (parentExec.nodeStates[originNodeId].status === "waiting_for_children") {
              await transitionNodeState({
                executionId: parentExecId,
                nodeId: originNodeId,
                status: "completed",
                userId: uid,
              });
            }
          }
        }
      }
    }
  }

  return execution;
}
