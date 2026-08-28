/**
 * Server-Side Rendered & Interactive Single-Page Web Application for Task Kanban Board,
 * Memory Vault & Explorer, and Role Journals.
 * Built using standard Web APIs, HTML5, CSS3, and modern Vanilla JavaScript.
 */

import { escapeHtml } from "./common.ts";

export interface TaskUiOptions {
  origin: string;
  userId?: string;
  userName?: string;
  initialTab?: "tasks" | "memories" | "journals";
}

export function renderTaskKanbanHtml(options: TaskUiOptions): string {
  const origin = options.origin.replace(/\/+$/, "");
  const userName = escapeHtml(options.userName || options.userId || "Guest");
  const initialTab = options.initialTab || "tasks";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Tasks Board — Workflow MCP</title>
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
      --amber: #f59e0b;
      --amber-bg: rgba(245, 158, 11, 0.15);
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
      gap: 8px;
    }
    .nav-tab {
      background: transparent;
      border: 1px solid transparent;
      color: var(--text-muted);
      font-size: 0.85rem;
      font-weight: 600;
      padding: 7px 13px;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.15s;
      font-family: inherit;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      text-decoration: none;
    }
    .nav-tab:hover {
      color: var(--text);
      background: rgba(255, 255, 255, 0.06);
    }
    .nav-tab.active {
      color: #60a5fa;
      background: rgba(59, 130, 246, 0.15);
      border-color: rgba(59, 130, 246, 0.3);
    }
    .nav-link {
      color: var(--text-muted);
      text-decoration: none;
      font-size: 0.85rem;
      font-weight: 500;
      padding: 7px 12px;
      border-radius: 6px;
      transition: all 0.15s;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .nav-link:hover {
      color: var(--text);
      background: rgba(255, 255, 255, 0.05);
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

    /* Main View Containers */
    .main-view {
      display: flex;
      flex-direction: column;
      flex: 1;
    }
    .main-view.hidden {
      display: none !important;
    }

    /* Metrics & Controls Bar */
    .controls-bar {
      padding: 14px 24px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      background: #090d16;
      border-bottom: 1px solid var(--border);
    }
    .metrics-row {
      display: flex;
      align-items: center;
      gap: 10px;
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

    /* Memory Vault Layout & Cards */
    .memory-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 16px;
      padding: 20px 24px;
      align-items: start;
    }
    .memory-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      transition: all 0.15s;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      cursor: pointer;
    }
    .memory-card:hover {
      background: var(--bg-card-hover);
      border-color: #334155;
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0,0,0,0.25);
    }
    .memory-card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .memory-key {
      font-family: var(--font-mono);
      font-size: 0.88rem;
      font-weight: 700;
      color: #60a5fa;
      word-break: break-all;
    }
    .scope-badge-workflow {
      background: rgba(59, 130, 246, 0.2);
      color: #60a5fa;
    }
    .scope-badge-node {
      background: rgba(168, 85, 247, 0.2);
      color: #c084fc;
    }
    .scope-badge-role {
      background: rgba(245, 158, 11, 0.2);
      color: #fbbf24;
    }
    .scope-badge-global {
      background: rgba(148, 163, 184, 0.2);
      color: #cbd5e1;
    }
    .memory-summary {
      font-size: 0.84rem;
      color: var(--text);
      line-height: 1.4;
    }
    .memory-target-ref {
      font-size: 0.75rem;
      color: var(--text-dim);
      font-family: var(--font-mono);
    }
    .tags-row {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }
    .tag-chip {
      font-size: 0.7rem;
      background: #1e293b;
      color: #94a3b8;
      padding: 2px 6px;
      border-radius: 4px;
    }
    .memory-card-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding-top: 8px;
      border-top: 1px solid rgba(255, 255, 255, 0.06);
      font-size: 0.75rem;
      color: var(--text-dim);
    }
    .access-chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      color: #34d399;
      font-weight: 600;
      font-size: 0.75rem;
    }

    /* Role Journals Layout & Cards */
    .roles-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
      gap: 20px;
      padding: 20px 24px;
      align-items: start;
    }
    .role-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 18px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      box-shadow: 0 4px 10px rgba(0,0,0,0.15);
    }
    .role-card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }
    .role-name {
      font-size: 1.05rem;
      font-weight: 700;
      color: var(--text);
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .role-desc {
      font-size: 0.82rem;
      color: var(--text-muted);
      line-height: 1.4;
    }
    .journal-box {
      background: #090d16;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .journal-box-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 0.75rem;
      color: var(--text-dim);
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
      padding-bottom: 6px;
    }
    .journal-entry-text {
      font-size: 0.82rem;
      color: #e2e8f0;
      line-height: 1.45;
      white-space: pre-wrap;
      word-break: break-word;
      max-height: 160px;
      overflow-y: auto;
      font-family: var(--font-mono);
    }
    .role-card-actions {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-top: auto;
      padding-top: 10px;
      border-top: 1px solid var(--border);
    }

    /* Context & Role Journal Section in Task Detail Modal */
    .context-section {
      margin-top: 16px;
      padding-top: 16px;
      border-top: 1px solid var(--border);
    }
    .context-section-title {
      font-size: 0.88rem;
      font-weight: 700;
      color: #60a5fa;
      margin-bottom: 10px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .context-journal-card {
      background: #090d16;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 12px;
    }
    .context-journal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 0.75rem;
      color: var(--text-muted);
      margin-bottom: 6px;
    }
    .context-memories-list {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .context-mem-chip {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 6px;
      padding: 6px 10px;
      cursor: pointer;
      transition: all 0.15s;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 0.78rem;
      color: var(--text);
    }
    .context-mem-chip:hover {
      background: #334155;
      border-color: #60a5fa;
    }

    /* Access Log Table */
    .access-log-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.78rem;
      margin-top: 8px;
    }
    .access-log-table th, .access-log-table td {
      padding: 6px 10px;
      text-align: left;
      border-bottom: 1px solid var(--border);
    }
    .access-log-table th {
      color: var(--text-muted);
      font-weight: 600;
      background: rgba(255, 255, 255, 0.02);
    }
    .access-log-table tr:hover td {
      background: rgba(255, 255, 255, 0.03);
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
      grid-column: 1 / -1;
    }
  </style>
</head>
<body>
  <!-- Header -->
  <header>
    <a href="/" class="brand">
      <span class="brand-logo">⚡</span>
      <span class="brand-title">Workflow MCP</span>
    </a>
    <div class="header-nav">
      <button class="nav-tab ${initialTab === 'tasks' ? 'active' : ''}" id="tab-btn-tasks" onclick="switchMainTab('tasks')">
        📋 Tasks
      </button>
      <button class="nav-tab ${initialTab === 'memories' ? 'active' : ''}" id="tab-btn-memories" onclick="switchMainTab('memories')">
        🧠 Memories
      </button>
      <button class="nav-tab ${initialTab === 'journals' ? 'active' : ''}" id="tab-btn-journals" onclick="switchMainTab('journals')">
        📖 Role Journals
      </button>
      <a href="/visualize" class="nav-link">📊 Workflows</a>
      <a href="/" class="nav-link">⚡ Dashboard</a>
      <button class="btn" id="headerActionBtn" onclick="handleHeaderAction()">
        <span>➕</span> <span id="headerActionBtnText">New Task</span>
      </button>
    </div>
  </header>

  <!-- ======================== VIEW 1: TASKS KANBAN ======================== -->
  <div id="tasksView" class="main-view ${initialTab !== 'tasks' ? 'hidden' : ''}">
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
  </div>

  <!-- ======================== VIEW 2: MEMORY VAULT ======================== -->
  <div id="memoriesView" class="main-view ${initialTab !== 'memories' ? 'hidden' : ''}">
    <!-- Controls & Metrics -->
    <div class="controls-bar">
      <div class="metrics-row">
        <div class="metric-pill">
          <span>🧠 Total Memories:</span>
          <span class="metric-num" id="memStatTotal">0</span>
        </div>
        <div class="metric-pill">
          <span style="color: #60a5fa;">📊 Workflow Scope:</span>
          <span class="metric-num" id="memStatWorkflow" style="color: #60a5fa;">0</span>
        </div>
        <div class="metric-pill">
          <span style="color: #c084fc;">🧩 Node Scope:</span>
          <span class="metric-num" id="memStatNode" style="color: #c084fc;">0</span>
        </div>
        <div class="metric-pill">
          <span style="color: #fbbf24;">🏷️ Role Scope:</span>
          <span class="metric-num" id="memStatRole" style="color: #fbbf24;">0</span>
        </div>
        <div class="metric-pill">
          <span style="color: #34d399;">👁️ Total Recalls:</span>
          <span class="metric-num" id="memStatAccessCount" style="color: #34d399;">0</span>
        </div>
      </div>

      <div class="filters-row">
        <input type="text" id="memSearchInput" class="search-input" placeholder="🔍 Search memories by key, summary, tag, or target..." oninput="renderMemoriesGrid()" />
        
        <select id="memScopeFilter" class="filter-select" onchange="renderMemoriesGrid()">
          <option value="">All Scopes</option>
          <option value="workflow">Workflow Scope</option>
          <option value="node">Node Scope</option>
          <option value="role">Role Scope</option>
        </select>

        <input type="text" id="memTagFilter" class="form-control" style="width: 180px; padding: 7px 12px; font-size: 0.85rem;" placeholder="🏷️ Filter by tag..." oninput="renderMemoriesGrid()" />

        <button class="btn btn-secondary btn-sm" onclick="loadMemories(true)">
          <span>🔄</span> Refresh
        </button>

        <button class="btn btn-sm" onclick="openNewMemoryModal()">
          <span>➕</span> New Memory
        </button>
      </div>
    </div>

    <!-- Memories Grid -->
    <main class="memory-grid" id="memoriesGrid">
      <div class="empty-state">Loading Memory Vault...</div>
    </main>
  </div>

  <!-- ======================== VIEW 3: ROLE JOURNALS ======================== -->
  <div id="journalsView" class="main-view ${initialTab !== 'journals' ? 'hidden' : ''}">
    <!-- Controls & Metrics -->
    <div class="controls-bar">
      <div class="metrics-row">
        <div class="metric-pill">
          <span>👥 Defined Roles:</span>
          <span class="metric-num" id="journalStatRoles">0</span>
        </div>
        <div class="metric-pill">
          <span style="color: #34d399;">📖 Active Journals:</span>
          <span class="metric-num" id="journalStatEntries" style="color: #34d399;">0</span>
        </div>
      </div>

      <div class="filters-row">
        <input type="text" id="journalSearchInput" class="search-input" placeholder="🔍 Search roles and journal entries..." oninput="renderJournalsGrid()" />
        
        <button class="btn btn-secondary btn-sm" onclick="loadJournals(true)">
          <span>🔄</span> Refresh
        </button>

        <button class="btn btn-sm" onclick="openNewRoleModal()">
          <span>➕</span> New Role
        </button>
      </div>
    </div>

    <!-- Roles & Journals Grid -->
    <main class="roles-grid" id="rolesGrid">
      <div class="empty-state">Loading Role Journals...</div>
    </main>
  </div>

  <!-- ======================== MODALS ======================== -->

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

          <!-- Context-Aware Role Journal & Memory Integration -->
          <div class="context-section" id="taskContextSection">
            <div class="context-section-title">
              <span>🧠 Context & Role Journal</span>
            </div>
            
            <!-- Inline Role Journal Snapshot -->
            <div id="taskRoleJournalContainer">
              <div style="color: var(--text-dim); font-size: 0.8rem;">Loading role journal...</div>
            </div>

            <!-- Scoped Matching Memories -->
            <div style="margin-top: 10px;">
              <div style="font-size: 0.75rem; color: var(--text-muted); font-weight: 600; text-transform: uppercase; margin-bottom: 6px;">Relevant Memories:</div>
              <div class="context-memories-list" id="taskMemoriesContainer">
                <div style="color: var(--text-dim); font-size: 0.8rem;">No linked memories found.</div>
              </div>
            </div>
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
            <input type="text" id="detailRole" class="form-control" placeholder="e.g. frontend, backend" onchange="refreshTaskContextDetails()" />
          </div>

          <div class="form-group">
            <label>Workflow ID</label>
            <input type="text" id="detailWorkflowId" class="form-control" placeholder="e.g. wf_123456" />
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

  <!-- Memory Detail & Recall Modal -->
  <div class="modal-backdrop" id="memoryDetailModal" onclick="if(event.target===this) closeMemoryDetailModal()">
    <div class="modal" style="max-width: 800px;">
      <div class="modal-header">
        <div style="display: flex; align-items: center; gap: 10px;">
          <span id="memDetailScopeBadge" class="badge scope-badge-workflow">WORKFLOW</span>
          <span id="memDetailKey" class="memory-key" style="font-size: 1rem;">key_name</span>
        </div>
        <button class="btn btn-secondary btn-sm" onclick="closeMemoryDetailModal()">✕</button>
      </div>

      <div class="modal-body" style="grid-template-columns: 1fr;">
        <!-- Summary & Metadata Row -->
        <div style="background: #090d16; border: 1px solid var(--border); border-radius: 8px; padding: 12px; display: flex; flex-direction: column; gap: 8px;">
          <div class="form-group" style="margin-bottom: 0;">
            <label>Summary</label>
            <input type="text" id="memDetailSummary" class="form-control" />
          </div>

          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 8px; font-size: 0.78rem; color: var(--text-muted); margin-top: 4px;">
            <div>Target: <code id="memDetailTarget" style="color: #93c5fd;">-</code></div>
            <div>Accesses: <span id="memDetailAccessCount" class="access-chip">👁️ 0</span></div>
            <div>Source: <span id="memDetailSource" style="color: var(--text);">-</span></div>
            <div>Updated: <span id="memDetailUpdatedAt">-</span></div>
          </div>

          <div class="form-group" style="margin-bottom: 0; margin-top: 4px;">
            <label>Tags (Comma separated)</label>
            <input type="text" id="memDetailTags" class="form-control" placeholder="tag1, tag2..." />
          </div>
        </div>

        <!-- Content Viewer & Editor -->
        <div class="form-group">
          <label>Memory Content (Markdown / Text)</label>
          <textarea id="memDetailContent" class="form-control" style="min-height: 160px; font-family: var(--font-mono); font-size: 0.84rem;"></textarea>
        </div>

        <!-- Access History Log Table -->
        <div>
          <label style="font-size: 0.78rem; font-weight: 600; color: var(--text-muted); text-transform: uppercase;">👁️ Access & Recall History Log</label>
          <div style="max-height: 140px; overflow-y: auto; border: 1px solid var(--border); border-radius: 6px; margin-top: 4px;">
            <table class="access-log-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Accessed By</th>
                  <th>Task ID</th>
                  <th>Execution ID</th>
                </tr>
              </thead>
              <tbody id="memAccessLogBody">
                <tr><td colspan="4" style="text-align: center; color: var(--text-dim);">No access logs recorded.</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn btn-danger btn-sm" onclick="deleteCurrentMemory()">🗑️ Delete Memory</button>
        <div style="display: flex; gap: 8px;">
          <button class="btn btn-secondary" onclick="closeMemoryDetailModal()">Cancel</button>
          <button class="btn" onclick="saveMemoryDetails()">Save Changes</button>
        </div>
      </div>
    </div>
  </div>

  <!-- New Memory Modal -->
  <div class="modal-backdrop" id="newMemoryModal" onclick="if(event.target===this) closeNewMemoryModal()">
    <div class="modal" style="max-width: 600px;">
      <div class="modal-header">
        <h3 style="font-size: 1.05rem; font-weight: 700;">🧠 Save New Memory</h3>
        <button class="btn btn-secondary btn-sm" onclick="closeNewMemoryModal()">✕</button>
      </div>
      <div class="modal-body" style="grid-template-columns: 1fr;">
        <div class="form-group">
          <label>Memory Key *</label>
          <input type="text" id="newMemKey" class="form-control" placeholder="e.g. oauth_token_storage" required />
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
          <div class="form-group">
            <label>Scope *</label>
            <select id="newMemScope" class="form-control" onchange="toggleScopeInputs()">
              <option value="workflow" selected>Workflow</option>
              <option value="node">Node</option>
              <option value="role">Role</option>
            </select>
          </div>
          <div class="form-group" id="scopeTargetGroup">
            <label id="scopeTargetLabel">Workflow ID</label>
            <input type="text" id="newMemTargetId" class="form-control" placeholder="e.g. wf_123456" />
          </div>
        </div>

        <div class="form-group">
          <label>Summary *</label>
          <input type="text" id="newMemSummary" class="form-control" placeholder="Short description of this memory..." required />
        </div>

        <div class="form-group">
          <label>Tags (Comma-separated)</label>
          <input type="text" id="newMemTags" class="form-control" placeholder="e.g. auth, security, architecture" />
        </div>

        <div class="form-group">
          <label>Content (Full Details / Markdown) *</label>
          <textarea id="newMemContent" class="form-control" style="min-height: 120px; font-family: var(--font-mono);" placeholder="Enter notes, knowledge, or specifications..." required></textarea>
        </div>
      </div>
      <div class="modal-footer" style="justify-content: flex-end;">
        <button class="btn btn-secondary" onclick="closeNewMemoryModal()">Cancel</button>
        <button class="btn" onclick="submitNewMemory()">Save Memory</button>
      </div>
    </div>
  </div>

  <!-- New Role Modal -->
  <div class="modal-backdrop" id="newRoleModal" onclick="if(event.target===this) closeNewRoleModal()">
    <div class="modal" style="max-width: 500px;">
      <div class="modal-header">
        <h3 style="font-size: 1.05rem; font-weight: 700;">➕ Define New Role</h3>
        <button class="btn btn-secondary btn-sm" onclick="closeNewRoleModal()">✕</button>
      </div>
      <div class="modal-body" style="grid-template-columns: 1fr;">
        <div class="form-group">
          <label>Role Name *</label>
          <input type="text" id="newRoleName" class="form-control" placeholder="e.g. backend, frontend, qa, devops" required />
        </div>

        <div class="form-group">
          <label>Description</label>
          <textarea id="newRoleDesc" class="form-control" placeholder="Responsibilities and scope for this role..."></textarea>
        </div>
      </div>
      <div class="modal-footer" style="justify-content: flex-end;">
        <button class="btn btn-secondary" onclick="closeNewRoleModal()">Cancel</button>
        <button class="btn" onclick="submitNewRole()">Create Role</button>
      </div>
    </div>
  </div>

  <!-- Edit Role Journal Modal -->
  <div class="modal-backdrop" id="editJournalModal" onclick="if(event.target===this) closeEditJournalModal()">
    <div class="modal" style="max-width: 650px;">
      <div class="modal-header">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span class="badge badge-epic">ROLE JOURNAL</span>
          <h3 id="editJournalRoleTitle" style="font-size: 1.05rem; font-weight: 700;">frontend</h3>
        </div>
        <button class="btn btn-secondary btn-sm" onclick="closeEditJournalModal()">✕</button>
      </div>
      <div class="modal-body" style="grid-template-columns: 1fr;">
        <input type="hidden" id="editJournalRoleName" />

        <div class="form-group">
          <label>Written By (Author)</label>
          <input type="text" id="editJournalAuthor" class="form-control" value="${userName}" />
        </div>

        <div class="form-group">
          <label>Journal Entry (Markdown / Progress / Working Handoff)</label>
          <textarea id="editJournalEntry" class="form-control" style="min-height: 180px; font-family: var(--font-mono);" placeholder="Record decisions, latest state, and instructions for incoming agents..."></textarea>
        </div>
      </div>
      <div class="modal-footer" style="justify-content: flex-end;">
        <button class="btn btn-secondary" onclick="closeEditJournalModal()">Cancel</button>
        <button class="btn" onclick="submitJournalUpdate()">Update Journal</button>
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
    const CURRENT_USER = "${userName}";
    let currentTab = "${initialTab}";

    let allTasks = [];
    let readyTaskIds = new Set();
    let currentTask = null;
    let draggedTaskId = null;

    let allMemories = [];
    let currentMemory = null;

    let allRoles = [];

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

    /* =========================================================================
       GLOBAL NAVIGATION & TAB SWITCHING
       ========================================================================= */
    function switchMainTab(tab, updateHistory = true) {
      currentTab = tab;
      
      // Update nav buttons
      document.querySelectorAll(".nav-tab").forEach(btn => btn.classList.remove("active"));
      const activeBtn = document.getElementById("tab-btn-" + tab);
      if (activeBtn) activeBtn.classList.add("active");

      // Update header action button
      const actionText = document.getElementById("headerActionBtnText");
      if (tab === "tasks") actionText.textContent = "New Task";
      else if (tab === "memories") actionText.textContent = "New Memory";
      else if (tab === "journals") actionText.textContent = "New Role";

      // Toggle views
      document.querySelectorAll(".main-view").forEach(v => v.classList.add("hidden"));
      const activeView = document.getElementById(tab + "View");
      if (activeView) activeView.classList.remove("hidden");

      if (updateHistory) {
        window.history.pushState({ tab }, "", "/" + tab);
      }

      // Load view data
      if (tab === "tasks") loadTasks();
      else if (tab === "memories") loadMemories();
      else if (tab === "journals") loadJournals();
    }

    function handleHeaderAction() {
      if (currentTab === "tasks") openNewTaskModal();
      else if (currentTab === "memories") openNewMemoryModal();
      else if (currentTab === "journals") openNewRoleModal();
    }

    window.addEventListener("popstate", (e) => {
      if (e.state && e.state.tab) {
        switchMainTab(e.state.tab, false);
      } else {
        const path = window.location.pathname.replace(/^\\//, "");
        if (path === "memories" || path === "journals" || path === "tasks") {
          switchMainTab(path, false);
        } else {
          switchMainTab("tasks", false);
        }
      }
    });

    /* =========================================================================
       1. TASKS KANBAN IMPLEMENTATION
       ========================================================================= */
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

      document.getElementById("statTotal").textContent = allTasks.length;
      document.getElementById("statReady").textContent = readyTaskIds.size;
      document.getElementById("statInProgress").textContent = allTasks.filter(t => t.status === "in_progress" || t.status === "claimed").length;
      document.getElementById("statBlocked").textContent = allTasks.filter(t => t.status === "blocked").length;

      filtered.forEach(task => {
        let laneKey = task.status || "open";
        if (laneKey === "wontfix") laneKey = "closed";
        if (!lanes[laneKey]) laneKey = "open";

        counts[laneKey]++;
        lanes[laneKey].appendChild(createTaskCard(task));
      });

      Object.keys(lanes).forEach(k => {
        if (counts[k] === 0) {
          const empty = document.createElement("div");
          empty.className = "empty-state";
          empty.textContent = "No tasks in this lane";
          lanes[k].appendChild(empty);
        }
      });

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

    /* Task Details Modal & Context Integration */
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
        document.getElementById("detailWorkflowId").value = currentTask.workflowId || "";
        document.getElementById("detailParentTaskId").value = currentTask.parentTaskId || "";
        document.getElementById("detailCreatedAt").textContent = currentTask.createdAt ? new Date(currentTask.createdAt).toLocaleString() : "-";
        document.getElementById("detailUpdatedAt").textContent = currentTask.updatedAt ? new Date(currentTask.updatedAt).toLocaleString() : "-";

        renderComments(currentTask.comments || []);
        renderDependencies(data.dependencies, data.children);

        // Fetch and render context-aware Role Journal & Memories
        loadTaskContextDetails(currentTask);

        document.getElementById("taskDetailModal").classList.add("open");
        resetCommentComposer();
      } catch (err) {
        showToast(err.message, true);
      }
    }

    async function loadTaskContextDetails(task) {
      const journalContainer = document.getElementById("taskRoleJournalContainer");
      const memContainer = document.getElementById("taskMemoriesContainer");

      // 1. Role Journal Snapshot
      if (task.role) {
        journalContainer.innerHTML = '<div style="color: var(--text-dim); font-size: 0.8rem;">Loading journal for role "' + escapeHtml(task.role) + '"...</div>';
        try {
          const jRes = await fetch("/api/journals/" + encodeURIComponent(task.role));
          if (jRes.ok) {
            const jData = await jRes.json();
            if (jData.journal && jData.journal.entry) {
              journalContainer.innerHTML = \`
                <div class="context-journal-card">
                  <div class="context-journal-header">
                    <span><strong>📖 Role Journal:</strong> \${escapeHtml(task.role)}</span>
                    <span>👤 \${escapeHtml(jData.journal.writtenBy || "unknown")} • 🕒 \${new Date(jData.journal.updatedAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                  </div>
                  <div class="journal-entry-text">\${escapeHtml(jData.journal.entry)}</div>
                  <div style="margin-top: 8px;">
                    <button class="btn btn-secondary btn-sm" onclick="openEditJournalModal('\${escapeHtml(task.role)}', '\${escapeHtml(jData.journal.entry).replace(/'/g, "\\\\'")}')">✏️ Update Role Journal</button>
                  </div>
                </div>
              \`;
            } else {
              journalContainer.innerHTML = \`
                <div class="context-journal-card" style="display: flex; justify-content: space-between; align-items: center;">
                  <span style="font-size: 0.8rem; color: var(--text-dim);">No active journal entry for role "<strong>\${escapeHtml(task.role)}</strong>".</span>
                  <button class="btn btn-secondary btn-sm" onclick="openEditJournalModal('\${escapeHtml(task.role)}', '')">📝 Write Entry</button>
                </div>
              \`;
            }
          } else {
            journalContainer.innerHTML = '<div style="font-size: 0.8rem; color: var(--text-dim);">No role journal found.</div>';
          }
        } catch (_) {
          journalContainer.innerHTML = '<div style="font-size: 0.8rem; color: var(--text-dim);">Could not load role journal.</div>';
        }
      } else {
        journalContainer.innerHTML = '<div style="font-size: 0.8rem; color: var(--text-dim);">Assign a <code>role</code> to view its working journal.</div>';
      }

      // 2. Scoped Memories
      memContainer.innerHTML = '<div style="color: var(--text-dim); font-size: 0.8rem;">Searching relevant memories...</div>';
      try {
        const queryParams = new URLSearchParams();
        if (task.role) queryParams.set("roleId", task.role);
        if (task.workflowId) queryParams.set("workflowId", task.workflowId);

        const mRes = await fetch("/api/memories?" + queryParams.toString());
        if (mRes.ok) {
          const mData = await mRes.json();
          const memories = mData.memories || [];
          if (memories.length > 0) {
            memContainer.innerHTML = memories.map(m => \`
              <div class="context-mem-chip" onclick="openMemoryDetailModal('\${m.id}', '\${task.id}')" title="\${escapeHtml(m.summary)}">
                <span class="badge scope-badge-\${m.scope}">\${m.scope.toUpperCase()}</span>
                <strong>\${escapeHtml(m.key)}</strong>
                <span style="color: #34d399; font-size: 0.72rem;">👁️ \${m.accessCount || 0}</span>
              </div>
            \`).join("");
          } else {
            memContainer.innerHTML = '<div style="font-size: 0.8rem; color: var(--text-dim);">No scoped memories found for this task.</div>';
          }
        }
      } catch (_) {
        memContainer.innerHTML = '<div style="font-size: 0.8rem; color: var(--text-dim);">Could not load memories.</div>';
      }
    }

    function refreshTaskContextDetails() {
      if (currentTask) {
        currentTask.role = document.getElementById("detailRole").value.trim() || undefined;
        loadTaskContextDetails(currentTask);
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
        workflowId: document.getElementById("detailWorkflowId").value.trim() || undefined,
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

    /* =========================================================================
       2. MEMORY VAULT & EXPLORER IMPLEMENTATION
       ========================================================================= */
    async function loadMemories(showNotification = false) {
      try {
        const res = await fetch("/api/memories");
        if (!res.ok) throw new Error("Failed to load memories");
        const data = await res.json();
        allMemories = data.memories || [];

        updateMemoryMetrics();
        renderMemoriesGrid();
        if (showNotification) showToast("Memory Vault refreshed");
      } catch (err) {
        showToast(err.message, true);
      }
    }

    function updateMemoryMetrics() {
      document.getElementById("memStatTotal").textContent = allMemories.length;
      document.getElementById("memStatWorkflow").textContent = allMemories.filter(m => m.scope === "workflow").length;
      document.getElementById("memStatNode").textContent = allMemories.filter(m => m.scope === "node").length;
      document.getElementById("memStatRole").textContent = allMemories.filter(m => m.scope === "role").length;

      const totalAccess = allMemories.reduce((sum, m) => sum + (m.accessCount || 0), 0);
      document.getElementById("memStatAccessCount").textContent = totalAccess;
    }

    function getFilteredMemories() {
      const search = (document.getElementById("memSearchInput").value || "").toLowerCase().trim();
      const scopeFilter = document.getElementById("memScopeFilter").value;
      const tagFilter = (document.getElementById("memTagFilter").value || "").toLowerCase().trim();

      return allMemories.filter(m => {
        if (scopeFilter && m.scope !== scopeFilter) return false;

        if (tagFilter) {
          if (!m.tags || !m.tags.some(t => t.toLowerCase().includes(tagFilter))) {
            return false;
          }
        }

        if (search) {
          const matchKey = (m.key || "").toLowerCase().includes(search);
          const matchSummary = (m.summary || "").toLowerCase().includes(search);
          const matchWorkflow = (m.workflowId || "").toLowerCase().includes(search);
          const matchNode = (m.nodeId || "").toLowerCase().includes(search);
          const matchRole = (m.roleId || "").toLowerCase().includes(search);
          const matchTags = m.tags && m.tags.some(t => t.toLowerCase().includes(search));
          if (!matchKey && !matchSummary && !matchWorkflow && !matchNode && !matchRole && !matchTags) {
            return false;
          }
        }

        return true;
      });
    }

    function renderMemoriesGrid() {
      const grid = document.getElementById("memoriesGrid");
      const filtered = getFilteredMemories();

      if (filtered.length === 0) {
        grid.innerHTML = '<div class="empty-state">No memories found in the vault.</div>';
        return;
      }

      grid.innerHTML = filtered.map(m => {
        const scopeBadgeClass = "scope-badge-" + (m.scope || "workflow");
        const targetRef = m.scope === "workflow" ? ("Workflow: " + (m.workflowId || "global")) :
                          (m.scope === "node" ? ("Node: " + (m.nodeId || "-") + " in " + (m.workflowId || "-")) :
                          (m.scope === "role" ? ("Role: " + (m.roleId || "-")) : ""));

        const tagsHtml = (m.tags && Array.isArray(m.tags) && m.tags.length > 0)
          ? m.tags.map(t => '<span class="tag-chip">#' + escapeHtml(t) + '</span>').join("")
          : "";

        return \`
          <div class="memory-card" onclick="openMemoryDetailModal('\${escapeHtml(m.id)}')">
            <div class="memory-card-header">
              <span class="badge \${scopeBadgeClass}">\${(m.scope || "workflow").toUpperCase()}</span>
              <span class="access-chip">👁️ \${m.accessCount || 0} recalls</span>
            </div>
            <div class="memory-key">\${escapeHtml(m.key)}</div>
            <div class="memory-summary">\${escapeHtml(m.summary)}</div>
            \${targetRef ? '<div class="memory-target-ref">🎯 ' + escapeHtml(targetRef) + '</div>' : ''}
            \${tagsHtml ? '<div class="tags-row">' + tagsHtml + '</div>' : ''}
            <div class="memory-card-footer">
              <span>Updated: \${m.updatedAt ? new Date(m.updatedAt).toLocaleDateString() : "-"}</span>
              <div style="display: flex; gap: 6px;">
                <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); openMemoryDetailModal('\${escapeHtml(m.id)}')">Inspect</button>
                <button class="btn btn-danger btn-sm" onclick="event.stopPropagation(); deleteMemoryItem('\${escapeHtml(m.id)}')">🗑️</button>
              </div>
            </div>
          </div>
        \`;
      }).join("");
    }

    async function openMemoryDetailModal(memoryId, taskId = "") {
      try {
        const query = taskId ? ("?taskId=" + encodeURIComponent(taskId) + "&accessedBy=" + encodeURIComponent(CURRENT_USER)) : "";
        const [memRes, logRes] = await Promise.all([
          fetch("/api/memories/" + encodeURIComponent(memoryId) + query),
          fetch("/api/memories/" + encodeURIComponent(memoryId) + "/access-log")
        ]);

        if (!memRes.ok) throw new Error("Memory not found");
        const memData = await memRes.json();
        currentMemory = memData.memory;

        const logData = logRes.ok ? await logRes.json() : { records: [] };

        document.getElementById("memDetailKey").textContent = currentMemory.key;
        document.getElementById("memDetailScopeBadge").textContent = (currentMemory.scope || "workflow").toUpperCase();
        document.getElementById("memDetailScopeBadge").className = "badge scope-badge-" + (currentMemory.scope || "workflow");
        document.getElementById("memDetailSummary").value = currentMemory.summary || "";
        document.getElementById("memDetailTags").value = (currentMemory.tags || []).join(", ");
        document.getElementById("memDetailContent").value = currentMemory.content || "";
        
        const target = currentMemory.scope === "workflow" ? ("Workflow: " + (currentMemory.workflowId || "global")) :
                       (currentMemory.scope === "node" ? ("Node: " + (currentMemory.nodeId || "-") + " (" + (currentMemory.workflowId || "-") + ")") :
                       (currentMemory.scope === "role" ? ("Role: " + (currentMemory.roleId || "-")) : "-"));
        document.getElementById("memDetailTarget").textContent = target;
        document.getElementById("memDetailAccessCount").textContent = "👁️ " + (currentMemory.accessCount || 0);
        document.getElementById("memDetailSource").textContent = currentMemory.source || "manual";
        document.getElementById("memDetailUpdatedAt").textContent = currentMemory.updatedAt ? new Date(currentMemory.updatedAt).toLocaleString() : "-";

        // Render Access Log Table
        const logBody = document.getElementById("memAccessLogBody");
        const logs = logData.records || [];
        if (logs.length === 0) {
          logBody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-dim);">No access logs recorded.</td></tr>';
        } else {
          logBody.innerHTML = logs.map(l => \`
            <tr>
              <td>\${new Date(l.accessedAt).toLocaleString()}</td>
              <td><span style="color: #60a5fa; font-weight: 500;">\${escapeHtml(l.accessedBy || "unknown")}</span></td>
              <td>\${l.taskId ? ('<code>' + escapeHtml(l.taskId) + '</code>') : '-'}</td>
              <td>\${l.executionId ? ('<code>' + escapeHtml(l.executionId) + '</code>') : '-'}</td>
            </tr>
          \`).join("");
        }

        document.getElementById("memoryDetailModal").classList.add("open");
        loadMemories(); // Refresh access counters
      } catch (err) {
        showToast(err.message, true);
      }
    }

    function closeMemoryDetailModal() {
      document.getElementById("memoryDetailModal").classList.remove("open");
      currentMemory = null;
    }

    async function saveMemoryDetails() {
      if (!currentMemory) return;

      const summary = document.getElementById("memDetailSummary").value.trim();
      const content = document.getElementById("memDetailContent").value.trim();
      const tagsRaw = document.getElementById("memDetailTags").value.trim();
      const tags = tagsRaw ? tagsRaw.split(",").map(t => t.trim()).filter(Boolean) : [];

      if (!summary || !content) {
        showToast("Summary and Content are required.", true);
        return;
      }

      try {
        const payload = {
          key: currentMemory.key,
          scope: currentMemory.scope,
          workflowId: currentMemory.workflowId,
          nodeId: currentMemory.nodeId,
          roleId: currentMemory.roleId,
          summary,
          tags,
          content
        };

        const res = await fetch("/api/memories", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Failed to update memory");
        }

        showToast("Memory saved!");
        closeMemoryDetailModal();
        loadMemories();
      } catch (err) {
        showToast(err.message, true);
      }
    }

    async function deleteCurrentMemory() {
      if (!currentMemory) return;
      deleteMemoryItem(currentMemory.id, true);
    }

    async function deleteMemoryItem(memoryId, closeDetailModal = false) {
      if (!confirm("Are you sure you want to permanently delete this memory?")) return;

      try {
        const res = await fetch("/api/memories/" + encodeURIComponent(memoryId), {
          method: "DELETE"
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Failed to delete memory");
        }

        showToast("Memory deleted");
        if (closeDetailModal) closeMemoryDetailModal();
        loadMemories();
      } catch (err) {
        showToast(err.message, true);
      }
    }

    function openNewMemoryModal() {
      document.getElementById("newMemKey").value = "";
      document.getElementById("newMemScope").value = "workflow";
      document.getElementById("newMemTargetId").value = "";
      document.getElementById("newMemSummary").value = "";
      document.getElementById("newMemTags").value = "";
      document.getElementById("newMemContent").value = "";
      toggleScopeInputs();
      document.getElementById("newMemoryModal").classList.add("open");
      setTimeout(() => document.getElementById("newMemKey").focus(), 50);
    }

    function closeNewMemoryModal() {
      document.getElementById("newMemoryModal").classList.remove("open");
    }

    function toggleScopeInputs() {
      const scope = document.getElementById("newMemScope").value;
      const label = document.getElementById("scopeTargetLabel");
      const input = document.getElementById("newMemTargetId");

      if (scope === "workflow") {
        label.textContent = "Workflow ID (Optional / Global)";
        input.placeholder = "e.g. wf_123456";
      } else if (scope === "node") {
        label.textContent = "Node ID *";
        input.placeholder = "e.g. step_oauth_verify";
      } else if (scope === "role") {
        label.textContent = "Role Name *";
        input.placeholder = "e.g. frontend, backend";
      }
    }

    async function submitNewMemory() {
      const key = document.getElementById("newMemKey").value.trim();
      const scope = document.getElementById("newMemScope").value;
      const targetId = document.getElementById("newMemTargetId").value.trim();
      const summary = document.getElementById("newMemSummary").value.trim();
      const tagsRaw = document.getElementById("newMemTags").value.trim();
      const content = document.getElementById("newMemContent").value.trim();

      if (!key || !summary || !content) {
        showToast("Key, summary, and content are required.", true);
        return;
      }

      const tags = tagsRaw ? tagsRaw.split(",").map(t => t.trim()).filter(Boolean) : [];

      const payload = {
        key,
        scope,
        summary,
        content,
        tags,
        workflowId: scope === "workflow" ? (targetId || undefined) : undefined,
        nodeId: scope === "node" ? targetId : undefined,
        roleId: scope === "role" ? targetId : undefined
      };

      try {
        const res = await fetch("/api/memories", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Failed to create memory");
        }

        showToast("Memory saved to Vault!");
        closeNewMemoryModal();
        loadMemories();
      } catch (err) {
        showToast(err.message, true);
      }
    }

    /* =========================================================================
       3. ROLE JOURNALS IMPLEMENTATION
       ========================================================================= */
    async function loadJournals(showNotification = false) {
      try {
        const res = await fetch("/api/roles");
        if (!res.ok) throw new Error("Failed to load roles");
        const data = await res.json();
        allRoles = data.roles || [];

        updateJournalMetrics();
        renderJournalsGrid();
        if (showNotification) showToast("Role Journals refreshed");
      } catch (err) {
        showToast(err.message, true);
      }
    }

    function updateJournalMetrics() {
      document.getElementById("journalStatRoles").textContent = allRoles.length;
      const activeJournals = allRoles.filter(r => r.journal && r.journal.entry).length;
      document.getElementById("journalStatEntries").textContent = activeJournals;
    }

    function renderJournalsGrid() {
      const grid = document.getElementById("rolesGrid");
      const search = (document.getElementById("journalSearchInput").value || "").toLowerCase().trim();

      const filtered = allRoles.filter(r => {
        if (!search) return true;
        const matchName = (r.name || "").toLowerCase().includes(search);
        const matchDesc = (r.description || "").toLowerCase().includes(search);
        const matchJournal = r.journal && (r.journal.entry || "").toLowerCase().includes(search);
        return matchName || matchDesc || matchJournal;
      });

      if (filtered.length === 0) {
        grid.innerHTML = '<div class="empty-state">No roles found. Click "+ New Role" to create one.</div>';
        return;
      }

      grid.innerHTML = filtered.map(r => {
        const hasJournal = r.journal && r.journal.entry;
        const journalHtml = hasJournal ? \`
          <div class="journal-box">
            <div class="journal-box-header">
              <span>👤 <strong>\${escapeHtml(r.journal.writtenBy || "unknown")}</strong></span>
              <span>🕒 \${new Date(r.journal.updatedAt).toLocaleString()}</span>
            </div>
            <div class="journal-entry-text">\${escapeHtml(r.journal.entry)}</div>
          </div>
        \` : \`
          <div class="journal-box" style="text-align: center; color: var(--text-dim); padding: 20px 10px;">
            No journal snapshot recorded yet for this role.
          </div>
        \`;

        return \`
          <div class="role-card">
            <div class="role-card-header">
              <div class="role-name">
                <span>🏷️</span>
                <span>\${escapeHtml(r.name)}</span>
              </div>
              <span class="badge badge-epic">ROLE</span>
            </div>

            \${r.description ? '<div class="role-desc">' + escapeHtml(r.description) + '</div>' : ''}

            \${journalHtml}

            <div class="role-card-actions">
              <button class="btn btn-secondary btn-sm" onclick="viewRoleTasks('\${escapeHtml(r.name)}')">
                📋 View Role Tasks
              </button>
              <button class="btn btn-sm" onclick="openEditJournalModal('\${escapeHtml(r.name)}', '\${hasJournal ? escapeHtml(r.journal.entry).replace(/'/g, "\\\\'") : ""}')">
                \${hasJournal ? '✏️ Update Journal' : '📝 Write Journal'}
              </button>
            </div>
          </div>
        \`;
      }).join("");
    }

    function viewRoleTasks(roleName) {
      switchMainTab("tasks");
      const select = document.getElementById("roleFilter");
      select.value = roleName;
      applyFilters();
    }

    function openNewRoleModal() {
      document.getElementById("newRoleName").value = "";
      document.getElementById("newRoleDesc").value = "";
      document.getElementById("newRoleModal").classList.add("open");
      setTimeout(() => document.getElementById("newRoleName").focus(), 50);
    }

    function closeNewRoleModal() {
      document.getElementById("newRoleModal").classList.remove("open");
    }

    async function submitNewRole() {
      const name = document.getElementById("newRoleName").value.trim();
      const description = document.getElementById("newRoleDesc").value.trim();

      if (!name) {
        showToast("Role name is required", true);
        return;
      }

      try {
        const res = await fetch("/api/roles", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, description: description || undefined })
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Failed to create role");
        }

        showToast("Role created: " + name);
        closeNewRoleModal();
        loadJournals();
      } catch (err) {
        showToast(err.message, true);
      }
    }

    function openEditJournalModal(roleName, currentEntry = "") {
      document.getElementById("editJournalRoleName").value = roleName;
      document.getElementById("editJournalRoleTitle").textContent = roleName;
      document.getElementById("editJournalAuthor").value = CURRENT_USER;
      document.getElementById("editJournalEntry").value = currentEntry;
      document.getElementById("editJournalModal").classList.add("open");
      setTimeout(() => document.getElementById("editJournalEntry").focus(), 50);
    }

    function closeEditJournalModal() {
      document.getElementById("editJournalModal").classList.remove("open");
    }

    async function submitJournalUpdate() {
      const roleName = document.getElementById("editJournalRoleName").value;
      const writtenBy = document.getElementById("editJournalAuthor").value.trim() || CURRENT_USER;
      const entry = document.getElementById("editJournalEntry").value.trim();

      if (!entry) {
        showToast("Journal entry content is required.", true);
        return;
      }

      try {
        const res = await fetch("/api/journals/" + encodeURIComponent(roleName), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entry, writtenBy })
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Failed to update journal");
        }

        showToast("Journal updated for role " + roleName);
        closeEditJournalModal();
        loadJournals();

        if (currentTask && currentTask.role === roleName) {
          loadTaskContextDetails(currentTask);
        }
      } catch (err) {
        showToast(err.message, true);
      }
    }

    /* Keyboard Shortcuts */
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closeModal();
        closeNewTaskModal();
        closeMemoryDetailModal();
        closeNewMemoryModal();
        closeNewRoleModal();
        closeEditJournalModal();
      }
    });

    document.getElementById("commentInput").addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        postComment();
      }
    });

    // Initial load
    if (currentTab === "memories") {
      loadMemories();
    } else if (currentTab === "journals") {
      loadJournals();
    } else {
      loadTasks();
    }
  </script>
</body>
</html>`;
}

