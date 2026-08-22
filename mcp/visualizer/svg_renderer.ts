/**
 * SVG Node and Edge Component Renderers.
 * Produces crisp, semantic vector graphics with dark-theme styling and badges.
 */

import type { WorkflowExportData } from "../../store/types.ts";
import { computeGraphLayout } from "./layout.ts";
import type { LayoutEdge, LayoutNode, SsrGraphLayout } from "./types.ts";

export function escapeHtml(text: string | null | undefined): string {
  if (text == null) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export const STATUS_BORDER_COLORS: Record<string, string> = {
  completed: "#10b981",
  running: "#3b82f6",
  pending: "#f59e0b",
  failed: "#ef4444",
  skipped: "#64748b",
};

export const STATUS_ICONS: Record<string, string> = {
  completed: "✅",
  running: "🔄",
  pending: "⏳",
  failed: "❌",
  skipped: "⏭️",
};

export function renderSvgNode(ln: LayoutNode): string {
  const n = ln.node;
  const x = ln.x - ln.width / 2;
  const y = ln.y - ln.height / 2;
  const w = ln.width;
  const h = ln.height;
  const status = n.status || "pending";
  const borderColor = STATUS_BORDER_COLORS[status] || "#475569";
  const icon = STATUS_ICONS[status] || "⏳";
  const iterText = n.iteration && n.iteration > 1 ? ` (i:${n.iteration})` : "";

  let shapeMarkup = "";

  if (n.type === "start" || n.type === "end") {
    const rx = h / 2;
    shapeMarkup = `
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}"
        fill="#1e293b" stroke="${borderColor}" stroke-width="2.5" class="node-shape" filter="url(#node-shadow)" />
      <text x="${ln.x}" y="${
      ln.y + 5
    }" text-anchor="middle" font-size="13" font-weight="600" fill="#f8fafc">
        ${icon} ${escapeHtml(n.name)}
      </text>
    `;
  } else if (n.type === "decision") {
    const pts = `${ln.x},${y} ${x + w},${ln.y} ${ln.x},${y + h} ${x},${ln.y}`;
    shapeMarkup = `
      <polygon points="${pts}" fill="#241e12" stroke="${borderColor}" stroke-width="2.5" class="node-shape" filter="url(#node-shadow)" />
      <text x="${ln.x}" y="${
      ln.y - 6
    }" text-anchor="middle" font-size="11" font-weight="700" fill="#fcd34d">
        ${icon} DECISION
      </text>
      <text x="${ln.x}" y="${
      ln.y + 12
    }" text-anchor="middle" font-size="12" font-weight="600" fill="#f8fafc" class="truncate-text">
        ${escapeHtml(n.name)}
      </text>
    `;
  } else if (n.type === "user_interaction") {
    const cut = 16;
    const pts = `${x + cut},${y} ${x + w - cut},${y} ${x + w},${ln.y} ${x + w - cut},${y + h} ${
      x + cut
    },${y + h} ${x},${ln.y}`;
    shapeMarkup = `
      <polygon points="${pts}" fill="#134e4a" stroke="${borderColor}" stroke-width="2.5" class="node-shape" filter="url(#node-shadow)" />
      <text x="${ln.x}" y="${
      ln.y - 6
    }" text-anchor="middle" font-size="10" font-weight="700" fill="#5eead4">
        👤 USER INTERACTION
      </text>
      <text x="${ln.x}" y="${
      ln.y + 12
    }" text-anchor="middle" font-size="12" font-weight="600" fill="#f8fafc">
        ${icon} ${escapeHtml(n.name)}
      </text>
    `;
  } else if (n.type === "subworkflow") {
    shapeMarkup = `
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8"
        fill="#2e1065" stroke="${borderColor}" stroke-width="2.5" stroke-dasharray="6,4" class="node-shape" filter="url(#node-shadow)" />
      <text x="${ln.x}" y="${
      ln.y - 8
    }" text-anchor="middle" font-size="10" font-weight="700" fill="#d8b4fe">
        📦 SUBWORKFLOW
      </text>
      <text x="${ln.x}" y="${
      ln.y + 12
    }" text-anchor="middle" font-size="12" font-weight="600" fill="#f8fafc">
        ${icon} ${escapeHtml(n.name)}${iterText}
      </text>
    `;
  } else {
    const subagentBadge = n.runInSubAgent
      ? `<text x="${x + w - 10}" y="${
        y + 14
      }" text-anchor="end" font-size="9" font-weight="700" fill="#a5b4fc">⚡ AGENT</text>`
      : "";

    shapeMarkup = `
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8"
        fill="#1e293b" stroke="${borderColor}" stroke-width="2.5" class="node-shape" filter="url(#node-shadow)" />
      ${subagentBadge}
      <text x="${x + 14}" y="${ln.y + 5}" font-size="12" font-weight="600" fill="#f8fafc">
        ${icon} ${escapeHtml(n.name)}${iterText}
      </text>
    `;
  }

  return `
    <g class="wf-node" data-node-id="${n.id}" data-status="${status}" data-type="${n.type}" tabindex="0" cursor="pointer">
      ${shapeMarkup}
    </g>
  `;
}

export function renderSvgEdge(le: LayoutEdge): string {
  const e = le.edge;
  const isLoop = le.isLoopback;
  const strokeColor = isLoop ? "#a855f7" : "#64748b";
  const marker = isLoop ? "url(#arrow-loop)" : "url(#arrow-normal)";

  let labelMarkup = "";
  if (e.condition) {
    const condText = escapeHtml(e.condition);
    const badgeW = Math.max(40, condText.length * 7 + 14);
    labelMarkup = `
      <g class="edge-label" transform="translate(${le.labelX}, ${le.labelY})">
        <rect x="${
      -badgeW / 2
    }" y="-11" width="${badgeW}" height="20" rx="5" fill="#0f172a" stroke="#38bdf8" stroke-width="1.2" />
        <text x="0" y="3" text-anchor="middle" font-size="10.5" font-weight="600" fill="#38bdf8">${condText}</text>
      </g>
    `;
  }

  return `
    <g class="wf-edge" data-edge-id="${e.id}" data-source="${e.fromNodeId}" data-target="${e.toNodeId}">
      <path d="${le.pathD}" fill="none" stroke="${strokeColor}" stroke-width="2" marker-end="${marker}" class="edge-path" />
      ${labelMarkup}
    </g>
  `;
}

export function renderWorkflowSvg(
  wfData: WorkflowExportData,
  direction: "TB" | "LR" = "TB",
): { svg: string; layout: SsrGraphLayout } {
  const layout = computeGraphLayout(wfData.nodes, wfData.edges, direction);

  const nodesMarkup = layout.nodes.map(renderSvgNode).join("\n");
  const edgesMarkup = layout.edges.map(renderSvgEdge).join("\n");

  const svg = `
    <svg id="workflow-svg" viewBox="${layout.minX} ${layout.minY} ${layout.width} ${layout.height}" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="node-shadow" x="-10%" y="-10%" width="130%" height="130%">
          <feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="#000" flood-opacity="0.5"/>
        </filter>
        <marker id="arrow-normal" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1.5 L 10 5 L 0 8.5 z" fill="#64748b" />
        </marker>
        <marker id="arrow-loop" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1.5 L 10 5 L 0 8.5 z" fill="#a855f7" />
        </marker>
      </defs>
      <g id="viewport-group">
        <g id="edges-layer">${edgesMarkup}</g>
        <g id="nodes-layer">${nodesMarkup}</g>
      </g>
    </svg>
  `;

  return { svg, layout };
}
