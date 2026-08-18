/**
 * Deno KV persistence layer for workflows, nodes, edges, and execution run instances.
 *
 * Key structure:
 *   ["workflows", workflowId]                      → Workflow
 *   ["nodes", workflowId, nodeId]                  → WorkflowNode
 *   ["edges", workflowId, edgeId]                  → WorkflowEdge
 *   ["executions", executionId]                    → WorkflowExecution
 *   ["executions_by_workflow", workflowId, execId] → executionId (index for cleanup)
 */

import type {
  EdgeId,
  ExecutionId,
  NodeExecutionState,
  NodeId,
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

export interface ListOptions {
  limit?: number;
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

export async function saveWorkflow(workflow: Workflow): Promise<void> {
  const kv = await getKv();
  await kv.set(["workflows", workflow.id], workflow);
}

export async function getWorkflow(id: WorkflowId): Promise<Workflow | null> {
  const kv = await getKv();
  const entry = await kv.get<Workflow>(["workflows", id]);
  return entry.value;
}

export function listWorkflows(options?: ListOptions): Promise<Workflow[]> {
  return listEntries<Workflow>(["workflows"], options);
}

const MAX_ATOMIC_OPS = 500;

export async function deleteWorkflow(id: WorkflowId): Promise<void> {
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
  for await (const entry of kv.list<WorkflowNode>({ prefix: ["nodes", id] })) {
    atomic.delete(entry.key);
    opCount++;
    if (
      entry.value?.type === "subworkflow" && typeof entry.value.config?.childWorkflowId === "string"
    ) {
      const childId = (entry.value.config.childWorkflowId as string).trim();
      if (childId) {
        atomic.delete(["subworkflow_refs", childId, id, entry.value.id]);
        opCount++;
      }
    }
    if (opCount >= MAX_ATOMIC_OPS) {
      await commitBatch();
    }
  }

  // Delete all edges belonging to this workflow
  for await (const entry of kv.list({ prefix: ["edges", id] })) {
    atomic.delete(entry.key);
    opCount++;
    if (opCount >= MAX_ATOMIC_OPS) {
      await commitBatch();
    }
  }

  // Delete all executions belonging to this workflow (via the by-workflow index)
  for await (const entry of kv.list<string>({ prefix: ["executions_by_workflow", id] })) {
    const executionId = entry.value;
    atomic.delete(["executions", executionId]);
    atomic.delete(entry.key);
    opCount += 2;
    if (opCount >= MAX_ATOMIC_OPS) {
      await commitBatch();
    }
  }

  // Delete the workflow itself
  atomic.delete(["workflows", id]);
  opCount++;
  await commitBatch();
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

export async function saveNode(node: WorkflowNode): Promise<void> {
  const kv = await getKv();
  const atomic = kv.atomic().set(["nodes", node.workflowId, node.id], node);
  if (node.type === "subworkflow" && typeof node.config?.childWorkflowId === "string") {
    const childId = (node.config.childWorkflowId as string).trim();
    if (childId) {
      atomic.set(["subworkflow_refs", childId, node.workflowId, node.id], true);
    }
  }
  await atomic.commit();
}

export async function saveNodes(nodes: WorkflowNode[]): Promise<void> {
  if (nodes.length === 0) return;
  const kv = await getKv();
  let atomic = kv.atomic();
  let opCount = 0;

  for (const node of nodes) {
    atomic.set(["nodes", node.workflowId, node.id], node);
    opCount++;
    if (node.type === "subworkflow" && typeof node.config?.childWorkflowId === "string") {
      const childId = (node.config.childWorkflowId as string).trim();
      if (childId) {
        atomic.set(["subworkflow_refs", childId, node.workflowId, node.id], true);
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
): Promise<WorkflowNode | null> {
  const kv = await getKv();
  const entry = await kv.get<WorkflowNode>(["nodes", workflowId, nodeId]);
  return entry.value;
}

export function listNodes(
  workflowId: WorkflowId,
  options?: ListOptions,
): Promise<WorkflowNode[]> {
  return listEntries<WorkflowNode>(["nodes", workflowId], options);
}

export async function deleteNode(workflowId: WorkflowId, nodeId: string): Promise<void> {
  const kv = await getKv();
  const existing = await kv.get<WorkflowNode>(["nodes", workflowId, nodeId]);
  const atomic = kv.atomic().delete(["nodes", workflowId, nodeId]);
  if (
    existing.value?.type === "subworkflow" &&
    typeof existing.value.config?.childWorkflowId === "string"
  ) {
    const childId = (existing.value.config.childWorkflowId as string).trim();
    if (childId) {
      atomic.delete(["subworkflow_refs", childId, workflowId, nodeId]);
    }
  }
  await atomic.commit();
}

/** Finds all workflow IDs that are referenced as child workflows in any subworkflow node via index. */
export async function listReferencedChildWorkflowIds(): Promise<Set<string>> {
  const kv = await getKv();
  const referencedIds = new Set<string>();
  for await (const entry of kv.list({ prefix: ["subworkflow_refs"] })) {
    const childId = entry.key[1];
    if (typeof childId === "string" && childId.length > 0) {
      referencedIds.add(childId);
    }
  }

  // Fallback for legacy data not yet indexed: scan nodes once and backfill index
  if (referencedIds.size === 0) {
    for await (const entry of kv.list<WorkflowNode>({ prefix: ["nodes"] })) {
      const node = entry.value;
      if (node && node.type === "subworkflow") {
        const childId = node.config?.childWorkflowId;
        if (typeof childId === "string" && childId.trim().length > 0) {
          const trimmed = childId.trim();
          referencedIds.add(trimmed);
          await kv.set(["subworkflow_refs", trimmed, node.workflowId, node.id], true);
        }
      }
    }
  }

  return referencedIds;
}

// ---------------------------------------------------------------------------
// Edges
// ---------------------------------------------------------------------------

export async function saveEdge(edge: WorkflowEdge): Promise<void> {
  const kv = await getKv();
  await kv.set(["edges", edge.workflowId, edge.id], edge);
}

export async function getEdge(
  workflowId: WorkflowId,
  edgeId: string,
): Promise<WorkflowEdge | null> {
  const kv = await getKv();
  const entry = await kv.get<WorkflowEdge>(["edges", workflowId, edgeId]);
  return entry.value;
}

export function listEdges(
  workflowId: WorkflowId,
  options?: ListOptions,
): Promise<WorkflowEdge[]> {
  return listEntries<WorkflowEdge>(["edges", workflowId], options);
}

export async function deleteEdge(workflowId: WorkflowId, edgeId: string): Promise<void> {
  const kv = await getKv();
  await kv.delete(["edges", workflowId, edgeId]);
}

/** Deletes all edges that reference the given node (inbound or outbound) atomically. */
export async function deleteEdgesForNode(
  workflowId: WorkflowId,
  nodeId: string,
): Promise<WorkflowEdge[]> {
  const edges = await listEdges(workflowId);
  const removed: WorkflowEdge[] = [];
  const kv = await getKv();
  let atomic = kv.atomic();
  let opCount = 0;

  for (const edge of edges) {
    if (edge.fromNodeId === nodeId || edge.toNodeId === nodeId) {
      atomic.delete(["edges", workflowId, edge.id]);
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
export async function saveExecution(execution: WorkflowExecution): Promise<void> {
  const kv = await getKv();
  await kv.atomic()
    .set(["executions", execution.id], execution)
    .set(["executions_by_workflow", execution.workflowId, execution.id], execution.id)
    .commit();
}

/** Retrieves a workflow execution by its ID. Returns null if not found. */
export async function getExecution(id: ExecutionId): Promise<WorkflowExecution | null> {
  const kv = await getKv();
  const entry = await kv.get<WorkflowExecution>(["executions", id]);
  return entry.value;
}

/**
 * Lists all workflow executions, optionally filtered to a specific workflow.
 * If workflowId is provided, uses the by-workflow index with batched lookups.
 */
export async function listExecutions(workflowId?: WorkflowId): Promise<WorkflowExecution[]> {
  const kv = await getKv();
  const results: WorkflowExecution[] = [];

  if (workflowId) {
    const ids: string[] = [];
    for await (const entry of kv.list<string>({ prefix: ["executions_by_workflow", workflowId] })) {
      if (entry.value) {
        ids.push(entry.value);
      }
    }
    // Batch lookup using getMany in chunks of 128 keys
    for (let i = 0; i < ids.length; i += 128) {
      const chunk = ids.slice(i, i + 128);
      const keys = chunk.map((id) => ["executions", id]);
      const entries = await kv.getMany<WorkflowExecution[]>(keys);
      for (const entry of entries) {
        if (entry.value) {
          results.push(entry.value);
        }
      }
    }
  } else {
    for await (const entry of kv.list<WorkflowExecution>({ prefix: ["executions"] })) {
      if (entry.value && typeof entry.value === "object") {
        results.push(entry.value);
      }
    }
  }

  return results;
}

/** Deletes a workflow execution by its ID (removes both the record and the by-workflow index entry). */
export async function deleteExecution(execution: WorkflowExecution): Promise<void> {
  const kv = await getKv();
  await kv.atomic()
    .delete(["executions", execution.id])
    .delete(["executions_by_workflow", execution.workflowId, execution.id])
    .commit();
}

// ---------------------------------------------------------------------------
// Workflow Export & Import
// ---------------------------------------------------------------------------

export interface ExportBundleOptions {
  includeExecutions?: boolean;
  includeSubworkflows?: boolean;
}

/**
 * Exports a workflow graph, optionally bundling recursive subworkflows and execution runs.
 */
export async function exportWorkflowBundle(
  workflowId: WorkflowId,
  options?: ExportBundleOptions,
): Promise<WorkflowExportBundle | null> {
  const primaryWf = await getWorkflow(workflowId);
  if (!primaryWf) return null;

  const includeExecs = options?.includeExecutions ?? false;
  const includeSubs = options?.includeSubworkflows ?? true;

  const primaryNodes = await listNodes(workflowId);
  const primaryEdges = await listEdges(workflowId);
  const primaryExecs = includeExecs ? await listExecutions(workflowId) : undefined;

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
      const childWf = await getWorkflow(currentChildId);
      if (childWf) {
        const childNodes = await listNodes(currentChildId);
        const childEdges = await listEdges(currentChildId);
        const childExecs = includeExecs ? await listExecutions(currentChildId) : undefined;

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

  const remapIds = options?.remapIds ?? false;
  const overwrite = options?.overwrite ?? false;

  const allItems: WorkflowExportData[] = [
    bundle.workflow,
    ...(bundle.subworkflows ?? []),
  ];

  // 1. Check for collisions if not remapping and not overwriting
  if (!remapIds && !overwrite) {
    for (const item of allItems) {
      const existing = await getWorkflow(item.workflow.id);
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
      await deleteWorkflow(item.workflow.id);
    }
  }

  // 5. Persist all
  let totalNodes = 0;
  let totalEdges = 0;
  let totalExecutions = 0;
  const importedWorkflowIds: WorkflowId[] = [];

  for (const item of transformedItems) {
    await saveWorkflow(item.workflow);
    await saveNodes(item.nodes);
    for (const edge of item.edges) {
      await saveEdge(edge);
    }
    if (item.executions) {
      for (const exec of item.executions) {
        await saveExecution(exec);
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
