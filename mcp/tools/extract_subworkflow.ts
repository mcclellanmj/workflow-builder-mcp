import { z } from "zod";
import { getKv, resolveUserId } from "../../store/kv.ts";
import type { Workflow, WorkflowEdge, WorkflowNode } from "../../store/types.ts";
import { createErrorResponse } from "../registry.ts";
import { defineTool, jsonResponse, requireWorkflowGraph, resolveNode } from "../helpers.ts";

const ExtractSubworkflowSchema = z.object({
  parentWorkflow: z.string().min(1).optional().describe(
    "The ID, name, or slug of the parent workflow from which nodes will be extracted.",
  ),
  parentWorkflowId: z.string().min(1).optional().describe(
    "Alias for 'parentWorkflow'. The ID, name, or slug of the parent workflow.",
  ),
  workflow: z.string().min(1).optional().describe(
    "Alias for 'parentWorkflow'.",
  ),
  workflowId: z.string().min(1).optional().describe(
    "Alias for 'parentWorkflow'.",
  ),
  nodes: z.array(z.string().min(1)).min(1).optional().describe(
    "The array of node IDs, names, or slugs in the parent workflow to extract into a child sub-workflow.",
  ),
  nodeIds: z.array(z.string().min(1)).min(1).optional().describe(
    "Alias for 'nodes'. The array of node IDs, names, or slugs in the parent workflow to extract into a child sub-workflow.",
  ),
  subworkflowName: z.string().min(1).describe(
    "The name for the newly created child sub-workflow.",
  ),
  subworkflowDescription: z.string().optional().describe(
    "Optional description for the newly created child sub-workflow.",
  ),
  subworkflowNodeName: z.string().optional().describe(
    "Optional name for the subworkflow node in the parent workflow (defaults to subworkflowName).",
  ),
}).refine(
  (data) =>
    (data.parentWorkflow || data.parentWorkflowId || data.workflow || data.workflowId) &&
    (data.nodes || data.nodeIds),
  {
    message:
      "Parent workflow ('parentWorkflow' or 'parentWorkflowId') and nodes ('nodes' or 'nodeIds') must be provided.",
  },
);

export const extractSubworkflowTool = defineTool({
  name: "workflow_extract_subworkflow",
  description:
    "Refactors an existing workflow by extracting a specified set of nodes into a new child sub-workflow. Supports workflow and node UUIDs, exact names, or slugs. Automatically creates the child workflow (flagged with intendedForIndependentRun: false), creates start/end boundaries inside the child workflow, replaces the extracted nodes in the parent workflow with a single 'subworkflow' node, and rewires all inbound/outbound connections.",
  schema: ExtractSubworkflowSchema,
  execute: async ({
    parentWorkflow,
    parentWorkflowId,
    workflow,
    workflowId,
    nodes,
    nodeIds,
    subworkflowName,
    subworkflowDescription,
    subworkflowNodeName,
  }) => {
    const targetParentWf = parentWorkflow ?? parentWorkflowId ?? workflow ?? workflowId!;
    const rawTargetNodes = nodes ?? nodeIds!;

    const graphCheck = await requireWorkflowGraph(targetParentWf);
    if ("error" in graphCheck) return graphCheck.error;

    const { workflow: parentWf, nodes: parentNodes, edges: parentEdges } = graphCheck;
    const actualParentWfId = parentWf.id;
    const parentNodeMap = new Map(parentNodes.map((n) => [n.id, n]));

    // Resolve node IDs from names, slugs, or UUIDs
    const resolvedNodeIds: string[] = [];
    for (const rawIdentifier of rawTargetNodes) {
      const matchedNode = resolveNode(rawIdentifier, parentNodes);
      if (!matchedNode) {
        return createErrorResponse(
          `Node "${rawIdentifier}" not found in parent workflow "${parentWf.name}" (${actualParentWfId}).`,
        );
      }
      if (matchedNode.type === "start") {
        return createErrorResponse(
          "Cannot extract the parent workflow's 'start' node into a sub-workflow.",
        );
      }
      if (matchedNode.type === "end") {
        return createErrorResponse(
          "Cannot extract the parent workflow's 'end' node into a sub-workflow.",
        );
      }
      resolvedNodeIds.push(matchedNode.id);
    }

    const targetNodeIdSet = new Set(resolvedNodeIds);
    const resolvedNodeList = resolvedNodeIds;

    const now = new Date().toISOString();
    const childWorkflowId = crypto.randomUUID();

    // 1. Partition parent edges
    const internalEdges: WorkflowEdge[] = [];
    const inboundExternalEdges: WorkflowEdge[] = [];
    const outboundExternalEdges: WorkflowEdge[] = [];

    for (const edge of parentEdges) {
      const fromInside = targetNodeIdSet.has(edge.fromNodeId);
      const toInside = targetNodeIdSet.has(edge.toNodeId);

      if (fromInside && toInside) {
        internalEdges.push(edge);
      } else if (!fromInside && toInside) {
        inboundExternalEdges.push(edge);
      } else if (fromInside && !toInside) {
        outboundExternalEdges.push(edge);
      }
    }

    // 2. Identify Entry and Exit nodes within the extracted set
    const entryNodeIds = new Set<string>();
    for (const edge of inboundExternalEdges) {
      entryNodeIds.add(edge.toNodeId);
    }
    // If no inbound external edges, fall back to any target node without incoming internal edges
    if (entryNodeIds.size === 0) {
      const targetNodesWithInbound = new Set(internalEdges.map((e) => e.toNodeId));
      for (const id of resolvedNodeList) {
        if (!targetNodesWithInbound.has(id)) {
          entryNodeIds.add(id);
        }
      }
      // If still empty (e.g. cycle), pick the first node
      if (entryNodeIds.size === 0 && resolvedNodeList.length > 0) {
        entryNodeIds.add(resolvedNodeList[0]);
      }
    }

    const exitNodeIds = new Set<string>();
    for (const edge of outboundExternalEdges) {
      exitNodeIds.add(edge.fromNodeId);
    }
    // If no outbound external edges, fall back to any target node without outgoing internal edges
    if (exitNodeIds.size === 0) {
      const targetNodesWithOutbound = new Set(internalEdges.map((e) => e.fromNodeId));
      for (const id of resolvedNodeList) {
        if (!targetNodesWithOutbound.has(id)) {
          exitNodeIds.add(id);
        }
      }
      if (exitNodeIds.size === 0 && resolvedNodeList.length > 0) {
        exitNodeIds.add(resolvedNodeList[resolvedNodeList.length - 1]);
      }
    }

    // 3. Create Child Workflow and Child Nodes
    const childWorkflow: Workflow = {
      id: childWorkflowId,
      name: subworkflowName,
      description: subworkflowDescription ??
        `Extracted sub-workflow from ${graphCheck.workflow.name}`,
      intendedForIndependentRun: false,
      createdAt: now,
      updatedAt: now,
    };

    const childStartNode: WorkflowNode = {
      id: crypto.randomUUID(),
      workflowId: childWorkflowId,
      type: "start",
      name: "Start",
      description: "Sub-workflow start",
      runInSubAgent: false,
      config: {},
      status: "pending",
      error: null,
      createdAt: now,
      updatedAt: now,
    };

    const childEndNode: WorkflowNode = {
      id: crypto.randomUUID(),
      workflowId: childWorkflowId,
      type: "end",
      name: "End",
      description: "Sub-workflow end",
      runInSubAgent: false,
      config: {},
      status: "pending",
      error: null,
      createdAt: now,
      updatedAt: now,
    };

    // Node ID mapping from parent ID to child ID
    const idMap = new Map<string, string>();
    const childMigratedNodes: WorkflowNode[] = [];

    for (const nodeId of resolvedNodeList) {
      const parentNode = parentNodeMap.get(nodeId)!;
      const childNodeId = crypto.randomUUID();
      idMap.set(nodeId, childNodeId);

      childMigratedNodes.push({
        id: childNodeId,
        workflowId: childWorkflowId,
        type: parentNode.type,
        name: parentNode.name,
        description: parentNode.description,
        runInSubAgent: parentNode.runInSubAgent,
        config: { ...parentNode.config },
        status: "pending",
        error: null,
        createdAt: now,
        updatedAt: now,
      });
    }

    // 4. Create Child Edges
    const childEdges: WorkflowEdge[] = [];

    // Edges from child start -> entry nodes
    for (const entryId of entryNodeIds) {
      const mappedEntryId = idMap.get(entryId)!;
      childEdges.push({
        id: crypto.randomUUID(),
        workflowId: childWorkflowId,
        fromNodeId: childStartNode.id,
        toNodeId: mappedEntryId,
      });
    }

    // Internal migrated edges
    for (const edge of internalEdges) {
      childEdges.push({
        id: crypto.randomUUID(),
        workflowId: childWorkflowId,
        fromNodeId: idMap.get(edge.fromNodeId)!,
        toNodeId: idMap.get(edge.toNodeId)!,
        ...(edge.condition ? { condition: edge.condition } : {}),
      });
    }

    // Edges from exit nodes -> child end
    for (const exitId of exitNodeIds) {
      const mappedExitId = idMap.get(exitId)!;
      childEdges.push({
        id: crypto.randomUUID(),
        workflowId: childWorkflowId,
        fromNodeId: mappedExitId,
        toNodeId: childEndNode.id,
      });
    }

    // 5. Replace nodes in Parent Workflow with Subworkflow Node
    const parentSubworkflowNodeId = crypto.randomUUID();
    const parentSubworkflowNode: WorkflowNode = {
      id: parentSubworkflowNodeId,
      workflowId: actualParentWfId,
      type: "subworkflow",
      name: subworkflowNodeName ?? subworkflowName,
      description: subworkflowDescription ?? `Executes sub-workflow "${subworkflowName}"`,
      runInSubAgent: false,
      config: {
        childWorkflowId,
      },
      status: "pending",
      error: null,
      createdAt: now,
      updatedAt: now,
    };

    // New parent edges replacing external connections
    const newParentEdges: WorkflowEdge[] = [];
    const seenParentEdgeKeys = new Set<string>();

    for (const edge of inboundExternalEdges) {
      const edgeKey = `${edge.fromNodeId}->${parentSubworkflowNodeId}:${edge.condition || ""}`;
      if (!seenParentEdgeKeys.has(edgeKey)) {
        seenParentEdgeKeys.add(edgeKey);
        newParentEdges.push({
          id: crypto.randomUUID(),
          workflowId: actualParentWfId,
          fromNodeId: edge.fromNodeId,
          toNodeId: parentSubworkflowNodeId,
          ...(edge.condition ? { condition: edge.condition } : {}),
        });
      }
    }

    for (const edge of outboundExternalEdges) {
      const edgeKey = `${parentSubworkflowNodeId}->${edge.toNodeId}:${edge.condition || ""}`;
      if (!seenParentEdgeKeys.has(edgeKey)) {
        seenParentEdgeKeys.add(edgeKey);
        newParentEdges.push({
          id: crypto.randomUUID(),
          workflowId: actualParentWfId,
          fromNodeId: parentSubworkflowNodeId,
          toNodeId: edge.toNodeId,
          ...(edge.condition ? { condition: edge.condition } : {}),
        });
      }
    }

    // 6. Persist Child Workflow and Parent Workflow mutations atomically
    const uid = resolveUserId();
    childWorkflow.userId = uid;
    parentSubworkflowNode.userId = uid;

    const kv = await getKv();
    const atomic = kv.atomic();

    // Child workflow record
    atomic.set(["users", uid, "workflows", childWorkflow.id], childWorkflow);

    // Child nodes
    const childAllNodes = [childStartNode, ...childMigratedNodes, childEndNode];
    for (const node of childAllNodes) {
      node.userId = uid;
      atomic.set(["users", uid, "nodes", childWorkflow.id, node.id], node);
      if (node.type === "subworkflow" && typeof node.config?.childWorkflowId === "string") {
        const cId = (node.config.childWorkflowId as string).trim();
        if (cId) {
          atomic.set(["users", uid, "subworkflow_refs", cId, childWorkflow.id, node.id], true);
        }
      }
    }

    // Child edges
    for (const edge of childEdges) {
      edge.userId = uid;
      atomic.set(["users", uid, "edges", childWorkflow.id, edge.id], edge);
    }

    // Delete extracted parent nodes & their subworkflow_refs if any
    for (const nodeId of resolvedNodeList) {
      atomic.delete(["users", uid, "nodes", actualParentWfId, nodeId]);
      const nodeObj = parentNodeMap.get(nodeId);
      if (nodeObj?.type === "subworkflow" && typeof nodeObj.config?.childWorkflowId === "string") {
        const cId = (nodeObj.config.childWorkflowId as string).trim();
        if (cId) {
          atomic.delete(["users", uid, "subworkflow_refs", cId, actualParentWfId, nodeId]);
        }
      }
    }

    // Delete extracted / obsolete parent edges
    for (const edge of [...internalEdges, ...inboundExternalEdges, ...outboundExternalEdges]) {
      atomic.delete(["users", uid, "edges", actualParentWfId, edge.id]);
    }

    // Save replacement subworkflow node in parent and register subworkflow ref index
    atomic.set(
      ["users", uid, "nodes", actualParentWfId, parentSubworkflowNode.id],
      parentSubworkflowNode,
    );
    atomic.set(
      [
        "users",
        uid,
        "subworkflow_refs",
        childWorkflowId,
        actualParentWfId,
        parentSubworkflowNode.id,
      ],
      true,
    );

    // Save new parent rewired edges
    for (const edge of newParentEdges) {
      edge.userId = uid;
      atomic.set(["users", uid, "edges", actualParentWfId, edge.id], edge);
    }

    const commitResult = await atomic.commit();
    if (!commitResult.ok) {
      return createErrorResponse(
        "Failed to commit sub-workflow extraction atomically to KV store.",
      );
    }

    return jsonResponse({
      message:
        `Successfully extracted ${resolvedNodeList.length} nodes into sub-workflow "${subworkflowName}".`,
      childWorkflow: {
        id: childWorkflow.id,
        name: childWorkflow.name,
        intendedForIndependentRun: childWorkflow.intendedForIndependentRun,
        nodeCount: childMigratedNodes.length + 2,
      },
      parentSubworkflowNode: {
        id: parentSubworkflowNode.id,
        name: parentSubworkflowNode.name,
        type: parentSubworkflowNode.type,
        childWorkflowId,
      },
      rewiredInboundEdges: newParentEdges.filter((e) =>
        e.toNodeId === parentSubworkflowNodeId
      ).length,
      rewiredOutboundEdges: newParentEdges.filter((e) =>
        e.fromNodeId === parentSubworkflowNodeId
      ).length,
    });
  },
});
