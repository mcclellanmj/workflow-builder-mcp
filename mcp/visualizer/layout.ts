/**
 * Deterministic layered DAG layout algorithm in pure TypeScript.
 * Assigns ranks, calculates coordinates, and computes cubic Bezier edge paths.
 */

import type { WorkflowEdge, WorkflowNode } from "../../store/types.ts";
import type { LayoutEdge, LayoutNode, SsrGraphLayout } from "./types.ts";

export function getNodeDimensions(node: WorkflowNode): { width: number; height: number } {
  switch (node.type) {
    case "start":
    case "end":
      return { width: 170, height: 50 };
    case "decision":
      return { width: 150, height: 110 };
    case "user_interaction":
      return { width: 210, height: 64 };
    case "subworkflow":
      return { width: 220, height: 68 };
    case "step":
    default:
      return { width: 200, height: 60 };
  }
}

export function computeGraphLayout(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  direction: "TB" | "LR" = "TB",
): SsrGraphLayout {
  if (nodes.length === 0) {
    return { nodes: [], edges: [], width: 400, height: 300, minX: 0, minY: 0 };
  }

  const adj = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  for (const n of nodes) {
    adj.set(n.id, []);
    inDegree.set(n.id, 0);
  }

  for (const e of edges) {
    if (adj.has(e.fromNodeId) && inDegree.has(e.toNodeId)) {
      adj.get(e.fromNodeId)!.push(e.toNodeId);
      inDegree.set(e.toNodeId, inDegree.get(e.toNodeId)! + 1);
    }
  }

  // Detect loopbacks & assign ranks via topological longest path
  const ranks = new Map<string, number>();
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const loopbackEdges = new Set<string>();

  function dfsRank(nodeId: string, currentRank: number): void {
    const existing = ranks.get(nodeId) ?? 0;
    if (currentRank > existing) {
      ranks.set(nodeId, currentRank);
    }

    visited.add(nodeId);
    inStack.add(nodeId);

    const neighbors = adj.get(nodeId) || [];
    for (const nextId of neighbors) {
      if (inStack.has(nextId)) {
        loopbackEdges.add(`${nodeId}->${nextId}`);
      } else {
        dfsRank(nextId, currentRank + 1);
      }
    }

    inStack.delete(nodeId);
  }

  const roots = nodes.filter((n) => n.type === "start" || inDegree.get(n.id) === 0);
  if (roots.length === 0 && nodes.length > 0) {
    roots.push(nodes[0]);
  }

  for (const r of roots) {
    dfsRank(r.id, 0);
  }

  for (const n of nodes) {
    if (!ranks.has(n.id)) {
      dfsRank(n.id, 0);
    }
  }

  // Group nodes by rank
  const rankGroups = new Map<number, WorkflowNode[]>();
  let maxRank = 0;
  for (const n of nodes) {
    const r = ranks.get(n.id) ?? 0;
    if (r > maxRank) maxRank = r;
    if (!rankGroups.has(r)) rankGroups.set(r, []);
    rankGroups.get(r)!.push(n);
  }

  // Compute node positions
  const layoutNodes: LayoutNode[] = [];
  const layoutNodeMap = new Map<string, LayoutNode>();

  const rankSep = direction === "TB" ? 120 : 160;
  const nodeSep = direction === "TB" ? 60 : 70;
  const startMargin = 60;

  let maxRowWidth = 0;
  for (let r = 0; r <= maxRank; r++) {
    const group = rankGroups.get(r) || [];
    let rowSpan = 0;
    for (const n of group) {
      const dim = getNodeDimensions(n);
      rowSpan += (direction === "TB" ? dim.width : dim.height) + nodeSep;
    }
    rowSpan -= nodeSep;
    if (rowSpan > maxRowWidth) maxRowWidth = rowSpan;
  }

  for (let r = 0; r <= maxRank; r++) {
    const group = rankGroups.get(r) || [];
    let currentOffset = startMargin;

    let groupSpan = 0;
    for (const n of group) {
      const dim = getNodeDimensions(n);
      groupSpan += (direction === "TB" ? dim.width : dim.height) + nodeSep;
    }
    groupSpan -= nodeSep;

    if (groupSpan < maxRowWidth) {
      currentOffset += (maxRowWidth - groupSpan) / 2;
    }

    for (const n of group) {
      const dim = getNodeDimensions(n);
      let x = 0;
      let y = 0;

      if (direction === "TB") {
        x = currentOffset + dim.width / 2;
        y = startMargin + r * rankSep + dim.height / 2;
        currentOffset += dim.width + nodeSep;
      } else {
        x = startMargin + r * rankSep + dim.width / 2;
        y = currentOffset + dim.height / 2;
        currentOffset += dim.height + nodeSep;
      }

      const lNode: LayoutNode = {
        node: n,
        x,
        y,
        width: dim.width,
        height: dim.height,
        rank: r,
      };
      layoutNodes.push(lNode);
      layoutNodeMap.set(n.id, lNode);
    }
  }

  // Generate Edges with Bezier curve paths
  const layoutEdges: LayoutEdge[] = [];
  for (const e of edges) {
    const src = layoutNodeMap.get(e.fromNodeId);
    const tgt = layoutNodeMap.get(e.toNodeId);
    if (!src || !tgt) continue;

    const isLoopback = loopbackEdges.has(`${e.fromNodeId}->${e.toNodeId}`) ||
      (tgt.rank <= src.rank);

    let pathD = "";
    let labelX = 0;
    let labelY = 0;

    if (direction === "TB") {
      if (isLoopback) {
        const loopSide = (src.x + tgt.x) / 2 < maxRowWidth / 2 ? -80 : 80;
        const x1 = src.x + (loopSide > 0 ? src.width / 2 : -src.width / 2);
        const y1 = src.y;
        const x2 = tgt.x + (loopSide > 0 ? tgt.width / 2 : -tgt.width / 2);
        const y2 = tgt.y;
        const ctrlX = Math.max(x1, x2) + loopSide;

        pathD = `M ${x1} ${y1} C ${ctrlX} ${y1} ${ctrlX} ${y2} ${x2} ${y2}`;
        labelX = ctrlX + (loopSide > 0 ? 10 : -10);
        labelY = (y1 + y2) / 2;
      } else {
        const x1 = src.x;
        const y1 = src.y + src.height / 2;
        const x2 = tgt.x;
        const y2 = tgt.y - tgt.height / 2;
        const dy = y2 - y1;

        pathD = `M ${x1} ${y1} C ${x1} ${y1 + dy * 0.45} ${x2} ${y2 - dy * 0.45} ${x2} ${y2}`;
        labelX = (x1 + x2) / 2;
        labelY = (y1 + y2) / 2;
      }
    } else {
      if (isLoopback) {
        const loopSide = -80;
        const x1 = src.x;
        const y1 = src.y - src.height / 2;
        const x2 = tgt.x;
        const y2 = tgt.y - tgt.height / 2;
        const ctrlY = Math.min(y1, y2) + loopSide;

        pathD = `M ${x1} ${y1} C ${x1} ${ctrlY} ${x2} ${ctrlY} ${x2} ${y2}`;
        labelX = (x1 + x2) / 2;
        labelY = ctrlY - 10;
      } else {
        const x1 = src.x + src.width / 2;
        const y1 = src.y;
        const x2 = tgt.x - tgt.width / 2;
        const y2 = tgt.y;
        const dx = x2 - x1;

        pathD = `M ${x1} ${y1} C ${x1 + dx * 0.45} ${y1} ${x2 - dx * 0.45} ${y2} ${x2} ${y2}`;
        labelX = (x1 + x2) / 2;
        labelY = (y1 + y2) / 2 - 8;
      }
    }

    layoutEdges.push({
      edge: e,
      sourceNode: src,
      targetNode: tgt,
      pathD,
      labelX,
      labelY,
      isLoopback,
    });
  }

  // Calculate SVG ViewBox bounding box
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const n of layoutNodes) {
    minX = Math.min(minX, n.x - n.width / 2 - 40);
    minY = Math.min(minY, n.y - n.height / 2 - 40);
    maxX = Math.max(maxX, n.x + n.width / 2 + 40);
    maxY = Math.max(maxY, n.y + n.height / 2 + 40);
  }

  for (const e of layoutEdges) {
    if (e.labelX) {
      minX = Math.min(minX, e.labelX - 50);
      maxX = Math.max(maxX, e.labelX + 50);
    }
  }

  if (!isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = 800;
    maxY = 600;
  }

  return {
    nodes: layoutNodes,
    edges: layoutEdges,
    width: Math.max(600, maxX - minX + 60),
    height: Math.max(400, maxY - minY + 60),
    minX: minX - 30,
    minY: minY - 30,
  };
}
