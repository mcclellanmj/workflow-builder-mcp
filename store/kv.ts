/**
 * Deno KV persistence layer for workflows, nodes, edges, and execution run instances.
 * All records are user-scoped:
 *   ["users", userId, "workflows", workflowId]                      → Workflow
 *   ["users", userId, "nodes", workflowId, nodeId]                  → WorkflowNode
 *   ["users", userId, "edges", workflowId, edgeId]                  → WorkflowEdge
 *   ["users", userId, "executions", executionId]                    → WorkflowExecution
 *   ["users", userId, "executions_by_workflow", workflowId, execId] → executionId (index for cleanup)
 *   ["users", userId, "subworkflow_refs", childId, workflowId, nodeId] → true
 */

import { getCurrentUserId } from "../auth/context.ts";
import type {
  EdgeId,
  ExecutionId,
  NodeExecutionState,
  NodeId,
  ViewTicket,
  Workflow,
  WorkflowEdge,
  WorkflowExecution,
  WorkflowExportBundle,
  WorkflowExportData,
  WorkflowId,
  WorkflowImportResult,
  WorkflowNode,
} from "./types.ts";

let _kv: Deno.Kv | null = null;

/** Returns the shared Deno KV instance, opening it lazily on first call. */
export async function getKv(): Promise<Deno.Kv> {
  if (!_kv) {
    _kv = await Deno.openKv();
  }
  return _kv;
}

/** Replaces the KV instance (useful for tests). */
export function setKv(kv: Deno.Kv): void {
  _kv = kv;
}

/** Resolves the target userId, defaulting to the current async context or default local user. */
export function resolveUserId(explicitUserId?: string): string {
  return (explicitUserId && explicitUserId.trim().length > 0)
    ? explicitUserId.trim()
    : getCurrentUserId();
}

export interface ListOptions {
  limit?: number;
  userId?: string;
}

async function listEntries<T>(prefix: Deno.KvKey, options?: ListOptions): Promise<T[]> {
  const kv = await getKv();
  const results: T[] = [];
  const listOptions: Deno.KvListOptions = options?.limit ? { limit: options.limit } : {};
  for await (const entry of kv.list<T>({ prefix }, listOptions)) {
    results.push(entry.value);
  }
  return results;
}

// ---------------------------------------------------------------------------
// Workflows
// ---------------------------------------------------------------------------

export async function saveWorkflow(workflow: Workflow, userId?: string): Promise<void> {
  const uid = resolveUserId(userId || workflow.userId);
  workflow.userId = uid;
  const kv = await getKv();
  await kv.set(["users", uid, "workflows", workflow.id], workflow);
}

export async function getWorkflow(id: WorkflowId, userId?: string): Promise<Workflow | null> {
  const uid = resolveUserId(userId);
  const kv = await getKv();
  const entry = await kv.get<Workflow>(["users", uid, "workflows", id]);
  return entry.value;
}

export function listWorkflows(options?: ListOptions): Promise<Workflow[]> {
  const uid = resolveUserId(options?.userId);
  return listEntries<Workflow>(["users", uid, "workflows"], options);
}

const MAX_ATOMIC_OPS = 500;

export async function deleteWorkflow(id: WorkflowId, userId?: string): Promise<void> {
  const uid = resolveUserId(userId);
  const kv = await getKv();
  let atomic = kv.atomic();
  let opCount = 0;

  const commitBatch = async (): Promise<void> => {
    if (opCount > 0) {
      await atomic.commit();
      atomic = kv.atomic();
      opCount = 0;
    }
  };

  // Delete all nodes belonging to this workflow (and any subworkflow index refs)
  for await (const entry of kv.list<WorkflowNode>({ prefix: ["users", uid, "nodes", id] })) {
    atomic.delete(entry.key);
    opCount++;
    if (
      entry.value?.type === "subworkflow" && typeof entry.value.config?.childWorkflowId === "string"
    ) {
      const childId = (entry.value.config.childWorkflowId as string).trim();
      if (childId) {
        atomic.delete(["users", uid, "subworkflow_refs", childId, id, entry.value.id]);
        opCount++;
      }
    }
    if (opCount >= MAX_ATOMIC_OPS) {
      await commitBatch();
    }
  }

  // Delete all edges belonging to this workflow
  for await (const entry of kv.list({ prefix: ["users", uid, "edges", id] })) {
    atomic.delete(entry.key);
    opCount++;
    if (opCount >= MAX_ATOMIC_OPS) {
      await commitBatch();
    }
  }

  // Delete all executions belonging to this workflow (via the by-workflow index)
  for await (
    const entry of kv.list<string>({ prefix: ["users", uid, "executions_by_workflow", id] })
  ) {
    const executionId = entry.value;
    atomic.delete(["users", uid, "executions", executionId]);
    atomic.delete(entry.key);
    opCount += 2;
    if (opCount >= MAX_ATOMIC_OPS) {
      await commitBatch();
    }
  }

  // Delete the workflow itself
  atomic.delete(["users", uid, "workflows", id]);
  opCount++;
  await commitBatch();
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Edges
// ---------------------------------------------------------------------------

export async function saveEdge(edge: WorkflowEdge, userId?: string): Promise<void> {
  const uid = resolveUserId(userId || edge.userId);
  edge.userId = uid;
  const kv = await getKv();
  await kv.set(["users", uid, "edges", edge.workflowId, edge.id], edge);
}

export async function getEdge(
  workflowId: WorkflowId,
  edgeId: string,
  userId?: string,
): Promise<WorkflowEdge | null> {
  const uid = resolveUserId(userId);
  const kv = await getKv();
  const entry = await kv.get<WorkflowEdge>(["users", uid, "edges", workflowId, edgeId]);
  return entry.value;
}

export function listEdges(
  workflowId: WorkflowId,
  options?: ListOptions,
): Promise<WorkflowEdge[]> {
  const uid = resolveUserId(options?.userId);
  return listEntries<WorkflowEdge>(["users", uid, "edges", workflowId], options);
}

export async function deleteEdge(
  workflowId: WorkflowId,
  edgeId: string,
  userId?: string,
): Promise<void> {
  const uid = resolveUserId(userId);
  const kv = await getKv();
  await kv.delete(["users", uid, "edges", workflowId, edgeId]);
}

/** Deletes all edges that reference the given node (inbound or outbound) atomically. */
export async function deleteEdgesForNode(
  workflowId: WorkflowId,
  nodeId: string,
  userId?: string,
): Promise<WorkflowEdge[]> {
  const uid = resolveUserId(userId);
  const edges = await listEdges(workflowId, { userId: uid });
  const removed: WorkflowEdge[] = [];
  const kv = await getKv();
  let atomic = kv.atomic();
  let opCount = 0;

  for (const edge of edges) {
    if (edge.fromNodeId === nodeId || edge.toNodeId === nodeId) {
      atomic.delete(["users", uid, "edges", workflowId, edge.id]);
      removed.push(edge);
      opCount++;
      if (opCount >= MAX_ATOMIC_OPS) {
        await atomic.commit();
        atomic = kv.atomic();
        opCount = 0;
      }
    }
  }

  if (opCount > 0) {
    await atomic.commit();
  }
  return removed;
}

// ---------------------------------------------------------------------------
// Workflow Executions (Run Instances)
// ---------------------------------------------------------------------------

/** Saves a workflow execution (both the main record and the by-workflow index entry). */
export async function saveExecution(
  execution: WorkflowExecution,
  userId?: string,
): Promise<void> {
  const uid = resolveUserId(userId || execution.userId);
  execution.userId = uid;
  const kv = await getKv();
  await kv.atomic()
    .set(["users", uid, "executions", execution.id], execution)
    .set(["users", uid, "executions_by_workflow", execution.workflowId, execution.id], execution.id)
    .commit();
}

/** Retrieves a workflow execution by its ID. Returns null if not found. */
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
 * If workflowId is provided, uses the by-workflow index with batched lookups.
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
    // Batch lookup using getMany in chunks of 128 keys
    for (let i = 0; i < ids.length; i += 128) {
      const chunk = ids.slice(i, i + 128);
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

/** Deletes a workflow execution by its ID (removes both the record and the by-workflow index entry). */
export async function deleteExecution(
  execution: WorkflowExecution,
  userId?: string,
): Promise<void> {
  const uid = resolveUserId(userId || execution.userId);
  const kv = await getKv();
  await kv.atomic()
    .delete(["users", uid, "executions", execution.id])
    .delete(["users", uid, "executions_by_workflow", execution.workflowId, execution.id])
    .commit();
}

// ---------------------------------------------------------------------------
// Workflow Export & Import
// ---------------------------------------------------------------------------

export interface ExportBundleOptions {
  includeExecutions?: boolean;
  includeSubworkflows?: boolean;
  userId?: string;
}

/**
 * Exports a workflow graph, optionally bundling recursive subworkflows and execution runs.
 */
export async function exportWorkflowBundle(
  workflowId: WorkflowId,
  options?: ExportBundleOptions,
): Promise<WorkflowExportBundle | null> {
  const uid = resolveUserId(options?.userId);
  const primaryWf = await getWorkflow(workflowId, uid);
  if (!primaryWf) return null;

  const includeExecs = options?.includeExecutions ?? false;
  const includeSubs = options?.includeSubworkflows ?? true;

  const primaryNodes = await listNodes(workflowId, { userId: uid });
  const primaryEdges = await listEdges(workflowId, { userId: uid });
  const primaryExecs = includeExecs ? await listExecutions(workflowId, { userId: uid }) : undefined;

  const primaryData: WorkflowExportData = {
    workflow: primaryWf,
    nodes: primaryNodes,
    edges: primaryEdges,
    ...(primaryExecs && primaryExecs.length > 0 ? { executions: primaryExecs } : {}),
  };

  const subworkflows: WorkflowExportData[] = [];
  if (includeSubs) {
    const visited = new Set<string>([workflowId]);
    const queue: string[] = [];

    for (const node of primaryNodes) {
      if (node.type === "subworkflow" && typeof node.config?.childWorkflowId === "string") {
        const childId = node.config.childWorkflowId.trim();
        if (childId && !visited.has(childId)) {
          visited.add(childId);
          queue.push(childId);
        }
      }
    }

    while (queue.length > 0) {
      const currentChildId = queue.shift()!;
      const childWf = await getWorkflow(currentChildId, uid);
      if (childWf) {
        const childNodes = await listNodes(currentChildId, { userId: uid });
        const childEdges = await listEdges(currentChildId, { userId: uid });
        const childExecs = includeExecs
          ? await listExecutions(currentChildId, { userId: uid })
          : undefined;

        subworkflows.push({
          workflow: childWf,
          nodes: childNodes,
          edges: childEdges,
          ...(childExecs && childExecs.length > 0 ? { executions: childExecs } : {}),
        });

        for (const node of childNodes) {
          if (node.type === "subworkflow" && typeof node.config?.childWorkflowId === "string") {
            const nestedChildId = node.config.childWorkflowId.trim();
            if (nestedChildId && !visited.has(nestedChildId)) {
              visited.add(nestedChildId);
              queue.push(nestedChildId);
            }
          }
        }
      }
    }
  }

  return {
    version: "1.0",
    exportedAt: new Date().toISOString(),
    workflow: primaryData,
    ...(subworkflows.length > 0 ? { subworkflows } : {}),
  };
}

export interface ImportBundleOptions {
  remapIds?: boolean;
  overwrite?: boolean;
  userId?: string;
}

/**
 * Imports a workflow bundle into the store.
 */
export async function importWorkflowBundle(
  bundle: WorkflowExportBundle,
  options?: ImportBundleOptions,
): Promise<WorkflowImportResult> {
  if (!bundle || bundle.version !== "1.0" || !bundle.workflow || !bundle.workflow.workflow) {
    throw new Error(
      "Invalid bundle: Expected WorkflowExportBundle with version '1.0' and a valid workflow object.",
    );
  }

  const uid = resolveUserId(options?.userId);
  const remapIds = options?.remapIds ?? false;
  const overwrite = options?.overwrite ?? false;

  const allItems: WorkflowExportData[] = [
    bundle.workflow,
    ...(bundle.subworkflows ?? []),
  ];

  // 1. Check for collisions if not remapping and not overwriting
  if (!remapIds && !overwrite) {
    for (const item of allItems) {
      const existing = await getWorkflow(item.workflow.id, uid);
      if (existing) {
        throw new Error(
          `Workflow with ID "${item.workflow.id}" (${item.workflow.name}) already exists. Set overwrite: true or remapIds: true to import.`,
        );
      }
    }
  }

  // 2. Prepare ID mappings if remapping
  const workflowIdMap: Record<WorkflowId, WorkflowId> = {};
  const nodeIdMap: Record<NodeId, NodeId> = {};
  const edgeIdMap: Record<EdgeId, EdgeId> = {};
  const execIdMap: Record<ExecutionId, ExecutionId> = {};

  if (remapIds) {
    for (const item of allItems) {
      const newWfId = crypto.randomUUID();
      workflowIdMap[item.workflow.id] = newWfId;

      for (const node of item.nodes) {
        nodeIdMap[node.id] = crypto.randomUUID();
      }
      for (const edge of item.edges) {
        edgeIdMap[edge.id] = crypto.randomUUID();
      }
      if (item.executions) {
        for (const exec of item.executions) {
          execIdMap[exec.id] = crypto.randomUUID();
        }
      }
    }
  }

  // 3. Transform data
  const transformedItems: WorkflowExportData[] = allItems.map((item) => {
    const wfId = remapIds ? workflowIdMap[item.workflow.id] : item.workflow.id;
    const now = new Date().toISOString();

    const transformedWf: Workflow = {
      ...item.workflow,
      id: wfId,
      userId: uid,
      updatedAt: remapIds ? now : item.workflow.updatedAt,
      createdAt: remapIds ? now : item.workflow.createdAt,
    };

    const transformedNodes: WorkflowNode[] = item.nodes.map((node) => {
      const nId = remapIds ? nodeIdMap[node.id] : node.id;
      const config = { ...node.config };

      if (node.type === "subworkflow" && typeof config.childWorkflowId === "string") {
        const childId = config.childWorkflowId.trim();
        if (remapIds && workflowIdMap[childId]) {
          config.childWorkflowId = workflowIdMap[childId];
        }
      }

      return {
        ...node,
        id: nId,
        workflowId: wfId,
        userId: uid,
        config,
        updatedAt: remapIds ? now : node.updatedAt,
        createdAt: remapIds ? now : node.createdAt,
      };
    });

    const transformedEdges: WorkflowEdge[] = item.edges.map((edge) => {
      const eId = remapIds ? edgeIdMap[edge.id] : edge.id;
      const fromNodeId = remapIds
        ? (nodeIdMap[edge.fromNodeId] ?? edge.fromNodeId)
        : edge.fromNodeId;
      const toNodeId = remapIds ? (nodeIdMap[edge.toNodeId] ?? edge.toNodeId) : edge.toNodeId;

      return {
        ...edge,
        id: eId,
        workflowId: wfId,
        userId: uid,
        fromNodeId,
        toNodeId,
      };
    });

    const transformedExecs: WorkflowExecution[] | undefined = item.executions?.map((exec) => {
      const exId = remapIds ? execIdMap[exec.id] : exec.id;
      const nodeStates: Record<NodeId, NodeExecutionState> = {};

      for (const [oldNId, ns] of Object.entries(exec.nodeStates)) {
        const newNId = remapIds ? (nodeIdMap[oldNId] ?? oldNId) : oldNId;
        nodeStates[newNId] = {
          ...ns,
          nodeId: newNId,
        };
      }

      return {
        ...exec,
        id: exId,
        workflowId: wfId,
        userId: uid,
        nodeStates,
      };
    });

    return {
      workflow: transformedWf,
      nodes: transformedNodes,
      edges: transformedEdges,
      executions: transformedExecs,
    };
  });

  // 4. If overwrite is true and not remapped, delete existing workflows first to clean orphans
  if (overwrite && !remapIds) {
    for (const item of transformedItems) {
      await deleteWorkflow(item.workflow.id, uid);
    }
  }

  // 5. Persist all
  let totalNodes = 0;
  let totalEdges = 0;
  let totalExecutions = 0;
  const importedWorkflowIds: WorkflowId[] = [];

  for (const item of transformedItems) {
    await saveWorkflow(item.workflow, uid);
    await saveNodes(item.nodes, uid);
    for (const edge of item.edges) {
      await saveEdge(edge, uid);
    }
    if (item.executions) {
      for (const exec of item.executions) {
        await saveExecution(exec, uid);
        totalExecutions++;
      }
    }

    importedWorkflowIds.push(item.workflow.id);
    totalNodes += item.nodes.length;
    totalEdges += item.edges.length;
  }

  const primaryWorkflowId = remapIds
    ? workflowIdMap[bundle.workflow.workflow.id]
    : bundle.workflow.workflow.id;

  return {
    primaryWorkflowId,
    importedWorkflowIds,
    totalNodes,
    totalEdges,
    totalExecutions,
    remapped: remapIds,
    ...(remapIds
      ? {
        idMap: {
          workflows: workflowIdMap,
          nodes: nodeIdMap,
          edges: edgeIdMap,
          ...(Object.keys(execIdMap).length > 0 ? { executions: execIdMap } : {}),
        },
      }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// Visualization Share Tickets (Time-limited shareable links: 1 week default, up to 1 year)
// ---------------------------------------------------------------------------

/**
 * Creates a secure, time-limited ticket for sharing/viewing a workflow visualization.
 * Defaults to 1 week (7 days) expiration, configurable up to 1 year (365 days).
 */
export async function createViewTicket(
  workflowId: WorkflowId,
  executionId?: ExecutionId,
  expiresInMinutes = 7 * 24 * 60,
  userId?: string,
): Promise<ViewTicket> {
  const uid = resolveUserId(userId);
  const kv = await getKv();
  const ticketId = crypto.randomUUID().replace(/-/g, "");
  const now = new Date().toISOString();
  const expiresAt = Date.now() + expiresInMinutes * 60 * 1000;

  const ticket: ViewTicket = {
    ticketId,
    userId: uid,
    workflowId,
    executionId,
    createdAt: now,
    expiresAt,
  };

  const atomic = kv.atomic()
    .set(["view_tickets", ticketId], ticket)
    .set(["users", uid, "view_tickets", ticketId], ticketId);

  await atomic.commit();
  return ticket;
}

/**
 * Retrieves a view ticket by ID. Returns null if ticket does not exist or has expired.
 */
export async function getViewTicket(ticketId: string): Promise<ViewTicket | null> {
  const kv = await getKv();
  const entry = await kv.get<ViewTicket>(["view_tickets", ticketId]);
  if (!entry.value) return null;

  if (Date.now() > entry.value.expiresAt) {
    // Expired - clean up asynchronously
    deleteViewTicket(ticketId).catch(() => {});
    return null;
  }

  return entry.value;
}

/**
 * Deletes a view ticket from KV store.
 */
export async function deleteViewTicket(ticketId: string): Promise<void> {
  const kv = await getKv();
  const entry = await kv.get<ViewTicket>(["view_tickets", ticketId]);
  if (!entry.value) return;

  const atomic = kv.atomic()
    .delete(["view_tickets", ticketId])
    .delete(["users", entry.value.userId, "view_tickets", ticketId]);

  await atomic.commit();
}
