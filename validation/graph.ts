/**
 * Workflow graph validation, gated cycle detection, and sub-workflow checks.
 *
 * Validates structural constraints:
 *   - Exactly one start node
 *   - Start nodes have no inbound edges
 *   - End nodes have no outbound edges
 *   - All non-start nodes reachable from start
 *   - Gated cycle validation (cycles are allowed IF gated by decision nodes with exit paths)
 *   - Subworkflow node configuration validation
 *   - Decision node edges cover all declared options
 *   - Valid edge references (source and target nodes exist)
 */

import type { ValidationResult, WorkflowEdge, WorkflowNode } from "../store/types.ts";
import { analyzeWorkflowSuggestions } from "./heuristics.ts";

/**
 * Internal graph representation consolidating lookup maps and node classifications
 * computed in a single pass.
 */
interface GraphIndex {
  nodeMap: Map<string, WorkflowNode>;
  outboundEdges: Map<string, WorkflowEdge[]>;
  inboundEdges: Map<string, WorkflowEdge[]>;
  inDegrees: Map<string, number>;
  startNodes: WorkflowNode[];
  endNodes: WorkflowNode[];
  decisionNodes: WorkflowNode[];
  userInteractionNodes: WorkflowNode[];
  subworkflowNodes: WorkflowNode[];
}

/**
 * Builds indexing structures and validates edge node references in a consolidated pass.
 */
function buildGraphIndex(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  errors: string[],
): GraphIndex {
  const nodeMap = new Map<string, WorkflowNode>();
  const outboundEdges = new Map<string, WorkflowEdge[]>();
  const inboundEdges = new Map<string, WorkflowEdge[]>();
  const inDegrees = new Map<string, number>();
  const startNodes: WorkflowNode[] = [];
  const endNodes: WorkflowNode[] = [];
  const decisionNodes: WorkflowNode[] = [];
  const userInteractionNodes: WorkflowNode[] = [];
  const subworkflowNodes: WorkflowNode[] = [];

  // Single pass over nodes: index lookup, adjacency lists, in-degrees, and types
  for (const node of nodes) {
    nodeMap.set(node.id, node);
    outboundEdges.set(node.id, []);
    inboundEdges.set(node.id, []);
    inDegrees.set(node.id, 0);

    if (node.type === "start") {
      startNodes.push(node);
    } else if (node.type === "end") {
      endNodes.push(node);
    } else if (node.type === "decision") {
      decisionNodes.push(node);
    } else if (node.type === "user_interaction") {
      userInteractionNodes.push(node);
    } else if (node.type === "subworkflow") {
      subworkflowNodes.push(node);
    }
  }

  // Single pass over edges: validate references and populate adjacency / in-degrees
  for (const edge of edges) {
    if (!nodeMap.has(edge.fromNodeId)) {
      errors.push(`Edge "${edge.id}" references non-existent source node "${edge.fromNodeId}".`);
      continue;
    }
    if (!nodeMap.has(edge.toNodeId)) {
      errors.push(`Edge "${edge.id}" references non-existent target node "${edge.toNodeId}".`);
      continue;
    }

    outboundEdges.get(edge.fromNodeId)!.push(edge);
    inboundEdges.get(edge.toNodeId)!.push(edge);
    inDegrees.set(edge.toNodeId, (inDegrees.get(edge.toNodeId) ?? 0) + 1);
  }

  return {
    nodeMap,
    outboundEdges,
    inboundEdges,
    inDegrees,
    startNodes,
    endNodes,
    decisionNodes,
    userInteractionNodes,
    subworkflowNodes,
  };
}

/**
 * Tarjan's strongly connected components algorithm context.
 */
interface TarjanContext {
  index: number;
  indices: Map<string, number>;
  lowlink: Map<string, number>;
  onStack: Map<string, boolean>;
  stack: string[];
  sccs: string[][];
  adjacency: Map<string, string[]>;
}

function strongConnect(v: string, ctx: TarjanContext): void {
  ctx.indices.set(v, ctx.index);
  ctx.lowlink.set(v, ctx.index);
  ctx.index++;
  ctx.stack.push(v);
  ctx.onStack.set(v, true);

  const neighbors = ctx.adjacency.get(v) ?? [];
  for (const w of neighbors) {
    if (!ctx.indices.has(w)) {
      strongConnect(w, ctx);
      ctx.lowlink.set(v, Math.min(ctx.lowlink.get(v)!, ctx.lowlink.get(w)!));
    } else if (ctx.onStack.get(w)) {
      ctx.lowlink.set(v, Math.min(ctx.lowlink.get(v)!, ctx.indices.get(w)!));
    }
  }

  if (ctx.lowlink.get(v) === ctx.indices.get(v)) {
    const scc: string[] = [];
    let w: string;
    do {
      w = ctx.stack.pop()!;
      ctx.onStack.set(w, false);
      scc.push(w);
    } while (w !== v);
    ctx.sccs.push(scc);
  }
}

/**
 * Finds all Strongly Connected Components (SCCs) in a graph.
 */
export function findSCCs(nodeIds: string[], edges: WorkflowEdge[]): string[][] {
  const adjacency = new Map<string, string[]>();
  for (const id of nodeIds) {
    adjacency.set(id, []);
  }
  for (const edge of edges) {
    const list = adjacency.get(edge.fromNodeId);
    if (list) {
      list.push(edge.toNodeId);
    }
  }

  const ctx: TarjanContext = {
    index: 0,
    indices: new Map(),
    lowlink: new Map(),
    onStack: new Map(),
    stack: [],
    sccs: [],
    adjacency,
  };

  for (const id of nodeIds) {
    if (!ctx.indices.has(id)) {
      strongConnect(id, ctx);
    }
  }

  return ctx.sccs;
}

/**
 * Validates the structural integrity of a workflow graph.
 * Supports DAGs as well as controlled / gated cycles (loops with decision nodes).
 *
 * @param nodes List of workflow nodes to validate
 * @param edges List of directed edges connecting the nodes
 * @returns ValidationResult containing valid boolean, errors array, and warnings array
 */
export function validateGraph(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (nodes.length === 0) {
    errors.push("Workflow has no nodes.");
    return { valid: false, errors, warnings };
  }

  // Build lookup maps and classify nodes in a single consolidated pass
  const graph = buildGraphIndex(nodes, edges, errors);

  // --- Start node checks ---
  if (graph.startNodes.length === 0) {
    errors.push("Workflow must have exactly one start node.");
  } else if (graph.startNodes.length > 1) {
    errors.push(
      `Workflow has ${graph.startNodes.length} start nodes (${
        graph.startNodes.map((n) => `"${n.name}"`).join(", ")
      }). Exactly one is required.`,
    );
  }

  for (const startNode of graph.startNodes) {
    const inbound = graph.inboundEdges.get(startNode.id) ?? [];
    if (inbound.length > 0) {
      errors.push(`Start node "${startNode.name}" must not have inbound edges.`);
    }
  }

  // --- End node checks ---
  if (graph.endNodes.length === 0) {
    warnings.push("Workflow has no end node. Consider adding one for explicit completion.");
  }

  for (const endNode of graph.endNodes) {
    const outbound = graph.outboundEdges.get(endNode.id) ?? [];
    if (outbound.length > 0) {
      errors.push(`End node "${endNode.name}" must not have outbound edges.`);
    }
  }

  // --- Subworkflow node checks ---
  for (const subNode of graph.subworkflowNodes) {
    const childWfId = subNode.config?.childWorkflowId;
    if (!childWfId || typeof childWfId !== "string" || childWfId.trim() === "") {
      errors.push(
        `Subworkflow node "${subNode.name}" (${subNode.id}) requires a non-empty 'childWorkflowId' in config.`,
      );
    } else if (childWfId === subNode.workflowId) {
      errors.push(
        `Subworkflow node "${subNode.name}" (${subNode.id}) cannot reference its own workflow ID (self-recursion is not allowed).`,
      );
    }
  }

  // --- Decision & User Interaction node option coverage ---
  for (const dNode of [...graph.decisionNodes, ...graph.userInteractionNodes]) {
    let options: string[] = [];
    const cfgOptions = dNode.config?.options;
    if (Array.isArray(cfgOptions)) {
      options = cfgOptions.filter((o): o is string => typeof o === "string");
    } else if (typeof cfgOptions === "object" && cfgOptions !== null) {
      // If Record<string, string>, the edge condition corresponds to the value
      options = Object.values(cfgOptions as Record<string, unknown>).filter(
        (o): o is string => typeof o === "string",
      );
    }

    const outbound = graph.outboundEdges.get(dNode.id) ?? [];
    const coveredConditions = new Set<string>();
    for (const edge of outbound) {
      if (edge.condition) {
        coveredConditions.add(edge.condition);
      }
    }

    const nodeTypeName = dNode.type === "user_interaction" ? "User interaction" : "Decision";

    for (const option of options) {
      if (!coveredConditions.has(option)) {
        warnings.push(
          `${nodeTypeName} node "${dNode.name}" has option "${option}" with no matching outbound edge.`,
        );
      }
    }

    for (const edge of outbound) {
      if (edge.condition && options.length > 0 && !options.includes(edge.condition)) {
        warnings.push(
          `${nodeTypeName} node "${dNode.name}" has edge with condition "${edge.condition}" that is not in its options [${
            options.join(", ")
          }].`,
        );
      }
    }
  }

  // --- Reachability from start ---
  if (graph.startNodes.length === 1) {
    const startId = graph.startNodes[0].id;
    const reachable = new Set<string>();
    const queue: string[] = [startId];
    reachable.add(startId);
    let queueHead = 0;

    while (queueHead < queue.length) {
      const current = queue[queueHead++];
      for (const edge of graph.outboundEdges.get(current) ?? []) {
        if (!reachable.has(edge.toNodeId)) {
          reachable.add(edge.toNodeId);
          queue.push(edge.toNodeId);
        }
      }
    }

    for (const node of nodes) {
      if (node.type !== "start" && !reachable.has(node.id)) {
        errors.push(`Node "${node.name}" (${node.id}) is not reachable from the start node.`);
      }
    }
  }

  // --- Gated Cycle & Loop Validation ---
  let computedSccs: string[][] | undefined;
  if (errors.length === 0) {
    const nodeIds = nodes.map((n) => n.id);
    const sccs = findSCCs(nodeIds, edges);
    computedSccs = sccs;

    for (const scc of sccs) {
      const isSelfLoop = scc.length === 1 &&
        (graph.outboundEdges.get(scc[0]) ?? []).some((e) => e.toNodeId === scc[0]);

      if (scc.length > 1 || isSelfLoop) {
        // Cyclic component detected!
        const sccNodeMap = scc.map((id) => graph.nodeMap.get(id)!).filter(Boolean);
        const sccNames = sccNodeMap.map((n) => `"${n.name}"`).join(", ");

        // 1. Must contain at least one decision or user_interaction node to provide loop exit condition
        const decisionNodesInLoop = sccNodeMap.filter(
          (n) => n.type === "decision" || n.type === "user_interaction",
        );
        if (decisionNodesInLoop.length === 0) {
          errors.push(
            `Workflow contains an un-gated cycle with nodes [${sccNames}]. Loops must contain at least one decision or user_interaction node to evaluate exit conditions.`,
          );
          continue;
        }

        // 2. Must have at least one exit edge leaving the loop from a decision or user_interaction node
        const sccSet = new Set(scc);
        const exitEdges = edges.filter(
          (e) => sccSet.has(e.fromNodeId) && !sccSet.has(e.toNodeId),
        );

        if (exitEdges.length === 0) {
          errors.push(
            `Workflow contains a cycle with nodes [${sccNames}] that has no exit path.`,
          );
          continue;
        }

        const decisionExitEdges = exitEdges.filter((e) => {
          const fromNode = graph.nodeMap.get(e.fromNodeId);
          return fromNode?.type === "decision" || fromNode?.type === "user_interaction";
        });

        if (decisionExitEdges.length === 0) {
          errors.push(
            `Workflow cycle [${sccNames}] has no exit condition originating from a decision or user_interaction node.`,
          );
          continue;
        }

        // 3. Check if exit path can reach an end node (if end nodes exist)
        if (graph.endNodes.length > 0) {
          const endNodeIds = new Set(graph.endNodes.map((n) => n.id));
          const exitQueue: string[] = exitEdges.map((e) => e.toNodeId);
          const visited = new Set<string>(exitQueue);
          let reachesEnd = false;
          let head = 0;

          while (head < exitQueue.length) {
            const curr = exitQueue[head++];
            if (endNodeIds.has(curr)) {
              reachesEnd = true;
              break;
            }
            for (const edge of graph.outboundEdges.get(curr) ?? []) {
              if (!visited.has(edge.toNodeId)) {
                visited.add(edge.toNodeId);
                exitQueue.push(edge.toNodeId);
              }
            }
          }

          if (!reachesEnd) {
            errors.push(
              `Workflow cycle [${sccNames}] exit paths do not reach any end node.`,
            );
          }
        }
      }
    }
  }

  const suggestions = analyzeWorkflowSuggestions(nodes, edges, {
    nodeMap: graph.nodeMap,
    outboundMap: graph.outboundEdges,
    inboundMap: graph.inboundEdges,
    sccs: computedSccs,
  });

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    ...(suggestions.length > 0 ? { suggestions } : {}),
  };
}

/**
 * Quick check: would adding an edge from → to create a cycle?
 * Uses DFS from `toNodeId` to see if `fromNodeId` is reachable.
 *
 * @param fromNodeId The ID of the source node for the candidate edge
 * @param toNodeId The ID of the target node for the candidate edge
 * @param edges The existing list of edges in the graph
 * @returns True if adding the edge would introduce a cycle, false otherwise
 */
export function wouldCreateCycle(
  fromNodeId: string,
  toNodeId: string,
  edges: WorkflowEdge[],
): boolean {
  // Adding a self-loop directly creates a cycle
  if (fromNodeId === toNodeId) {
    return true;
  }

  // Build adjacency list for existing edges in a single pass
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    const list = adjacency.get(edge.fromNodeId);
    if (list) {
      list.push(edge.toNodeId);
    } else {
      adjacency.set(edge.fromNodeId, [edge.toNodeId]);
    }
  }

  // DFS from toNodeId — check if fromNodeId is reachable
  const visited = new Set<string>();
  const stack: string[] = [toNodeId];
  visited.add(toNodeId);

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === fromNodeId) {
      return true;
    }
    const neighbors = adjacency.get(current);
    if (neighbors) {
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          stack.push(neighbor);
        }
      }
    }
  }
  return false;
}
