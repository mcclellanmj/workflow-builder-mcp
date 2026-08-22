/**
 * Assembles the complete Cytoscape HTML Visualizer Document.
 * Pre-bundles Cytoscape + Dagre dependencies with zero external CDN requests.
 */

import type { WorkflowExportData } from "../../store/types.ts";
import { getVisualizerClientScript } from "./client_script.ts";
import { getVisualizerStyles } from "./styles.ts";
import { escapeHtml } from "./svg_renderer.ts";
import type { SsrVisualizerOptions } from "./types.ts";
import { CYTOSCAPE_VENDOR_JS } from "./vendor_bundle.ts";

export function generateSsrVisualizerHtml(options: SsrVisualizerOptions): string {
  const { bundle, activeExecutionId, viewTicket } = options;
  const primary = bundle.workflow;
  const subworkflows = bundle.subworkflows ?? [];

  const allWorkflows: Record<string, WorkflowExportData> = {
    [primary.workflow.id]: primary,
  };
  for (const sw of subworkflows) {
    allWorkflows[sw.workflow.id] = sw;
  }

  const safeBundleJson = JSON.stringify({
    primaryWorkflowId: primary.workflow.id,
    activeExecutionId: activeExecutionId || null,
    exportedAt: bundle.exportedAt,
    workflows: allWorkflows,
    ticket: viewTicket ? { ticketId: viewTicket.ticketId, expiresAt: viewTicket.expiresAt } : null,
  }).replace(/<\/script>/gi, "<\\/script>");

  const expiresTimestamp = viewTicket ? viewTicket.expiresAt : null;
  const styles = getVisualizerStyles();
  const clientScript = getVisualizerClientScript();

  return `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Workflow Visualizer — ${escapeHtml(primary.workflow.name)}</title>
  <style>${styles}</style>
  <script>
    ${CYTOSCAPE_VENDOR_JS}
  </script>
</head>
<body>

  <header>
    <div class="header-left">
      <div class="workflow-title-row">
        <span class="workflow-title" id="display-title">${escapeHtml(primary.workflow.name)}</span>
        <span id="display-badge" class="badge" style="border: 1px solid #38bdf8; color: #38bdf8;">Standalone</span>
        ${
    expiresTimestamp
      ? `<span id="ticket-badge" class="badge badge-ticket" title="This shareable view link is time-limited">⏳ Shared Link (<span id="ticket-timer">Active</span>)</span>`
      : ""
  }
      </div>
      <div class="breadcrumbs" id="breadcrumb-bar">
        <a class="breadcrumb-item active" href="#">🏠 ${escapeHtml(primary.workflow.name)}</a>
      </div>
    </div>

    <div class="header-controls">
      <input type="text" id="node-search" class="search-input" placeholder="🔍 Search nodes / prompts...">
      <select id="status-filter" class="btn">
        <option value="all">Status: All</option>
        <option value="completed">Status: Completed ✅</option>
        <option value="running">Status: Running 🔄</option>
        <option value="pending">Status: Pending ⏳</option>
        <option value="failed">Status: Failed ❌</option>
        <option value="skipped">Status: Skipped ⏭️</option>
      </select>
      <button id="layout-toggle-btn" class="btn" title="Toggle Layout Direction (TB / LR)">
        Orientation: <span id="layout-dir-label">TB</span>
      </button>
      <button id="auto-refresh-btn" class="btn" title="Toggle live auto-refresh">
        Live: <span id="refresh-state-label" style="color: #6ee7b7;">ON</span>
      </button>
      <button id="fit-btn" class="btn btn-primary" title="Fit to Viewport">Fit Canvas</button>
    </div>
  </header>

  <div class="app-main">
    <div id="cy-container" style="flex: 1; height: 100%; position: relative;">
      <div id="cy" style="width: 100%; height: 100%;"></div>
      <div class="canvas-toolbar">
        <button id="zoom-in-btn" class="btn" title="Zoom In">+</button>
        <button id="zoom-out-btn" class="btn" title="Zoom Out">-</button>
        <button id="reset-zoom-btn" class="btn" title="Reset Zoom">100%</button>
        <button id="lock-toggle-btn" class="btn" title="Toggle Node Dragging">🔒 Locked</button>
      </div>
    </div>

    <!-- Node Inspector Drawer -->
    <div id="inspector" class="hidden">
      <div class="inspector-header">
        <div class="inspector-title-wrap">
          <div class="inspector-node-name" id="insp-name">Node Name</div>
          <div style="display: flex; gap: 6px; align-items: center; margin-top: 4px;">
            <span id="insp-type-badge" class="badge" style="background: var(--bg-panel-subtle); color: var(--accent);">step</span>
            <span id="insp-status-badge" class="badge badge-status-pending">pending</span>
            <span id="insp-subagent-badge" class="badge" style="display: none; background: #312e81; color: #a5b4fc; border: 1px solid #4338ca;">⚡ Sub-Agent</span>
          </div>
        </div>
        <button id="close-inspector-btn" class="btn" style="padding: 4px 8px;">✕</button>
      </div>

      <div class="inspector-body">
        <div id="insp-subworkflow-action" style="display: none;">
          <button id="insp-drilldown-btn" class="drilldown-btn">
            📦 Drill Down into Subworkflow
          </button>
        </div>

        <div class="section-card">
          <div class="section-title">
            <span>📝 Prompt / Instruction</span>
            <button id="copy-prompt-btn" class="btn" style="padding: 2px 6px; font-size: 0.72rem;">Copy</button>
          </div>
          <div class="prompt-content" id="insp-prompt">No prompt available</div>
        </div>

        <div class="section-card" id="insp-config-card">
          <div class="section-title">
            <span>⚙️ Configuration</span>
          </div>
          <div id="insp-config-details" style="font-size: 0.85rem; color: #cbd5e1; display: flex; flex-direction: column; gap: 6px;"></div>
        </div>

        <div class="section-card" id="insp-execution-card">
          <div class="section-title">
            <span>⚡ Execution Status</span>
            <span id="insp-iter-count" style="color: var(--accent); font-size: 0.75rem;"></span>
          </div>
          
          <div id="insp-error-wrap" style="display: none;">
            <div style="font-size: 0.75rem; color: #f87171; font-weight: 600; margin-bottom: 4px;">Error:</div>
            <div class="error-content" id="insp-error"></div>
          </div>

          <div id="insp-history-wrap" style="display: none; margin-top: 8px;">
            <div style="font-size: 0.75rem; color: var(--text-muted); font-weight: 700; text-transform: uppercase;">Past Iteration History</div>
            <div id="insp-history-list" style="display: flex; flex-direction: column; gap: 6px; margin-top: 6px;"></div>
          </div>
        </div>

        <div class="section-card">
          <div class="section-title">
            <span>ℹ️ Node Metadata</span>
          </div>
          <div style="font-size: 0.8rem; color: var(--text-muted); display: grid; grid-template-columns: 90px 1fr; gap: 6px;">
            <div>Node ID:</div>
            <div style="font-family: monospace; color: #e2e8f0;" id="insp-node-id"></div>
            <div>Workflow ID:</div>
            <div style="font-family: monospace; color: #e2e8f0;" id="insp-wf-id"></div>
            <div>Updated:</div>
            <div id="insp-updated-at"></div>
          </div>
        </div>

      </div>
    </div>
  </div>

  <div id="toast">Copied to clipboard!</div>

  <script id="workflow-bundle" type="application/json">
${safeBundleJson}
  </script>

  <script>${clientScript}</script>
</body>
</html>
`;
}
