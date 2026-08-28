/**
 * Server-Side Rendered & Interactive Single-Page Web Application for Task Kanban Board.
 * Built using standard Web APIs, HTML5, CSS3, and modern Vanilla JavaScript.
 */

import { escapeHtml } from "./common.ts";

export interface TaskUiOptions {
  origin: string;
  userId?: string;
  userName?: string;
}

export function renderTaskKanbanHtml(options: TaskUiOptions): string {
  const origin = options.origin.replace(/\/+$/, "");
  const userName = escapeHtml(options.userName || options.userId || "Guest");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Tasks Kanban Board — Workflow MCP</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #0b0f17;
      --bg-card: #131b2e;
      --bg-card-hover: #1c2742;
      --bg-column: #0f1626;
      --border: #1e293b;
      --border-focus: #3b82f6;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --text-dim: #64748b;
      --primary: #3b82f6;
      --primary-hover: #2563eb;
      --success: #10b981;
      --success-bg: rgba(16, 185, 129, 0.15);
      --warning: #f59e0b;
      --warning-bg: rgba(245, 158, 11, 0.15);
      --danger: #ef4444;
      --danger-bg: rgba(239, 68, 68, 0.15);
      --purple: #a855f7;
      --purple-bg: rgba(168, 85, 247, 0.15);
      --cyan: #06b6d4;
      --cyan-bg: rgba(6, 182, 212, 0.15);
      --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      --font-mono: 'JetBrains Mono', ui-monospace, Menlo, Monaco, Consolas, monospace;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--font-sans);
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      overflow-x: hidden;
    }

    /* Header */
    header {
      background: #0f172a;
      border-bottom: 1px solid var(--border);
      padding: 12px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      position: sticky;
      top: 0;
      z-index: 40;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
      text-decoration: none;
      color: var(--text);
    }
    .brand-logo {
      font-size: 1.5rem;
      background: linear-gradient(135deg, #3b82f6, #8b5cf6);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      font-weight: 800;
    }
    .brand-title {
      font-size: 1.1rem;
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    .header-nav {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .nav-link {
      color: var(--text-muted);
      text-decoration: none;
      font-size: 0.85rem;
      font-weight: 500;
      padding: 6px 12px;
      border-radius: 6px;
      transition: all 0.15s;
    }
    .nav-link:hover {
      color: var(--text);
      background: rgba(255, 255, 255, 0.05);
    }
    .nav-link.active {
      color: #60a5fa;
      background: rgba(59, 130, 246, 0.12);
    }

    /* Buttons */
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      background: var(--primary);
      color: white;
      border: 1px solid transparent;
      padding: 7px 14px;
      border-radius: 6px;
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s;
      text-decoration: none;
      font-family: inherit;
    }
    .btn:hover { background: var(--primary-hover); }
    .btn-secondary {
      background: #1e293b;
      color: var(--text);
      border-color: #334155;
    }
    .btn-secondary:hover {
      background: #334155;
    }
    .btn-success {
      background: var(--success);
      color: #022c22;
    }
    .btn-success:hover { background: #059669; }
    .btn-danger {
      background: var(--danger-bg);
      color: #f87171;
      border-color: rgba(239, 68, 68, 0.3);
    }
    .btn-danger:hover {
      background: #ef4444;
      color: white;
    }
    .btn-sm {
      padding: 4px 8px;
      font-size: 0.75rem;
      border-radius: 4px;
    }

    /* Metrics & Controls Bar */
    .controls-bar {
      padding: 16px 24px 8px 24px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      background: #090d16;
      border-bottom: 1px solid var(--border);
    }
    .metrics-row {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }
    .metric-pill {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 6px 14px;
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 0.82rem;
    }
    .metric-num {
      font-weight: 700;
      font-family: var(--font-mono);
      font-size: 0.95rem;
    }
    .filters-row {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }
    .search-input {
      flex: 1;
      min-width: 220px;
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 7px 12px;
      color: var(--text);
      font-size: 0.85rem;
      outline: none;
    }
    .search-input:focus {
      border-color: var(--border-focus);
      box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
    }
    .filter-select {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 7px 12px;
      color: var(--text);
      font-size: 0.85rem;
      outline: none;
      cursor: pointer;
    }
    .filter-select:focus { border-color: var(--border-focus); }
    .toggle-label {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 0.82rem;
      color: var(--text-muted);
      cursor: pointer;
      user-select: none;
      padding: 6px 10px;
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 6px;
    }
    .toggle-label input { cursor: pointer; }

    /* Kanban Board Layout */
    .kanban-board {
      flex: 1;
      display: flex;
      gap: 16px;
      padding: 20px 24px;
      overflow-x: auto;
      align-items: flex-start;
    }
    .kanban-column {
      flex: 0 0 320px;
      width: 320px;
      background: var(--bg-column);
      border: 1px solid var(--border);
      border-radius: 10px;
      display: flex;
      flex-direction: column;
      max-height: calc(100vh - 170px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
    }
    .column-header {
      padding: 12px 14px;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: rgba(255, 255, 255, 0.02);
      border-top-left-radius: 10px;
      border-top-right-radius: 10px;
    }
    .column-title-group {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .column-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
    }
    .column-title {
      font-size: 0.88rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .column-count {
      font-family: var(--font-mono);
      font-size: 0.75rem;
      font-weight: 600;
      background: #1e293b;
      padding: 2px 8px;
      border-radius: 999px;
      color: var(--text-muted);
    }
    .column-cards {
      flex: 1;
      padding: 12px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 10px;
      min-height: 120px;
      transition: background 0.15s;
    }
    .column-cards.drag-over {
      background: rgba(59, 130, 246, 0.08);
      border: 2px dashed #3b82f6;
      border-radius: 0 0 10px 10px;
    }

    /* Kanban Card */
    .task-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px;
      cursor: pointer;
      transition: all 0.15s;
      user-select: none;
      display: flex;
      flex-direction: column;
      gap: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .task-card:hover {
      background: var(--bg-card-hover);
      border-color: #334155;
      transform: translateY(-1px);
      box-shadow: 0 4px 8px rgba(0,0,0,0.2);
    }
    .task-card.dragging {
      opacity: 0.4;
      transform: scale(0.98);
    }
    .card-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
    }
    .task-id {
      font-family: var(--font-mono);
      font-size: 0.72rem;
      color: #94a3b8;
      font-weight: 600;
    }
    .badges-row {
      display: flex;
      align-items: center;
      gap: 4px;
      flex-wrap: wrap;
    }
    .badge {
      font-size: 0.68rem;
      font-weight: 600;
      padding: 2px 6px;
      border-radius: 4px;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }
    .badge-epic { background: var(--purple-bg); color: var(--purple); }
    .badge-task { background: var(--cyan-bg); color: var(--cyan); }
    .badge-subtask { background: rgba(148, 163, 184, 0.15); color: #cbd5e1; }
    .badge-bug { background: var(--danger-bg); color: #f87171; }
    
    .priority-critical { background: #ef4444; color: white; }
    .priority-high { background: #f97316; color: white; }
    .priority-medium { background: #3b82f6; color: white; }
    .priority-low { background: #64748b; color: white; }

    .card-title {
      font-size: 0.9rem;
      font-weight: 600;
      color: var(--text);
      line-height: 1.35;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .card-desc {
      font-size: 0.78rem;
      color: var(--text-muted);
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      line-height: 1.35;
    }
    .card-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding-top: 6px;
      border-top: 1px solid rgba(255, 255, 255, 0.05);
      font-size: 0.75rem;
      color: var(--text-dim);
    }
    .card-assignee {
      display: flex;
      align-items: center;
      gap: 4px;
      color: #93c5fd;
      font-weight: 500;
    }
    .card-meta-icons {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .comment-count-chip {
      display: flex;
      align-items: center;
      gap: 3px;
      color: var(--text-muted);
    }

    /* Modal Dialog */
    .modal-backdrop {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.75);
      backdrop-filter: blur(4px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 100;
      padding: 20px;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.15s;
    }
    .modal-backdrop.open {
      opacity: 1;
      pointer-events: auto;
    }
    .modal {
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 12px;
      width: 100%;
      max-width: 860px;
      max-height: 90vh;
      display: flex;
      flex-direction: column;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.6);
      transform: scale(0.97);
      transition: transform 0.15s;
    }
    .modal-backdrop.open .modal { transform: scale(1); }
    .modal-header {
      padding: 16px 20px;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .modal-body {
      padding: 20px;
      overflow-y: auto;
      display: grid;
      grid-template-columns: 1fr 280px;
      gap: 20px;
    }
    @media (max-width: 768px) {
      .modal-body { grid-template-columns: 1fr; }
      .kanban-column { flex: 0 0 280px; width: 280px; }
    }
    .modal-footer {
      padding: 14px 20px;
      border-top: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: #090d16;
      border-bottom-left-radius: 12px;
      border-bottom-right-radius: 12px;
    }

    .form-group {
      margin-bottom: 14px;
    }
    .form-group label {
      display: block;
      font-size: 0.78rem;
      font-weight: 600;
      color: var(--text-muted);
      margin-bottom: 4px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .form-control {
      width: 100%;
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 6px;
      padding: 8px 12px;
      color: var(--text);
      font-size: 0.88rem;
      font-family: inherit;
      outline: none;
    }
    .form-control:focus {
      border-color: var(--border-focus);
      box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
    }
    textarea.form-control {
      min-height: 80px;
      resize: vertical;
    }

    /* Comment Stream */
    .comments-section {
      margin-top: 20px;
      border-top: 1px solid var(--border);
      padding-top: 16px;
    }
    .comments-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
    }
    .comments-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-bottom: 16px;
      max-height: 240px;
      overflow-y: auto;
      padding-right: 4px;
    }
    .comment-bubble {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 8px;
      padding: 10px 12px;
      font-size: 0.85rem;
    }
    .comment-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 4px;
      font-size: 0.72rem;
      color: var(--text-muted);
    }
    .comment-author {
      font-weight: 600;
      color: #60a5fa;
    }
    .comment-body {
      color: var(--text);
      word-break: break-word;
      line-height: 1.4;
    }
    .comment-composer {
      display: flex;
      flex-direction: column;
      gap: 6px;
      background: #090d16;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 10px;
    }
    .composer-meta {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 0.75rem;
      color: var(--text-dim);
    }
    .char-counter {
      font-family: var(--font-mono);
      font-weight: 600;
    }
    .char-counter.warning { color: #f59e0b; }
    .char-counter.danger { color: #ef4444; }

    /* Toast */
    .toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: #1e293b;
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px 18px;
      box-shadow: 0 10px 25px rgba(0,0,0,0.4);
      font-size: 0.85rem;
      font-weight: 500;
      z-index: 200;
      display: flex;
      align-items: center;
      gap: 8px;
      transform: translateY(100px);
      opacity: 0;
      transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .toast.show {
      transform: translateY(0);
      opacity: 1;
    }
    .toast.toast-error {
      border-color: rgba(239, 68, 68, 0.5);
      background: #2a1215;
      color: #fca5a5;
    }
    .toast.toast-success {
      border-color: rgba(16, 185, 129, 0.5);
      background: #06281e;
      color: #6ee7b7;
    }

    .empty-state {
      padding: 30px 10px;
      text-align: center;
      color: var(--text-dim);
      font-size: 0.82rem;
      border: 1px dashed var(--border);
      border-radius: 8px;
    }
  </style>
</head>
<body>
  <!-- Header -->
  <header>
    <a href="/" class="brand">
      <span class="brand-logo">⚡</span>
      <span class="brand-title">Tasks Board</span>
    </a>
    <div class="header-nav">
      <a href="/tasks" class="nav-link active">📋 Tasks</a>
      <a href="/visualize" class="nav-link">📊 Workflows</a>
      <a href="/" class="nav-link">⚙️ Dashboard</a>
      <button class="btn" onclick="openNewTaskModal()">
        <span>➕</span> New Task
      </button>
    </div>
  </header>

  <!-- Controls & Metrics -->
  <div class="controls-bar">
    <div class="metrics-row">
      <div class="metric-pill">
        <span>Total:</span>
        <span class="metric-num" id="statTotal">0</span>
      </div>
      <div class="metric-pill">
        <span style="color: #10b981;">⚡ Ready (Frontier):</span>
        <span class="metric-num" id="statReady" style="color: #10b981;">0</span>
      </div>
      <div class="metric-pill">
        <span style="color: #3b82f6;">🏃 In Progress:</span>
        <span class="metric-num" id="statInProgress" style="color: #3b82f6;">0</span>
      </div>
      <div class="metric-pill">
        <span style="color: #ef4444;">🛑 Blocked:</span>
        <span class="metric-num" id="statBlocked" style="color: #ef4444;">0</span>
      </div>
      <!-- Closed metric removed to reduce read overhead -->
    </div>

    <div class="filters-row">
      <input type="text" id="searchInput" class="search-input" placeholder="🔍 Search tasks by title, ID, assignee, or role..." oninput="applyFilters()" />
      
      <select id="roleFilter" class="filter-select" onchange="applyFilters()">
        <option value="">All Roles</option>
      </select>

      <select id="priorityFilter" class="filter-select" onchange="applyFilters()">
        <option value="">All Priorities</option>
        <option value="critical">Critical</option>
        <option value="high">High</option>
        <option value="medium">Medium</option>
        <option value="low">Low</option>
      </select>

      <select id="typeFilter" class="filter-select" onchange="applyFilters()">
        <option value="">All Types</option>
        <option value="task">Task</option>
        <option value="epic">Epic</option>
        <option value="subtask">Subtask</option>
        <option value="bug">Bug</option>
      </select>

      <label class="toggle-label">
        <input type="checkbox" id="readyOnlyToggle" onchange="applyFilters()" />
        <span>⚡ Ready Only</span>
      </label>

      <button class="btn btn-secondary btn-sm" onclick="loadTasks(true)">
        <span>🔄</span> Refresh
      </button>
    </div>
  </div>

  <!-- Kanban Board Columns -->
  <main class="kanban-board" id="kanbanBoard">
    <!-- Open / Backlog -->
    <div class="kanban-column" data-status="open">
      <div class="column-header">
        <div class="column-title-group">
          <div class="column-dot" style="background: #94a3b8;"></div>
          <span class="column-title">Open / Backlog</span>
        </div>
        <span class="column-count" id="count-open">0</span>
      </div>
      <div class="column-cards" id="lane-open" ondragover="handleDragOver(event)" ondragleave="handleDragLeave(event)" ondrop="handleDrop(event, 'open')"></div>
    </div>

    <!-- Claimed -->
    <div class="kanban-column" data-status="claimed">
      <div class="column-header">
        <div class="column-title-group">
          <div class="column-dot" style="background: #06b6d4;"></div>
          <span class="column-title">Claimed</span>
        </div>
        <span class="column-count" id="count-claimed">0</span>
      </div>
      <div class="column-cards" id="lane-claimed" ondragover="handleDragOver(event)" ondragleave="handleDragLeave(event)" ondrop="handleDrop(event, 'claimed')"></div>
    </div>

    <!-- In Progress -->
    <div class="kanban-column" data-status="in_progress">
      <div class="column-header">
        <div class="column-title-group">
          <div class="column-dot" style="background: #3b82f6;"></div>
          <span class="column-title">In Progress</span>
        </div>
        <span class="column-count" id="count-in_progress">0</span>
      </div>
      <div class="column-cards" id="lane-in_progress" ondragover="handleDragOver(event)" ondragleave="handleDragLeave(event)" ondrop="handleDrop(event, 'in_progress')"></div>
    </div>

    <!-- Blocked -->
    <div class="kanban-column" data-status="blocked">
      <div class="column-header">
        <div class="column-title-group">
          <div class="column-dot" style="background: #ef4444;"></div>
          <span class="column-title">Blocked</span>
        </div>
        <span class="column-count" id="count-blocked">0</span>
      </div>
      <div class="column-cards" id="lane-blocked" ondragover="handleDragOver(event)" ondragleave="handleDragLeave(event)" ondrop="handleDrop(event, 'blocked')"></div>
    </div>

    <!-- Review -->
    <div class="kanban-column" data-status="review">
      <div class="column-header">
        <div class="column-title-group">
          <div class="column-dot" style="background: #a855f7;"></div>
          <span class="column-title">Review</span>
        </div>
        <span class="column-count" id="count-review">0</span>
      </div>
      <div class="column-cards" id="lane-review" ondragover="handleDragOver(event)" ondragleave="handleDragLeave(event)" ondrop="handleDrop(event, 'review')"></div>
    </div>

    <!-- Closed -->
    <div class="kanban-column" data-status="closed">
      <div class="column-header">
        <div class="column-title-group">
          <div class="column-dot" style="background: #10b981;"></div>
          <span class="column-title">Closed</span>
        </div>
        <span class="column-count" id="count-closed">0</span>
      </div>
      <div class="column-cards" id="lane-closed" ondragover="handleDragOver(event)" ondragleave="handleDragLeave(event)" ondrop="handleDrop(event, 'closed')"></div>
    </div>
  </main>

  <!-- Task Detail Modal -->
  <div class="modal-backdrop" id="taskDetailModal" onclick="if(event.target===this) closeModal()">
    <div class="modal">
      <div class="modal-header">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span id="detailTaskId" class="task-id" style="font-size: 0.9rem;">tk-000000</span>
          <span id="detailTypeBadge" class="badge badge-task">TASK</span>
        </div>
        <button class="btn btn-secondary btn-sm" onclick="closeModal()">✕</button>
      </div>

      <div class="modal-body">
        <!-- Main Form Area -->
        <div>
          <div class="form-group">
            <label>Task Title</label>
            <input type="text" id="detailTitle" class="form-control" style="font-size: 1rem; font-weight: 600;" />
          </div>

          <div class="form-group">
            <label>Description</label>
            <textarea id="detailDescription" class="form-control" rows="3" placeholder="Task description and goals..."></textarea>
          </div>

          <div class="form-group">
            <label>Working Context & Notes</label>
            <textarea id="detailContext" class="form-control" rows="2" placeholder="Accumulated working notes, progress..."></textarea>
          </div>

          <div id="detailDependenciesContainer" style="margin-top: 14px; font-size: 0.82rem;">
            <!-- Dependencies will be populated here -->
          </div>

          <!-- Comment Log Section -->
          <div class="comments-section">
            <div class="comments-header">
              <span style="font-weight: 600; font-size: 0.9rem;">💬 Comments (<span id="commentCount">0</span>)</span>
              <span style="font-size: 0.72rem; color: var(--text-dim);">Max 256 chars per comment</span>
            </div>

            <div class="comments-list" id="commentsList">
              <div class="empty-state">No comments yet.</div>
            </div>

            <div class="comment-composer">
              <div style="display: flex; gap: 8px; margin-bottom: 4px;">
                <input type="text" id="commentAuthor" class="form-control" style="width: 140px; padding: 4px 8px; font-size: 0.78rem;" placeholder="Author name" value="${userName}" />
              </div>
              <textarea id="commentInput" class="form-control" maxlength="256" placeholder="Write a short and sweet note (max 256 chars)..." rows="2" oninput="updateCharCounter()"></textarea>
              <div class="composer-meta">
                <span id="commentCharCount" class="char-counter">0 / 256</span>
                <button class="btn btn-sm" onclick="postComment()">Post Comment</button>
              </div>
            </div>
          </div>
        </div>

        <!-- Sidebar Metadata Area -->
        <div style="background: #090d16; border: 1px solid var(--border); border-radius: 8px; padding: 14px; display: flex; flex-direction: column; gap: 12px;">
          <div class="form-group">
            <label>Status</label>
            <select id="detailStatus" class="form-control">
              <option value="open">Open / Backlog</option>
              <option value="claimed">Claimed</option>
              <option value="in_progress">In Progress</option>
              <option value="blocked">Blocked</option>
              <option value="review">Review</option>
              <option value="closed">Closed</option>
              <option value="wontfix">Wontfix</option>
            </select>
          </div>

          <div class="form-group">
            <label>Priority</label>
            <select id="detailPriority" class="form-control">
              <option value="critical">🔴 Critical</option>
              <option value="high">🟠 High</option>
              <option value="medium">🔵 Medium</option>
              <option value="low">⚪ Low</option>
            </select>
          </div>

          <div class="form-group">
            <label>Item Type</label>
            <select id="detailType" class="form-control">
              <option value="task">Task</option>
              <option value="epic">Epic</option>
              <option value="subtask">Subtask</option>
              <option value="bug">Bug</option>
            </select>
          </div>

          <div class="form-group">
            <label>Assignee</label>
            <input type="text" id="detailAssignee" class="form-control" placeholder="e.g. alice, agent-1" />
          </div>

          <div class="form-group">
            <label>Role</label>
            <input type="text" id="detailRole" class="form-control" placeholder="e.g. frontend, backend" />
          </div>

          <div class="form-group">
            <label>Parent Task ID</label>
            <input type="text" id="detailParentTaskId" class="form-control" placeholder="e.g. tk-123456" />
          </div>

          <div style="font-size: 0.72rem; color: var(--text-dim); margin-top: auto; padding-top: 10px; border-top: 1px solid var(--border);">
            <div>Created: <span id="detailCreatedAt">-</span></div>
            <div>Updated: <span id="detailUpdatedAt">-</span></div>
          </div>
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn btn-danger btn-sm" onclick="deleteCurrentTask()">🗑️ Delete Task</button>
        <div style="display: flex; gap: 8px;">
          <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
          <button class="btn" onclick="saveTaskDetails()">Save Changes</button>
        </div>
      </div>
    </div>
  </div>

  <!-- New Task Modal -->
  <div class="modal-backdrop" id="newTaskModal" onclick="if(event.target===this) closeNewTaskModal()">
    <div class="modal" style="max-width: 540px;">
      <div class="modal-header">
        <h3 style="font-size: 1.05rem; font-weight: 700;">➕ Create New Task</h3>
        <button class="btn btn-secondary btn-sm" onclick="closeNewTaskModal()">✕</button>
      </div>
      <div class="modal-body" style="grid-template-columns: 1fr;">
        <div class="form-group">
          <label>Task Title *</label>
          <input type="text" id="newTitle" class="form-control" placeholder="e.g. Implement OAuth Flow" required />
        </div>

        <div class="form-group">
          <label>Description</label>
          <textarea id="newDescription" class="form-control" placeholder="Details about this task..."></textarea>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
          <div class="form-group">
            <label>Priority</label>
            <select id="newPriority" class="form-control">
              <option value="medium" selected>Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
              <option value="low">Low</option>
            </select>
          </div>
          <div class="form-group">
            <label>Type</label>
            <select id="newType" class="form-control">
              <option value="task" selected>Task</option>
              <option value="epic">Epic</option>
              <option value="subtask">Subtask</option>
              <option value="bug">Bug</option>
            </select>
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
          <div class="form-group">
            <label>Role</label>
            <input type="text" id="newRole" class="form-control" placeholder="e.g. frontend" />
          </div>
          <div class="form-group">
            <label>Assignee</label>
            <input type="text" id="newAssignee" class="form-control" placeholder="e.g. alice" />
          </div>
        </div>

        <div class="form-group">
          <label>Parent Task ID (Optional)</label>
          <input type="text" id="newParentTaskId" class="form-control" placeholder="e.g. tk-a1b2c3" />
        </div>
      </div>
      <div class="modal-footer" style="justify-content: flex-end;">
        <button class="btn btn-secondary" onclick="closeNewTaskModal()">Cancel</button>
        <button class="btn" onclick="submitNewTask()">Create Task</button>
      </div>
    </div>
  </div>

  <!-- Toast Notification -->
  <div id="toast" class="toast">
    <span id="toastIcon">ℹ️</span>
    <span id="toastMsg">Notification message</span>
  </div>

  <script>
    const ORIGIN = "${origin}";
    let allTasks = [];
    let readyTaskIds = new Set();
    let currentTask = null;
    let draggedTaskId = null;

    function escapeHtml(str) {
      if (!str) return "";
      return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }

    function showToast(msg, isError = false) {
      const toast = document.getElementById("toast");
      const msgEl = document.getElementById("toastMsg");
      const iconEl = document.getElementById("toastIcon");
      
      toast.className = "toast show " + (isError ? "toast-error" : "toast-success");
      iconEl.textContent = isError ? "⚠️" : "✅";
      msgEl.textContent = msg;
      
      setTimeout(() => {
        toast.className = "toast";
      }, 3500);
    }

    async function loadTasks(showNotification = false) {
      try {
        const [tasksRes, readyRes] = await Promise.all([
          fetch("/api/tasks"),
          fetch("/api/tasks/ready")
        ]);

        if (!tasksRes.ok) throw new Error("Failed to load tasks");

        const tasksData = await tasksRes.json();
        const readyData = await readyRes.json();

        allTasks = tasksData.tasks || [];
        readyTaskIds = new Set((readyData.tasks || []).map(t => t.id));

        populateRoleFilter();
        renderBoard();
        if (showNotification) showToast("Tasks refreshed");
      } catch (err) {
        showToast(err.message, true);
      }
    }

    function populateRoleFilter() {
      const select = document.getElementById("roleFilter");
      const currentVal = select.value;
      const roles = Array.from(new Set(allTasks.map(t => t.role).filter(Boolean))).sort();
      
      select.innerHTML = '<option value="">All Roles</option>' + 
        roles.map(r => '<option value="' + escapeHtml(r) + '">' + escapeHtml(r) + '</option>').join("");
      select.value = currentVal;
    }

    function applyFilters() {
      renderBoard();
    }

    function getFilteredTasks() {
      const query = (document.getElementById("searchInput").value || "").toLowerCase().trim();
      const roleFilter = document.getElementById("roleFilter").value;
      const priorityFilter = document.getElementById("priorityFilter").value;
      const typeFilter = document.getElementById("typeFilter").value;
      const readyOnly = document.getElementById("readyOnlyToggle").checked;

      return allTasks.filter(task => {
        if (readyOnly && !readyTaskIds.has(task.id)) return false;
        if (roleFilter && task.role !== roleFilter) return false;
        if (priorityFilter && task.priority !== priorityFilter) return false;
        if (typeFilter && task.type !== typeFilter) return false;

        if (query) {
          const matchTitle = (task.title || "").toLowerCase().includes(query);
          const matchDesc = (task.description || "").toLowerCase().includes(query);
          const matchId = (task.id || "").toLowerCase().includes(query);
          const matchAssignee = (task.assignee || "").toLowerCase().includes(query);
          const matchRole = (task.role || "").toLowerCase().includes(query);
          if (!matchTitle && !matchDesc && !matchId && !matchAssignee && !matchRole) {
            return false;
          }
        }
        return true;
      });
    }

    function renderBoard() {
      const lanes = {
        open: document.getElementById("lane-open"),
        claimed: document.getElementById("lane-claimed"),
        in_progress: document.getElementById("lane-in_progress"),
        blocked: document.getElementById("lane-blocked"),
        review: document.getElementById("lane-review"),
        closed: document.getElementById("lane-closed")
      };

      const counts = {
        open: 0, claimed: 0, in_progress: 0, blocked: 0, review: 0, closed: 0
      };

      Object.values(lanes).forEach(lane => lane.innerHTML = "");

      const filtered = getFilteredTasks();

      // Update metrics
      document.getElementById("statTotal").textContent = allTasks.length;
      document.getElementById("statReady").textContent = readyTaskIds.size;
      document.getElementById("statInProgress").textContent = allTasks.filter(t => t.status === "in_progress" || t.status === "claimed").length;
      document.getElementById("statBlocked").textContent = allTasks.filter(t => t.status === "blocked").length;
      // statClosed metric removed; no DOM update needed

      filtered.forEach(task => {
        let laneKey = task.status || "open";
        if (laneKey === "wontfix") laneKey = "closed";
        if (!lanes[laneKey]) laneKey = "open";

        counts[laneKey]++;
        lanes[laneKey].appendChild(createTaskCard(task));
      });

      // Render empty dropzone placeholder for empty lanes
      Object.keys(lanes).forEach(k => {
        if (counts[k] === 0) {
          const empty = document.createElement("div");
          empty.className = "empty-state";
          empty.textContent = "No tasks in this lane";
          lanes[k].appendChild(empty);
        }
      });

      // Update column count chips
      Object.keys(counts).forEach(k => {
        const el = document.getElementById("count-" + k);
        if (el) el.textContent = counts[k];
      });
    }

    function createTaskCard(task) {
      const card = document.createElement("div");
      card.className = "task-card";
      card.draggable = true;
      card.id = "card-" + task.id;

      card.ondragstart = (e) => {
        draggedTaskId = task.id;
        card.classList.add("dragging");
        e.dataTransfer.setData("text/plain", task.id);
      };

      card.ondragend = () => {
        draggedTaskId = null;
        card.classList.remove("dragging");
      };

      card.onclick = () => openTaskDetails(task.id);

      const typeClass = "badge-" + (task.type || "task");
      const priorityClass = "priority-" + (task.priority || "medium");
      const isReady = readyTaskIds.has(task.id);
      const commentsCount = (task.comments && Array.isArray(task.comments)) ? task.comments.length : 0;

      card.innerHTML = \`
        <div class="card-top">
          <span class="task-id">\${escapeHtml(task.id)}</span>
          <div class="badges-row">
            \${isReady ? '<span class="badge" style="background: rgba(16, 185, 129, 0.2); color: #34d399;" title="Ready frontier">⚡ READY</span>' : ''}
            <span class="badge \${typeClass}">\${escapeHtml((task.type || "task").toUpperCase())}</span>
            <span class="badge \${priorityClass}">\${escapeHtml((task.priority || "medium").toUpperCase())}</span>
          </div>
        </div>
        <div class="card-title">\${escapeHtml(task.title)}</div>
        \${task.description ? '<div class="card-desc">' + escapeHtml(task.description) + '</div>' : ''}
        <div class="card-footer">
          <div class="card-assignee">
            \${task.assignee ? '👤 ' + escapeHtml(task.assignee) : (task.role ? '🏷️ ' + escapeHtml(task.role) : '<span style="color: var(--text-dim);">Unassigned</span>')}
          </div>
          <div class="card-meta-icons">
            \${commentsCount > 0 ? '<span class="comment-count-chip">💬 ' + commentsCount + '</span>' : ''}
          </div>
        </div>
      \`;

      return card;
    }

    /* Drag & Drop Handlers */
    function handleDragOver(e) {
      e.preventDefault();
      e.currentTarget.classList.add("drag-over");
    }

    function handleDragLeave(e) {
      e.currentTarget.classList.remove("drag-over");
    }

    async function handleDrop(e, targetStatus) {
      e.preventDefault();
      e.currentTarget.classList.remove("drag-over");
      const taskId = e.dataTransfer.getData("text/plain") || draggedTaskId;
      if (!taskId) return;

      const task = allTasks.find(t => t.id === taskId);
      if (!task || task.status === targetStatus) return;

      // Optimistic update
      task.status = targetStatus;
      renderBoard();

      try {
        const res = await fetch("/api/tasks/" + encodeURIComponent(taskId), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: targetStatus })
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Failed to update status");
        }
        showToast("Task " + taskId + " moved to " + targetStatus);
        loadTasks();
      } catch (err) {
        showToast(err.message, true);
        loadTasks();
      }
    }

    /* Task Details Modal */
    async function openTaskDetails(taskId) {
      try {
        const res = await fetch("/api/tasks/" + encodeURIComponent(taskId));
        if (!res.ok) throw new Error("Task not found");
        const data = await res.json();
        currentTask = data.task;

        document.getElementById("detailTaskId").textContent = currentTask.id;
        document.getElementById("detailTypeBadge").textContent = (currentTask.type || "task").toUpperCase();
        document.getElementById("detailTypeBadge").className = "badge badge-" + (currentTask.type || "task");
        document.getElementById("detailTitle").value = currentTask.title || "";
        document.getElementById("detailDescription").value = currentTask.description || "";
        document.getElementById("detailContext").value = currentTask.context || "";
        document.getElementById("detailStatus").value = currentTask.status || "open";
        document.getElementById("detailPriority").value = currentTask.priority || "medium";
        document.getElementById("detailType").value = currentTask.type || "task";
        document.getElementById("detailAssignee").value = currentTask.assignee || "";
        document.getElementById("detailRole").value = currentTask.role || "";
        document.getElementById("detailParentTaskId").value = currentTask.parentTaskId || "";
        document.getElementById("detailCreatedAt").textContent = currentTask.createdAt ? new Date(currentTask.createdAt).toLocaleString() : "-";
        document.getElementById("detailUpdatedAt").textContent = currentTask.updatedAt ? new Date(currentTask.updatedAt).toLocaleString() : "-";

        renderComments(currentTask.comments || []);
        renderDependencies(data.dependencies, data.children);

        document.getElementById("taskDetailModal").classList.add("open");
        resetCommentComposer();
      } catch (err) {
        showToast(err.message, true);
      }
    }

    function renderDependencies(dependencies, children) {
      const container = document.getElementById("detailDependenciesContainer");
      let html = "";

      if (dependencies && (dependencies.blocking?.length > 0 || dependencies.blockedBy?.length > 0)) {
        html += '<div style="background: #090d16; border: 1px solid var(--border); border-radius: 6px; padding: 8px 12px; margin-bottom: 10px;">';
        if (dependencies.blockedBy && dependencies.blockedBy.length > 0) {
          html += '<div style="color: #f87171; margin-bottom: 4px;"><strong>🛑 Blocked by:</strong> ' +
            dependencies.blockedBy.map(d => '<a href="javascript:void(0)" onclick="openTaskDetails(\\'' + d.fromTaskId + '\\')" style="color: #60a5fa; text-decoration: none; margin-right: 6px;">' + d.fromTaskId + '</a>').join(", ") + '</div>';
        }
        if (dependencies.blocking && dependencies.blocking.length > 0) {
          html += '<div style="color: #fbbf24;"><strong>⛓️ Blocks:</strong> ' +
            dependencies.blocking.map(d => '<a href="javascript:void(0)" onclick="openTaskDetails(\\'' + d.toTaskId + '\\')" style="color: #60a5fa; text-decoration: none; margin-right: 6px;">' + d.toTaskId + '</a>').join(", ") + '</div>';
        }
        html += '</div>';
      }

      if (children && children.length > 0) {
        html += '<div style="background: #090d16; border: 1px solid var(--border); border-radius: 6px; padding: 8px 12px;">';
        html += '<div style="color: #c084fc; margin-bottom: 4px;"><strong>📑 Child Subtasks (' + children.length + '):</strong></div>';
        html += '<ul style="padding-left: 16px; margin: 0;">';
        children.forEach(c => {
          html += '<li><a href="javascript:void(0)" onclick="openTaskDetails(\\'' + c.id + '\\')" style="color: #60a5fa; text-decoration: none;">' + escapeHtml(c.title) + ' (' + c.id + ')</a> - <span style="font-size: 0.75rem; color: var(--text-dim);">' + c.status + '</span></li>';
        });
        html += '</ul></div>';
      }

      container.innerHTML = html;
    }

    function renderComments(comments) {
      const list = document.getElementById("commentsList");
      document.getElementById("commentCount").textContent = comments.length;

      if (!comments || comments.length === 0) {
        list.innerHTML = '<div class="empty-state">No comments yet. Be the first to leave a note!</div>';
        return;
      }

      list.innerHTML = comments.map(c => \`
        <div class="comment-bubble">
          <div class="comment-top">
            <span class="comment-author">\${escapeHtml(c.author || "anonymous")}</span>
            <span>\${c.createdAt ? new Date(c.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : ""}</span>
          </div>
          <div class="comment-body">\${escapeHtml(c.content)}</div>
        </div>
      \`).join("");

      list.scrollTop = list.scrollHeight;
    }

    function updateCharCounter() {
      const input = document.getElementById("commentInput");
      const counter = document.getElementById("commentCharCount");
      const len = input.value.length;
      counter.textContent = len + " / 256";

      if (len > 240) {
        counter.className = "char-counter danger";
      } else if (len > 200) {
        counter.className = "char-counter warning";
      } else {
        counter.className = "char-counter";
      }
    }

    function resetCommentComposer() {
      document.getElementById("commentInput").value = "";
      updateCharCounter();
    }

    async function postComment() {
      if (!currentTask) return;
      const text = document.getElementById("commentInput").value.trim();
      const author = document.getElementById("commentAuthor").value.trim() || "User";

      if (!text) {
        showToast("Please enter a comment.", true);
        return;
      }

      if (text.length > 256) {
        showToast("Comment must be 256 characters or fewer.", true);
        return;
      }

      try {
        const res = await fetch("/api/tasks/" + encodeURIComponent(currentTask.id) + "/comments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: text, author })
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Failed to post comment");
        }

        const data = await res.json();
        currentTask.comments = currentTask.comments || [];
        currentTask.comments.push(data.comment);
        renderComments(currentTask.comments);
        resetCommentComposer();
        showToast("Comment added!");
        loadTasks();
      } catch (err) {
        showToast(err.message, true);
      }
    }

    async function saveTaskDetails() {
      if (!currentTask) return;

      const title = document.getElementById("detailTitle").value.trim();
      if (!title) {
        showToast("Title cannot be empty", true);
        return;
      }

      const updates = {
        title,
        description: document.getElementById("detailDescription").value,
        context: document.getElementById("detailContext").value,
        status: document.getElementById("detailStatus").value,
        priority: document.getElementById("detailPriority").value,
        type: document.getElementById("detailType").value,
        assignee: document.getElementById("detailAssignee").value.trim() || undefined,
        role: document.getElementById("detailRole").value.trim() || undefined,
        parentTaskId: document.getElementById("detailParentTaskId").value.trim() || undefined
      };

      try {
        const res = await fetch("/api/tasks/" + encodeURIComponent(currentTask.id), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updates)
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Failed to save task");
        }

        showToast("Task updated successfully!");
        closeModal();
        loadTasks();
      } catch (err) {
        showToast(err.message, true);
      }
    }

    async function deleteCurrentTask() {
      if (!currentTask) return;
      if (!confirm("Are you sure you want to permanently delete task " + currentTask.id + "?")) return;

      try {
        const res = await fetch("/api/tasks/" + encodeURIComponent(currentTask.id), {
          method: "DELETE"
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Failed to delete task");
        }

        showToast("Task deleted");
        closeModal();
        loadTasks();
      } catch (err) {
        showToast(err.message, true);
      }
    }

    function closeModal() {
      document.getElementById("taskDetailModal").classList.remove("open");
      currentTask = null;
    }

    /* New Task Modal */
    function openNewTaskModal() {
      document.getElementById("newTitle").value = "";
      document.getElementById("newDescription").value = "";
      document.getElementById("newPriority").value = "medium";
      document.getElementById("newType").value = "task";
      document.getElementById("newRole").value = "";
      document.getElementById("newAssignee").value = "";
      document.getElementById("newParentTaskId").value = "";
      document.getElementById("newTaskModal").classList.add("open");
      setTimeout(() => document.getElementById("newTitle").focus(), 50);
    }

    function closeNewTaskModal() {
      document.getElementById("newTaskModal").classList.remove("open");
    }

    async function submitNewTask() {
      const title = document.getElementById("newTitle").value.trim();
      if (!title) {
        showToast("Title is required", true);
        return;
      }

      const payload = {
        title,
        description: document.getElementById("newDescription").value.trim() || undefined,
        priority: document.getElementById("newPriority").value,
        type: document.getElementById("newType").value,
        role: document.getElementById("newRole").value.trim() || undefined,
        assignee: document.getElementById("newAssignee").value.trim() || undefined,
        parentTaskId: document.getElementById("newParentTaskId").value.trim() || undefined
      };

      try {
        const res = await fetch("/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Failed to create task");
        }

        const data = await res.json();
        showToast("Task created: " + data.task.id);
        closeNewTaskModal();
        loadTasks();
      } catch (err) {
        showToast(err.message, true);
      }
    }

    // Keyboard Shortcuts (Esc closes modals, Ctrl+Enter posts comments)
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closeModal();
        closeNewTaskModal();
      }
    });

    document.getElementById("commentInput").addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        postComment();
      }
    });

    // Initial load
    loadTasks();
  </script>
</body>
</html>`;
}
