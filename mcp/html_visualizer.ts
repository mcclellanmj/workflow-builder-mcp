/**
 * HTML Visualizer Generator
 *
 * Produces a self-contained, interactive HTML document allowing users to:
 * - Visually inspect workflow and subworkflow graphs (pan/zoom/fit/layout toggle).
 * - Click any node to view full prompts, instructions, configs, and loop iteration history in an inspector drawer.
 * - Drill down into subworkflows with dynamic breadcrumb navigation.
 * - Search nodes by name/prompt and filter by execution status.
 */

import type { WorkflowExportBundle, WorkflowExportData } from "../store/types.ts";

export interface HtmlVisualizerOptions {
  bundle: WorkflowExportBundle;
  activeExecutionId?: string;
}

/**
 * Escapes HTML entities for safe inclusion in templates.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Safely serializes JSON for inclusion inside a <script> tag.
 */
function safeJsonScript(data: unknown): string {
  return JSON.stringify(data).replace(/<\/script>/gi, "<\\/script>");
}

export function generateInteractiveHtml(options: HtmlVisualizerOptions): string {
  const { bundle, activeExecutionId } = options;
  const primary = bundle.workflow;
  const subworkflows = bundle.subworkflows ?? [];

  // Build a lookup map of all workflows by ID
  const allWorkflows: Record<string, WorkflowExportData> = {
    [primary.workflow.id]: primary,
  };
  for (const sw of subworkflows) {
    allWorkflows[sw.workflow.id] = sw;
  }

  const serializedData = safeJsonScript({
    primaryWorkflowId: primary.workflow.id,
    activeExecutionId: activeExecutionId || null,
    exportedAt: bundle.exportedAt,
    workflows: allWorkflows,
  });

  return `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Workflow Visualizer — ${escapeHtml(primary.workflow.name)}</title>
  <style>
    :root {
      --bg-main: #0f172a;
      --bg-panel: #1e293b;
      --bg-panel-subtle: #334155;
      --border-color: #475569;
      --text-main: #f8fafc;
      --text-muted: #94a3b8;
      --accent: #38bdf8;
      --accent-hover: #0ea5e9;
      --status-completed: #10b981;
      --status-running: #3b82f6;
      --status-pending: #f59e0b;
      --status-failed: #ef4444;
      --status-skipped: #64748b;
      --node-subworkflow: #a855f7;
      --node-user: #14b8a6;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background-color: var(--bg-main);
      color: var(--text-main);
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    /* Top Navigation Bar */
    header {
      background: var(--bg-panel);
      border-bottom: 1px solid var(--border-color);
      padding: 10px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      z-index: 20;
      flex-wrap: wrap;
    }

    .header-left {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .workflow-title-row {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .workflow-title {
      font-size: 1.2rem;
      font-weight: 700;
      color: var(--text-main);
    }

    .breadcrumbs {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 0.85rem;
      color: var(--text-muted);
      flex-wrap: wrap;
    }

    .breadcrumb-item {
      cursor: pointer;
      color: var(--accent);
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 6px;
      border-radius: 4px;
      transition: background 0.15s ease;
    }

    .breadcrumb-item:hover {
      background: var(--bg-panel-subtle);
      color: var(--text-main);
    }

    .breadcrumb-item.active {
      color: var(--text-main);
      font-weight: 600;
      cursor: default;
      background: transparent;
    }

    .header-controls {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    .search-input {
      background: var(--bg-main);
      border: 1px solid var(--border-color);
      color: var(--text-main);
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 0.85rem;
      width: 180px;
      outline: none;
      transition: border 0.15s ease, width 0.2s ease;
    }

    .search-input:focus {
      border-color: var(--accent);
      width: 220px;
    }

    .btn {
      background: var(--bg-panel-subtle);
      color: var(--text-main);
      border: 1px solid var(--border-color);
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 0.85rem;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-weight: 500;
      transition: all 0.15s ease;
    }

    .btn:hover {
      background: var(--border-color);
      color: #fff;
    }

    .btn-primary {
      background: #0284c7;
      border-color: var(--accent);
      color: #fff;
    }

    .btn-primary:hover {
      background: var(--accent-hover);
    }

    .badge {
      font-size: 0.72rem;
      padding: 2px 6px;
      border-radius: 9999px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .badge-status-completed { background: #064e3b; color: #6ee7b7; border: 1px solid #059669; }
    .badge-status-running { background: #1e3a8a; color: #93c5fd; border: 1px solid #2563eb; }
    .badge-status-pending { background: #78350f; color: #fcd34d; border: 1px solid #d97706; }
    .badge-status-failed { background: #7f1d1d; color: #fca5a5; border: 1px solid #dc2626; }
    .badge-status-skipped { background: #1e293b; color: #94a3b8; border: 1px solid #475569; }

    .badge-type {
      background: var(--bg-panel-subtle);
      color: var(--accent);
      border: 1px solid var(--border-color);
    }

    /* Main Container Layout */
    .app-main {
      flex: 1;
      display: flex;
      position: relative;
      overflow: hidden;
    }

    #cy-container {
      flex: 1;
      height: 100%;
      background: radial-gradient(circle at center, #1e293b 0%, #0f172a 100%);
      position: relative;
    }

    #cy {
      width: 100%;
      height: 100%;
    }

    /* Canvas floating toolbar */
    .canvas-toolbar {
      position: absolute;
      bottom: 20px;
      left: 20px;
      background: rgba(30, 41, 59, 0.85);
      backdrop-filter: blur(8px);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 6px;
      display: flex;
      gap: 4px;
      z-index: 10;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    }

    /* Inspector Side Drawer (Floating Overlay Drawer) */
    #inspector {
      position: absolute;
      top: 0;
      right: 0;
      bottom: 0;
      width: 440px;
      max-width: 90vw;
      background: var(--bg-panel);
      border-left: 1px solid var(--border-color);
      display: flex;
      flex-direction: column;
      transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1);
      transform: translateX(0);
      z-index: 50;
      box-shadow: -6px 0 24px rgba(0, 0, 0, 0.5);
    }

    #inspector.hidden {
      transform: translateX(100%);
      pointer-events: none;
    }

    .inspector-header {
      padding: 16px 20px;
      border-bottom: 1px solid var(--border-color);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    .inspector-title-wrap {
      display: flex;
      flex-direction: column;
      gap: 4px;
      overflow: hidden;
    }

    .inspector-node-name {
      font-size: 1.1rem;
      font-weight: 700;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .inspector-body {
      flex: 1;
      padding: 20px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    .section-card {
      background: var(--bg-main);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .section-title {
      font-size: 0.8rem;
      text-transform: uppercase;
      font-weight: 700;
      color: var(--text-muted);
      letter-spacing: 0.05em;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .prompt-content {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 0.85rem;
      line-height: 1.5;
      color: #e2e8f0;
      background: #090d16;
      border: 1px solid #1e293b;
      border-radius: 6px;
      padding: 12px;
      white-space: pre-wrap;
      word-break: break-word;
      max-height: 240px;
      overflow-y: auto;
    }

    .output-content {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 0.82rem;
      line-height: 1.45;
      color: #34d399;
      background: #022c22;
      border: 1px solid #065f46;
      border-radius: 6px;
      padding: 10px;
      white-space: pre-wrap;
      word-break: break-word;
      max-height: 180px;
      overflow-y: auto;
    }

    .error-content {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 0.82rem;
      line-height: 1.45;
      color: #f87171;
      background: #450a0a;
      border: 1px solid #991b1b;
      border-radius: 6px;
      padding: 10px;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .iteration-item {
      border-left: 2px solid var(--accent);
      padding-left: 10px;
      margin-top: 8px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .iteration-badge {
      font-size: 0.75rem;
      color: var(--accent);
      font-weight: 600;
    }

    /* Subworkflow Action Button */
    .drilldown-btn {
      width: 100%;
      background: linear-gradient(135deg, #7e22ce, #9333ea);
      color: white;
      border: none;
      padding: 10px;
      border-radius: 6px;
      font-weight: 600;
      font-size: 0.9rem;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      box-shadow: 0 4px 12px rgba(147, 51, 234, 0.3);
      transition: opacity 0.15s ease;
    }

    .drilldown-btn:hover {
      opacity: 0.9;
    }

    /* Notification / Toast */
    #toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: #0284c7;
      color: white;
      padding: 8px 16px;
      border-radius: 6px;
      font-size: 0.85rem;
      font-weight: 500;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.2s ease, transform 0.2s ease;
      transform: translateY(8px);
      z-index: 100;
    }

    #toast.show {
      opacity: 1;
      transform: translateY(0);
    }
  </style>
  <!-- Cytoscape and Layout Engines via CDN -->
  <script src="https://cdnjs.cloudflare.com/ajax/libs/cytoscape/3.30.2/cytoscape.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/dagre/0.8.5/dagre.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/cytoscape-dagre@2.5.0/cytoscape-dagre.min.js"></script>
</head>
<body>

  <header>
    <div class="header-left">
      <div class="workflow-title-row">
        <span class="workflow-title" id="display-title">Workflow Visualizer</span>
        <span id="display-badge" class="badge badge-type">Standalone</span>
      </div>
      <div class="breadcrumbs" id="breadcrumb-bar">
        <!-- Dynamically generated breadcrumbs -->
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
      <button id="layout-toggle-btn" class="btn" title="Toggle Layout Direction (Top-to-Bottom / Left-to-Right)">
        Orientation: <span id="layout-dir-label">TB</span>
      </button>
      <button id="fit-btn" class="btn btn-primary" title="Fit to Viewport">Fit Canvas</button>
    </div>
  </header>

  <div class="app-main">
    <div id="cy-container">
      <div id="cy"></div>
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
          <div style="display: flex; gap: 6px; align-items: center;">
            <span id="insp-type-badge" class="badge badge-type">step</span>
            <span id="insp-status-badge" class="badge badge-status-pending">pending</span>
            <span id="insp-subagent-badge" class="badge badge-type" style="display: none; background: #312e81; color: #a5b4fc; border-color: #4338ca;">⚡ Sub-Agent</span>
          </div>
        </div>
        <button id="close-inspector-btn" class="btn" style="padding: 4px 8px;">✕</button>
      </div>

      <div class="inspector-body">
        <!-- Subworkflow Drill Down Action -->
        <div id="insp-subworkflow-action" style="display: none;">
          <button id="insp-drilldown-btn" class="drilldown-btn">
            📦 Drill Down into Subworkflow
          </button>
        </div>

        <!-- Prompt & Instructions -->
        <div class="section-card">
          <div class="section-title">
            <span>📝 Prompt / Agent Instruction</span>
            <button id="copy-prompt-btn" class="btn" style="padding: 2px 6px; font-size: 0.72rem;">Copy</button>
          </div>
          <div class="prompt-content" id="insp-prompt">No prompt available</div>
        </div>

        <!-- Node Configuration -->
        <div class="section-card" id="insp-config-card">
          <div class="section-title">
            <span>⚙️ Configuration</span>
          </div>
          <div id="insp-config-details" style="font-size: 0.85rem; color: #cbd5e1; display: flex; flex-direction: column; gap: 6px;">
            <!-- Rendered configuration fields -->
          </div>
        </div>

        <!-- Execution State -->
        <div class="section-card" id="insp-execution-card">
          <div class="section-title">
            <span>⚡ Execution Status</span>
            <span id="insp-iter-count" style="color: var(--accent); font-size: 0.75rem;"></span>
          </div>
          
          <div id="insp-error-wrap" style="display: none;">
            <div style="font-size: 0.75rem; color: #f87171; font-weight: 600; margin-bottom: 4px;">Error:</div>
            <div class="error-content" id="insp-error"></div>
          </div>

          <!-- Iteration History Timeline -->
          <div id="insp-history-wrap" style="display: none; margin-top: 10px;">
            <div style="font-size: 0.75rem; color: var(--text-muted); font-weight: 700; text-transform: uppercase;">Past Iteration History</div>
            <div id="insp-history-list" style="display: flex; flex-direction: column; gap: 6px; margin-top: 6px;"></div>
          </div>
        </div>

        <!-- Node Metadata -->
        <div class="section-card">
          <div class="section-title">
            <span>ℹ️ Node Metadata</span>
          </div>
          <div style="font-size: 0.8rem; color: var(--text-muted); display: grid; grid-template-columns: 100px 1fr; gap: 6px;">
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

  <script id="workflow-data" type="application/json">
${serializedData}
  </script>

  <script>
    (function() {
      // Safe HTML escaping for client-side rendering
      function escapeHtml(text) {
        if (text == null) return '';
        return String(text)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#039;');
      }

      // Parse payload
      const rawData = JSON.parse(document.getElementById('workflow-data').textContent);
      const workflows = rawData.workflows;
      const primaryWfId = rawData.primaryWorkflowId;
      const activeExecId = rawData.activeExecutionId;

      // App state
      let currentWorkflowId = primaryWfId;
      let breadcrumbsStack = [primaryWfId]; // Stack of workflow IDs
      let cy = null;
      let layoutDirection = 'TB'; // 'TB' or 'LR'
      let selectedNodeData = null;
      let nodesLocked = true;

      // Status visual helpers
      const STATUS_ICONS = {
        completed: '✅',
        running: '🔄',
        pending: '⏳',
        failed: '❌',
        skipped: '⏭️'
      };

      const STATUS_COLORS = {
        completed: '#10b981',
        running: '#3b82f6',
        pending: '#f59e0b',
        failed: '#ef4444',
        skipped: '#64748b'
      };

      const NODE_SHAPES = {
        start: 'round-rectangle',
        end: 'round-rectangle',
        decision: 'diamond',
        user_interaction: 'hexagon',
        subworkflow: 'round-rectangle',
        step: 'round-rectangle'
      };

      function showToast(msg) {
        const toast = document.getElementById('toast');
        toast.textContent = msg;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 2000);
      }

      function updateBreadcrumbBar() {
        const bar = document.getElementById('breadcrumb-bar');
        bar.innerHTML = '';

        breadcrumbsStack.forEach((wfId, idx) => {
          const wfData = workflows[wfId];
          const isLast = idx === breadcrumbsStack.length - 1;
          const isRoot = idx === 0;

          if (idx > 0) {
            const separator = document.createElement('span');
            separator.textContent = '>';
            bar.appendChild(separator);
          }

          const item = document.createElement('a');
          item.className = 'breadcrumb-item' + (isLast ? ' active' : '');
          item.innerHTML = (isRoot ? '🏠 ' : '📦 ') + (wfData ? wfData.workflow.name : wfId);

          if (!isLast) {
            item.href = '#';
            item.onclick = (e) => {
              e.preventDefault();
              navigateToWorkflowIndex(idx);
            };
          }
          bar.appendChild(item);
        });

        // Update header workflow title
        const curWf = workflows[currentWorkflowId]?.workflow;
        if (curWf) {
          document.getElementById('display-title').textContent = curWf.name;
          const isSub = breadcrumbsStack.length > 1 || curWf.intendedForIndependentRun === false;
          const badge = document.getElementById('display-badge');
          badge.textContent = isSub ? 'Sub-workflow' : 'Standalone';
          badge.style.borderColor = isSub ? '#a855f7' : '#38bdf8';
          badge.style.color = isSub ? '#c084fc' : '#38bdf8';
        }
      }

      function navigateToWorkflowIndex(stackIndex) {
        breadcrumbsStack = breadcrumbsStack.slice(0, stackIndex + 1);
        currentWorkflowId = breadcrumbsStack[breadcrumbsStack.length - 1];
        closeInspector();
        renderCurrentWorkflow();
      }

      function drillDownIntoSubworkflow(childWorkflowId) {
        if (!workflows[childWorkflowId]) {
          showToast('Child subworkflow "' + childWorkflowId + '" not bundled in export.');
          return;
        }
        breadcrumbsStack.push(childWorkflowId);
        currentWorkflowId = childWorkflowId;
        closeInspector();
        renderCurrentWorkflow();
      }

      function closeInspector() {
        const inspector = document.getElementById('inspector');
        if (inspector) {
          inspector.classList.add('hidden');
        }
        if (cy) {
          cy.nodes().removeClass('selected-node');
        }
        selectedNodeData = null;
      }

      function openInspector(nodeData) {
        if (!nodeData) return;
        selectedNodeData = nodeData;
        const inspector = document.getElementById('inspector');
        if (!inspector) return;
        inspector.classList.remove('hidden');

        // Populate fields
        const nameEl = document.getElementById('insp-name');
        if (nameEl) nameEl.textContent = nodeData.name || 'Unnamed Node';
        
        const typeBadge = document.getElementById('insp-type-badge');
        if (typeBadge) typeBadge.textContent = nodeData.type || 'step';

        const statusBadge = document.getElementById('insp-status-badge');
        if (statusBadge) {
          const st = nodeData.status || 'pending';
          statusBadge.textContent = (STATUS_ICONS[st] || '') + ' ' + st;
          statusBadge.className = 'badge badge-status-' + st;
        }

        const subagentBadge = document.getElementById('insp-subagent-badge');
        if (subagentBadge) {
          subagentBadge.style.display = nodeData.runInSubAgent ? 'inline-block' : 'none';
        }

        // Prompt
        const promptEl = document.getElementById('insp-prompt');
        if (promptEl) {
          promptEl.textContent = nodeData.description || '(No prompt or description specified)';
        }

        // Subworkflow Action
        const subActionWrap = document.getElementById('insp-subworkflow-action');
        if (subActionWrap) {
          if (nodeData.type === 'subworkflow' && nodeData.config && nodeData.config.childWorkflowId) {
            subActionWrap.style.display = 'block';
            const drillBtn = document.getElementById('insp-drilldown-btn');
            if (drillBtn) {
              drillBtn.onclick = () => drillDownIntoSubworkflow(nodeData.config.childWorkflowId);
            }
          } else {
            subActionWrap.style.display = 'none';
          }
        }

        // Configuration
        const configWrap = document.getElementById('insp-config-details');
        if (configWrap) {
          configWrap.innerHTML = '';
          const cfg = nodeData.config || {};
          let hasConfig = false;

          if (nodeData.type === 'decision' && cfg.options) {
            hasConfig = true;
            const optDiv = document.createElement('div');
            const opts = Array.isArray(cfg.options) ? cfg.options.join(', ') : JSON.stringify(cfg.options);
            optDiv.innerHTML = '<strong>Decision Options:</strong> <code>' + escapeHtml(opts) + '</code>';
            configWrap.appendChild(optDiv);
          }

          if (nodeData.type === 'user_interaction') {
            hasConfig = true;
            if (cfg.prompt) {
              const p = document.createElement('div');
              p.innerHTML = '<strong>User Prompt:</strong> ' + escapeHtml(cfg.prompt);
              configWrap.appendChild(p);
            }
            if (cfg.options) {
              const optDiv = document.createElement('div');
              const opts = Array.isArray(cfg.options) ? cfg.options.join(', ') : JSON.stringify(cfg.options);
              optDiv.innerHTML = '<strong>Branch Options:</strong> <code>' + escapeHtml(opts) + '</code>';
              configWrap.appendChild(optDiv);
            }
            if (cfg.allowFreeText) {
              const ft = document.createElement('div');
              ft.innerHTML = '<strong>Free-text:</strong> Allowed';
              configWrap.appendChild(ft);
            }
          }

          if (cfg.maxIterations) {
            hasConfig = true;
            const iterDiv = document.createElement('div');
            iterDiv.innerHTML = '<strong>Max Loop Iterations:</strong> ' + cfg.maxIterations;
            configWrap.appendChild(iterDiv);
          }

          if (!hasConfig) {
            configWrap.innerHTML = '<span style="color: var(--text-muted);">None</span>';
          }
        }

        // Execution & Iteration History
        const iterCountEl = document.getElementById('insp-iter-count');
        if (iterCountEl) {
          iterCountEl.textContent = nodeData.iteration && nodeData.iteration > 1 ? '(Iteration ' + nodeData.iteration + ')' : '';
        }

        const errWrap = document.getElementById('insp-error-wrap');
        const errEl = document.getElementById('insp-error');
        if (errWrap && errEl) {
          if (nodeData.error) {
            errWrap.style.display = 'block';
            errEl.textContent = nodeData.error;
          } else {
            errWrap.style.display = 'none';
          }
        }

        const histWrap = document.getElementById('insp-history-wrap');
        const histList = document.getElementById('insp-history-list');
        if (histWrap && histList) {
          histList.innerHTML = '';
          if (Array.isArray(nodeData.iterationHistory) && nodeData.iterationHistory.length > 0) {
            histWrap.style.display = 'block';
            nodeData.iterationHistory.forEach(rec => {
              const div = document.createElement('div');
              div.className = 'iteration-item';
              const timeStr = rec.completedAt ? ' (' + rec.completedAt.slice(11, 19) + ')' : '';
              const errHtml = rec.error ? '<div class="error-content" style="padding: 4px 8px; font-size: 0.75rem;">' + escapeHtml(rec.error) + '</div>' : '';
              div.innerHTML = '<span class="iteration-badge">Iteration ' + rec.iteration + timeStr + '</span>' + errHtml;
              histList.appendChild(div);
            });
          } else {
            histWrap.style.display = 'none';
          }
        }

        // Metadata
        const nodeIdEl = document.getElementById('insp-node-id');
        if (nodeIdEl) nodeIdEl.textContent = nodeData.id || '-';
        
        const wfIdEl = document.getElementById('insp-wf-id');
        if (wfIdEl) wfIdEl.textContent = nodeData.workflowId || '-';

        const updatedEl = document.getElementById('insp-updated-at');
        if (updatedEl) {
          updatedEl.textContent = nodeData.updatedAt ? new Date(nodeData.updatedAt).toLocaleString() : '-';
        }
      }

      function buildCytoscapeElements(wfData) {
        const elements = [];
        const nodes = wfData.nodes || [];
        const edges = wfData.edges || [];

        nodes.forEach(n => {
          const icon = STATUS_ICONS[n.status] || '⏳';
          const iterSuffix = n.iteration && n.iteration > 1 ? ' (i:' + n.iteration + ')' : '';
          const subBadge = n.type === 'subworkflow' ? ' 📦' : n.type === 'user_interaction' ? ' 👤' : '';
          const displayLabel = icon + ' ' + n.name + subBadge + iterSuffix;

          elements.push({
            group: 'nodes',
            grabbable: !nodesLocked,
            data: {
              id: n.id,
              label: displayLabel,
              nodeType: n.type,
              status: n.status,
              rawNode: n
            }
          });
        });

        edges.forEach(e => {
          elements.push({
            group: 'edges',
            data: {
              id: e.id,
              source: e.fromNodeId,
              target: e.toNodeId,
              label: e.condition || ''
            }
          });
        });

        return elements;
      }

      function renderCurrentWorkflow() {
        updateBreadcrumbBar();
        const wfData = workflows[currentWorkflowId];
        if (!wfData) return;

        const elements = buildCytoscapeElements(wfData);

        if (cy) {
          cy.destroy();
        }

        function applyLockState(cyInstance) {
          const inst = cyInstance || cy;
          if (!inst) return;
          if (nodesLocked) {
            inst.nodes().lock();
            inst.nodes().ungrabify();
            inst.autolock(true);
            inst.autoungrabify(true);
          } else {
            inst.nodes().unlock();
            inst.nodes().grabify();
            inst.autolock(false);
            inst.autoungrabify(false);
          }
        }

        cy = cytoscape({
          container: document.getElementById('cy'),
          elements: elements,
          boxSelectionEnabled: false,
          autoungrabify: true,
          userPanningEnabled: true,
          userZoomingEnabled: true,
          style: [
            {
              selector: 'node',
              style: {
                'label': 'data(label)',
                'color': '#f8fafc',
                'font-size': '12px',
                'font-weight': '600',
                'text-valign': 'center',
                'text-halign': 'center',
                'text-wrap': 'ellipsis',
                'text-max-width': '160px',
                'background-color': '#1e293b',
                'border-width': 2,
                'border-color': function(ele) {
                  const s = ele.data('status');
                  return STATUS_COLORS[s] || '#475569';
                },
                'width': 180,
                'height': 50,
                'shape': function(ele) {
                  return NODE_SHAPES[ele.data('nodeType')] || 'round-rectangle';
                },
                'shadow-blur': 12,
                'shadow-color': 'rgba(0, 0, 0, 0.4)',
                'shadow-opacity': 0.8
              }
            },
            {
              selector: 'node[nodeType = "subworkflow"]',
              style: {
                'border-style': 'dashed',
                'border-width': 3,
                'border-color': '#a855f7',
                'background-color': '#2e1065'
              }
            },
            {
              selector: 'node[nodeType = "user_interaction"]',
              style: {
                'border-color': '#14b8a6',
                'background-color': '#134e4a'
              }
            },
            {
              selector: 'node[nodeType = "decision"]',
              style: {
                'width': 120,
                'height': 120,
                'text-max-width': '100px',
                'background-color': '#2d2305'
              }
            },
            {
              selector: 'node.selected-node',
              style: {
                'border-color': '#38bdf8',
                'border-width': 4,
                'shadow-color': '#38bdf8',
                'shadow-blur': 20
              }
            },
            {
              selector: 'node.highlight-path',
              style: {
                'border-color': '#38bdf8'
              }
            },
            {
              selector: 'node.dimmed',
              style: {
                'opacity': 0.25
              }
            },
            {
              selector: 'edge',
              style: {
                'width': 2,
                'line-color': '#64748b',
                'target-arrow-color': '#64748b',
                'target-arrow-shape': 'triangle',
                'curve-style': 'bezier',
                'label': 'data(label)',
                'font-size': '11px',
                'color': '#38bdf8',
                'text-background-color': '#0f172a',
                'text-background-opacity': 0.85,
                'text-background-padding': '3px',
                'text-background-shape': 'roundrectangle',
                'text-rotation': 'autorotate'
              }
            },
            {
              selector: 'edge.highlight-path',
              style: {
                'line-color': '#38bdf8',
                'target-arrow-color': '#38bdf8',
                'width': 3
              }
            },
            {
              selector: 'edge.dimmed',
              style: {
                'opacity': 0.15
              }
            }
          ],
          layout: {
            name: 'dagre',
            rankDir: layoutDirection,
            nodeSep: 60,
            rankSep: 80,
            padding: 40,
            stop: function(e) {
              const inst = (e && e.cy) || (this && this.cy) || cy;
              applyLockState(inst);
            }
          }
        });

        // Ensure lock state is applied immediately upon creation & layout completion
        applyLockState(cy);
        cy.on('layoutstop', function(e) {
          applyLockState(e?.cy || cy);
        });

        // Prevent any dragging when locked
        cy.on('grab drag', 'node', function(evt) {
          if (nodesLocked) {
            evt.target.lock();
            evt.target.ungrabify();
          }
        });

        function handleNodeSelect(node) {
          if (!node) return;
          cy.nodes().removeClass('selected-node');
          node.addClass('selected-node');
          const raw = node.data('rawNode');
          if (raw) {
            openInspector(raw);
          }
        }

        // Click / tap / select handler on nodes
        let lastTapTime = 0;
        let lastTapNodeId = null;

        cy.on('tap', 'node', function(evt) {
          const node = evt.target;
          const raw = node.data('rawNode');
          const now = Date.now();

          handleNodeSelect(node);

          if (raw && raw.type === 'subworkflow' && raw.config?.childWorkflowId) {
            if (lastTapNodeId === node.id() && (now - lastTapTime) < 350) {
              drillDownIntoSubworkflow(raw.config.childWorkflowId);
            }
          }
          lastTapTime = now;
          lastTapNodeId = node.id();
        });

        cy.on('select', 'node', function(evt) {
          handleNodeSelect(evt.target);
        });

        // Click background to close inspector
        cy.on('tap', function(evt) {
          if (evt.target === cy) {
            closeInspector();
          }
        });

        // Hover highlighting and cursor style
        cy.on('mouseover', 'node', function(evt) {
          document.getElementById('cy').style.cursor = 'pointer';
          const node = evt.target;
          const connectedEdges = node.connectedEdges();
          const connectedNodes = connectedEdges.connectedNodes();
          cy.elements().addClass('dimmed');
          node.removeClass('dimmed').addClass('highlight-path');
          connectedNodes.removeClass('dimmed').addClass('highlight-path');
          connectedEdges.removeClass('dimmed').addClass('highlight-path');
          if (selectedNodeData) {
            cy.$id(selectedNodeData.id).removeClass('dimmed').addClass('selected-node');
          }
        });

        cy.on('mouseout', 'node', function() {
          document.getElementById('cy').style.cursor = 'default';
          cy.elements().removeClass('dimmed highlight-path');
          if (selectedNodeData) {
            cy.$id(selectedNodeData.id).addClass('selected-node');
          }
        });
      }

      // Event Listeners
      document.getElementById('fit-btn').onclick = () => { if (cy) cy.fit(undefined, 40); };
      document.getElementById('zoom-in-btn').onclick = () => { if (cy) cy.zoom(cy.zoom() * 1.25); };
      document.getElementById('zoom-out-btn').onclick = () => { if (cy) cy.zoom(cy.zoom() * 0.8); };
      document.getElementById('reset-zoom-btn').onclick = () => { if (cy) { cy.zoom(1); cy.center(); } };

      document.getElementById('lock-toggle-btn').onclick = () => {
        nodesLocked = !nodesLocked;
        if (cy) {
          if (nodesLocked) {
            cy.nodes().lock();
            cy.nodes().ungrabify();
            cy.autolock(true);
            cy.autoungrabify(true);
          } else {
            cy.nodes().unlock();
            cy.nodes().grabify();
            cy.autolock(false);
            cy.autoungrabify(false);
          }
        }
        const btn = document.getElementById('lock-toggle-btn');
        btn.textContent = nodesLocked ? '🔒 Locked' : '🔓 Drag';
        showToast(nodesLocked ? 'Node positions locked' : 'Free node dragging enabled');
      };

      document.getElementById('close-inspector-btn').onclick = closeInspector;

      document.getElementById('copy-prompt-btn').onclick = () => {
        if (selectedNodeData && selectedNodeData.description) {
          navigator.clipboard.writeText(selectedNodeData.description).then(() => {
            showToast('Prompt copied to clipboard!');
          });
        }
      };

      // Layout Toggle
      document.getElementById('layout-toggle-btn').onclick = () => {
        layoutDirection = layoutDirection === 'TB' ? 'LR' : 'TB';
        document.getElementById('layout-dir-label').textContent = layoutDirection;
        if (cy) {
          cy.nodes().unlock();
          cy.autolock(false);
          cy.layout({
            name: 'dagre',
            rankDir: layoutDirection,
            nodeSep: 60,
            rankSep: 80,
            padding: 40,
            stop: function(e) {
              const inst = (e && e.cy) || (this && this.cy) || cy;
              if (nodesLocked && inst) {
                inst.nodes().lock();
                inst.nodes().ungrabify();
                inst.autolock(true);
                inst.autoungrabify(true);
              }
            }
          }).run();
        }
      };

      // Status Filter
      document.getElementById('status-filter').onchange = (e) => {
        const filterVal = e.target.value;
        if (!cy) return;
        if (filterVal === 'all') {
          cy.nodes().style('display', 'element');
          cy.edges().style('display', 'element');
        } else {
          cy.nodes().forEach(n => {
            if (n.data('status') === filterVal) {
              n.style('display', 'element');
            } else {
              n.style('display', 'none');
            }
          });
          cy.edges().forEach(e => {
            const src = e.source();
            const tgt = e.target();
            if (src.style('display') === 'element' && tgt.style('display') === 'element') {
              e.style('display', 'element');
            } else {
              e.style('display', 'none');
            }
          });
        }
      };

      // Search Filter
      document.getElementById('node-search').oninput = (e) => {
        const term = e.target.value.toLowerCase().trim();
        if (!cy) return;
        if (!term) {
          cy.nodes().removeClass('selected-node dimmed');
          return;
        }

        cy.nodes().forEach(n => {
          const raw = n.data('rawNode');
          const matchesName = raw.name.toLowerCase().includes(term);
          const matchesPrompt = (raw.description || '').toLowerCase().includes(term);
          if (matchesName || matchesPrompt) {
            n.removeClass('dimmed').addClass('selected-node');
          } else {
            n.addClass('dimmed').removeClass('selected-node');
          }
        });
      };

      // Initial Render
      renderCurrentWorkflow();
    })();
  </script>
</body>
</html>
`;
}
