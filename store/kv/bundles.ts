/**
 * Deno KV persistence logic for workflow bundle export and import.
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
} from "../types.ts";
import { resolveUserId } from "./client.ts";
import { deleteWorkflow, getWorkflow, saveWorkflow } from "./workflows.ts";
import { listNodes, saveNodes } from "./nodes.ts";
import { listEdges, saveEdge } from "./edges.ts";
import { listExecutions, saveExecution } from "./executions.ts";

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
