/**
 * Graph structural heuristics analyzer for proactively suggesting sub-workflows.
 *
 * Detects:
 * 1. Loop Encapsulation: Cycles / SCCs that can be isolated into child workflows.
 * 2. Linear Chain Extraction: Sequential chains (>= 4 steps) with single-entry / single-exit.
 * 3. High Complexity: Overall node count thresholds (>= 8 nodes).
 */

import type { WorkflowEdge, WorkflowNode, WorkflowSuggestion } from "../store/types.ts";
import { findSCCs } from "./graph.ts";

export interface GraphPrecomputed {
  nodeMap?: Map<string, WorkflowNode>;
  outboundMap?: Map<string, WorkflowEdge[]>;
  inboundMap?: Map<string, WorkflowEdge[]>;
  sccs?: string[][];
}

/**
 * Analyzes a workflow graph and generates actionable suggestions for modularizing
 * complex subgraphs into sub-workflows.
 */
export function analyzeWorkflowSuggestions(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  precomputed?: GraphPrecomputed,
): WorkflowSuggestion[] {
  const suggestions: WorkflowSuggestion[] = [];
  if (nodes.length === 0) return suggestions;

  const nodeMap = precomputed?.nodeMap ??
    new Map<string, WorkflowNode>(nodes.map((n) => [n.id, n]));
  let outboundMap = precomputed?.outboundMap;
  let inboundMap = precomputed?.inboundMap;

  if (!outboundMap || !inboundMap) {
    outboundMap = new Map<string, WorkflowEdge[]>();
    inboundMap = new Map<string, WorkflowEdge[]>();

    for (const node of nodes) {
      outboundMap.set(node.id, []);
      inboundMap.set(node.id, []);
    }

    for (const edge of edges) {
      if (outboundMap.has(edge.fromNodeId)) {
        outboundMap.get(edge.fromNodeId)!.push(edge);
      }
      if (inboundMap.has(edge.toNodeId)) {
        inboundMap.get(edge.toNodeId)!.push(edge);
      }
    }
  }

  // 1. Loop Encapsulation Check
  const nodeIds = nodes.map((n) => n.id);
  const sccs = precomputed?.sccs ?? findSCCs(nodeIds, edges);

  for (const scc of sccs) {
    const isSelfLoop = scc.length === 1 &&
      (outboundMap.get(scc[0]) ?? []).some((e) => e.toNodeId === scc[0]);

    if (scc.length > 1 || isSelfLoop) {
      const sccNodes = scc.map((id) => nodeMap.get(id)).filter((n): n is WorkflowNode =>
        Boolean(n)
      );
      const sccNames = sccNodes.map((n) => `"${n.name}"`).join(", ");

      suggestions.push({
        type: "loop_encapsulation",
        title: "Encapsulate Loop into Sub-Workflow",
        message:
          `Loop detected involving nodes [${sccNames}]. Encapsulating this loop in a dedicated sub-workflow isolates iteration state and simplifies parent orchestration.`,
        nodeIds: scc,
      });
    }
  }

  // 2. Linear Chain Extraction Check (>= 4 sequential step/subworkflow nodes)
  const visitedInChain = new Set<string>();
  for (const node of nodes) {
    // Only start looking for chains from non-start/end nodes that haven't been visited yet
    if (node.type === "start" || node.type === "end" || visitedInChain.has(node.id)) {
      continue;
    }

    // A chain candidate must be a step or user_interaction or subworkflow
    if (node.type !== "step" && node.type !== "user_interaction" && node.type !== "subworkflow") {
      continue;
    }

    // Trace forward along linear paths (in-degree <= 1 from previous and out-degree == 1)
    const currentChain: WorkflowNode[] = [node];
    const currentChainSet = new Set<string>([node.id]);
    let curr = node;

    while (true) {
      const out = outboundMap.get(curr.id) ?? [];
      if (out.length !== 1) break; // Branching or dead end

      const nextNode = nodeMap.get(out[0].toNodeId);
      if (!nextNode) break;

      // Next node must not be start or end, and must have in-degree 1
      if (nextNode.type === "start" || nextNode.type === "end") break;
      const nextIn = inboundMap.get(nextNode.id) ?? [];
      if (nextIn.length !== 1) break; // Convergence point

      // Only include step-like nodes in chains
      if (
        nextNode.type !== "step" && nextNode.type !== "user_interaction" &&
        nextNode.type !== "subworkflow"
      ) {
        break;
      }

      // Avoid infinite cycles in case of loops
      if (currentChainSet.has(nextNode.id)) break;

      currentChain.push(nextNode);
      currentChainSet.add(nextNode.id);
      curr = nextNode;
    }

    if (currentChain.length >= 4) {
      for (const n of currentChain) {
        visitedInChain.add(n.id);
      }
      const chainNames = currentChain.map((n) => `"${n.name}"`).join(" ➔ ");
      suggestions.push({
        type: "chain_extraction",
        title: "Extract Linear Sequence into Sub-Workflow",
        message:
          `A linear sequence of ${currentChain.length} steps (${chainNames}) was detected. Consider extracting this sequence into a sub-workflow with 'workflow_extract_subworkflow' or 'type: subworkflow' to keep the workflow modular.`,
        nodeIds: currentChain.map((n) => n.id),
      });
    }
  }

  // 3. Overall Complexity Threshold (>= 8 nodes total)
  const executableNodes = nodes.filter((n) => n.type !== "start" && n.type !== "end");
  if (nodes.length >= 8 && executableNodes.length >= 6) {
    const existingGeneral = suggestions.some((s) => s.type === "high_complexity");
    if (!existingGeneral) {
      suggestions.push({
        type: "high_complexity",
        title: "High Graph Complexity Advisory",
        message:
          `This workflow has ${nodes.length} total nodes (${executableNodes.length} active steps/decisions). Breaking large monolithic workflows into smaller sub-workflows improves maintainability and reusability.`,
        nodeIds: executableNodes.map((n) => n.id),
      });
    }
  }

  return suggestions;
}
