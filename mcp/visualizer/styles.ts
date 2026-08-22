/**
 * Modern Dark-Themed Visualizer Stylesheet.
 */

export function getVisualizerStyles(): string {
  return `
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
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background-color: var(--bg-main);
      color: var(--text-main);
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      user-select: none;
    }

    header {
      background: var(--bg-panel);
      border-bottom: 1px solid var(--border-color);
      padding: 10px 18px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      z-index: 20;
      flex-wrap: wrap;
    }

    .header-left { display: flex; flex-direction: column; gap: 4px; }
    .workflow-title-row { display: flex; align-items: center; gap: 10px; }
    .workflow-title { font-size: 1.15rem; font-weight: 700; color: var(--text-main); }
    
    .breadcrumbs { display: flex; align-items: center; gap: 6px; font-size: 0.85rem; color: var(--text-muted); }
    .breadcrumb-item {
      cursor: pointer;
      color: var(--accent);
      text-decoration: none;
      padding: 2px 6px;
      border-radius: 4px;
      transition: background 0.15s ease;
    }
    .breadcrumb-item:hover { background: var(--bg-panel-subtle); color: #fff; }
    .breadcrumb-item.active { color: var(--text-main); font-weight: 600; cursor: default; background: transparent; }

    .header-controls { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

    .search-input {
      background: var(--bg-main);
      border: 1px solid var(--border-color);
      color: var(--text-main);
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 0.85rem;
      width: 170px;
      outline: none;
      transition: all 0.2s ease;
    }
    .search-input:focus { border-color: var(--accent); width: 210px; }

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
    .btn:hover { background: var(--border-color); color: #fff; }
    .btn-primary { background: #0284c7; border-color: var(--accent); color: #fff; }
    .btn-primary:hover { background: var(--accent-hover); }

    .badge {
      font-size: 0.72rem;
      padding: 3px 8px;
      border-radius: 9999px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .badge-ticket { background: #4c1d95; color: #e9d5ff; border: 1px solid #7c3aed; }
    .badge-status-completed { background: #064e3b; color: #6ee7b7; border: 1px solid #059669; }
    .badge-status-running { background: #1e3a8a; color: #93c5fd; border: 1px solid #2563eb; }
    .badge-status-pending { background: #78350f; color: #fcd34d; border: 1px solid #d97706; }
    .badge-status-failed { background: #7f1d1d; color: #fca5a5; border: 1px solid #dc2626; }
    .badge-status-skipped { background: #1e293b; color: #94a3b8; border: 1px solid #475569; }

    .app-main { flex: 1; display: flex; position: relative; overflow: hidden; }

    #svg-canvas-container {
      flex: 1;
      height: 100%;
      background: radial-gradient(circle at center, #1e293b 0%, #0f172a 100%);
      position: relative;
      cursor: grab;
    }
    #svg-canvas-container:active { cursor: grabbing; }

    .canvas-toolbar {
      position: absolute;
      bottom: 20px;
      left: 20px;
      background: rgba(30, 41, 59, 0.9);
      backdrop-filter: blur(8px);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 6px;
      display: flex;
      gap: 4px;
      z-index: 10;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    }

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
      user-select: text;
    }
    #inspector.hidden { transform: translateX(100%); pointer-events: none; }

    .inspector-header {
      padding: 16px 20px;
      border-bottom: 1px solid var(--border-color);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .inspector-title-wrap { display: flex; flex-direction: column; gap: 4px; overflow: hidden; }
    .inspector-node-name { font-size: 1.1rem; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

    .inspector-body { flex: 1; padding: 20px; overflow-y: auto; display: flex; flex-direction: column; gap: 16px; }

    .section-card {
      background: var(--bg-main);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .section-title {
      font-size: 0.78rem;
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
      max-height: 220px;
      overflow-y: auto;
    }
    .error-content {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 0.82rem;
      color: #f87171;
      background: #450a0a;
      border: 1px solid #991b1b;
      border-radius: 6px;
      padding: 8px;
      white-space: pre-wrap;
    }

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
    }
    .drilldown-btn:hover { opacity: 0.9; }

    .wf-node { transition: transform 0.15s ease, opacity 0.15s ease; }
    .wf-node:hover .node-shape { stroke: var(--accent) !important; stroke-width: 3.5px !important; }
    .wf-node.selected-node .node-shape { stroke: #38bdf8 !important; stroke-width: 4px !important; filter: drop-shadow(0 0 10px #38bdf8); }
    .wf-node.dimmed, .wf-edge.dimmed { opacity: 0.15; }
    .wf-node.highlight-search .node-shape { stroke: #eab308 !important; stroke-width: 4px !important; filter: drop-shadow(0 0 10px #eab308); }

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
    #toast.show { opacity: 1; transform: translateY(0); }
  `;
}
