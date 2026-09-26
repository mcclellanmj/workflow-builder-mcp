import type { ComponentChildren, VNode } from "preact";
import { Badge } from "../components/Badge.tsx";

export interface BreadcrumbItem {
  label: string;
  href?: string;
  active?: boolean;
}

export interface TicketInfo {
  ticketId: string;
  expiresAt: number | string;
  isActive?: boolean;
}

export interface ExecutionMessageItem {
  id: string;
  executionId: string;
  workflowId: string;
  taskId?: string;
  nodeId?: string;
  author: string;
  role?: string;
  topic?: string;
  content: string;
  createdAt: string;
}

export interface DecisionConfigData {
  field?: string;
  map?: Record<string, string>;
  numericRules?: Array<{ op: string; value: number; condition: string }>;
  default?: string;
}

export interface NodeInspectorData {
  id: string;
  name: string;
  type: string;
  status: "completed" | "running" | "waiting_for_children" | "pending" | "failed" | "skipped" | string;
  isSubagent?: boolean;
  prompt?: string;
  config?: Record<string, unknown>;
  error?: string;
  iterationCount?: number;
  history?: Array<{ iteration: number; timestamp?: string; status: string; result?: unknown }>;
  workflowId?: string;
  updatedAt?: string;
  hasSubworkflow?: boolean;
  subworkflowId?: string;
  joinPolicy?: "all" | "any" | "m_of_n" | string;
  joinThreshold?: number;
  decisionConfig?: DecisionConfigData;
}

export interface LegendItem {
  color: string;
  label: string;
  description?: string;
}

export interface VisualizerFrameProps {
  /** Display title for the workflow */
  workflowName?: string;
  /** Primary workflow ID */
  workflowId?: string;
  /** Whether the visualizer is standalone or embedded */
  isStandalone?: boolean;
  /** Active share ticket info, if limited-time access */
  ticketInfo?: TicketInfo | null;
  /** Navigation breadcrumb chain */
  breadcrumbs?: BreadcrumbItem[];
  /** Pre-selected node inspector data */
  selectedNode?: NodeInspectorData | null;
  /** Controls inspector initial visibility */
  inspectorOpen?: boolean;
  /** Live auto-refresh polling enabled state */
  autoRefresh?: boolean;
  /** Layout orientation (TB = Top-to-Bottom, LR = Left-to-Right) */
  layoutDirection?: "TB" | "LR";
  /** Whether to render legend panel */
  showLegend?: boolean;
  /** Execution message board messages */
  messages?: ExecutionMessageItem[];
  /** Currently active side drawer tab ("inspector" or "messages") */
  activeTab?: "inspector" | "messages";
  /** Event handlers for toolbar buttons */
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onResetZoom?: () => void;
  onFit?: () => void;
  onExport?: (format: "json" | "png") => void;
  onLayoutToggle?: () => void;
  onCloseInspector?: () => void;
  onDrilldownSubworkflow?: (subworkflowId?: string) => void;
  onTabChange?: (tab: "inspector" | "messages") => void;
  /** Custom canvas content or overlays */
  children?: ComponentChildren;
  /** Custom class overrides */
  class?: string;
  className?: string;
}

const DEFAULT_LEGEND_ITEMS: LegendItem[] = [
  { color: "bg-emerald-500", label: "Completed", description: "Node executed successfully" },
  { color: "bg-sky-500", label: "Running", description: "Node currently executing" },
  { color: "bg-indigo-400", label: "Waiting for Children", description: "Awaiting subworkflow or child nodes" },
  { color: "bg-amber-500", label: "Pending", description: "Waiting to execute" },
  { color: "bg-rose-500", label: "Failed", description: "Error during execution" },
  { color: "bg-slate-500", label: "Skipped", description: "Conditional branch bypassed" },
];

/**
 * VisualizerFrame is the Cytoscape workflow canvas shell.
 * It provides:
 * - Header with workflow metadata, breadcrumbs, search, and layout controls
 * - Cytoscape canvas container (#cy-container & #cy)
 * - Floating control toolbar (zoom, fit, export, lock toggle)
 * - Node details inspector drawer (#inspector)
 * - Workflow node status & interaction legend
 * - Toast notification container
 */
export function VisualizerFrame({
  workflowName = "Workflow Visualizer",
  workflowId,
  isStandalone = true,
  ticketInfo,
  breadcrumbs = [],
  selectedNode,
  inspectorOpen = false,
  autoRefresh = true,
  layoutDirection = "TB",
  showLegend = true,
  messages = [],
  activeTab = "inspector",
  onZoomIn,
  onZoomOut,
  onResetZoom,
  onFit,
  onExport,
  onLayoutToggle,
  onCloseInspector,
  onDrilldownSubworkflow,
  onTabChange,
  children,
  class: classProp,
  className,
}: VisualizerFrameProps): VNode {
  const customClass = classProp || className || "";

  const defaultBreadcrumbs: BreadcrumbItem[] = breadcrumbs.length > 0
    ? breadcrumbs
    : [{ label: `🏠 ${workflowName}`, active: true }];

  return (
    <div
      class={`flex flex-col h-screen w-screen overflow-hidden select-none bg-gray-950 text-gray-100 ${customClass}`
        .trim()}
    >
      {/* Top Application Header */}
      <header class="bg-gray-900 border-b border-gray-800 px-4 py-2.5 flex items-center justify-between gap-3 z-20 flex-wrap shadow-md">
        {/* Left: Title, Badges & Breadcrumbs */}
        <div class="flex flex-col gap-1 min-w-0">
          <div class="flex items-center gap-2.5 flex-wrap">
            <span
              id="display-title"
              class="text-base font-bold text-gray-100 truncate max-w-xs md:max-w-md"
            >
              {workflowName}
            </span>
            {isStandalone && (
              <span
                id="display-badge"
                class="px-2 py-0.5 text-xs font-semibold rounded-full border border-sky-400 text-sky-400 tracking-wider uppercase"
              >
                Standalone
              </span>
            )}
            {ticketInfo && (
              <span
                id="ticket-badge"
                class="px-2 py-0.5 text-xs font-semibold rounded-full border border-purple-600 bg-purple-950/60 text-purple-300 tracking-wider uppercase inline-flex items-center gap-1"
                title="This shareable view link is time-limited"
              >
                ⏳ Shared Link (<span id="ticket-timer">Active</span>)
              </span>
            )}
          </div>

          <div
            id="breadcrumb-bar"
            class="flex items-center gap-1.5 text-xs text-gray-400 overflow-x-auto"
          >
            {defaultBreadcrumbs.map((bc, idx) => (
              <span key={idx} class="flex items-center gap-1.5 whitespace-nowrap">
                {idx > 0 && <span class="text-gray-600">/</span>}
                {bc.active
                  ? (
                    <span class="text-gray-200 font-semibold cursor-default">
                      {bc.label}
                    </span>
                  )
                  : (
                    <a
                      href={bc.href ?? "#"}
                      class="text-sky-400 hover:text-sky-300 hover:bg-gray-800 px-1.5 py-0.5 rounded transition-colors duration-150 no-underline"
                    >
                      {bc.label}
                    </a>
                  )}
              </span>
            ))}
          </div>
        </div>

        {/* Right: Search, Filters & Action Controls */}
        <div class="flex items-center gap-2 flex-wrap">
          {/* Node Search Bar */}
          <div class="relative">
            <input
              type="text"
              id="node-search"
              placeholder="🔍 Search nodes / prompts..."
              class="bg-gray-950 border border-gray-700 text-gray-100 placeholder-gray-500 text-xs rounded-md px-3 py-1.5 w-44 focus:w-56 focus:outline-none focus:border-sky-500 transition-all duration-200 shadow-inner"
            />
          </div>

          {/* Status Filter Dropdown */}
          <select
            id="status-filter"
            class="bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-200 text-xs rounded-md px-2.5 py-1.5 focus:outline-none focus:border-sky-500 cursor-pointer shadow-sm"
          >
            <option value="all">Status: All</option>
            <option value="completed">Status: Completed ✅</option>
            <option value="running">Status: Running 🔄</option>
            <option value="waiting_for_children">Status: Waiting for Children ⏸️</option>
            <option value="pending">Status: Pending ⏳</option>
            <option value="failed">Status: Failed ❌</option>
            <option value="skipped">Status: Skipped ⏭️</option>
          </select>

          {/* Layout Orientation Button */}
          <button
            id="layout-toggle-btn"
            type="button"
            onClick={onLayoutToggle}
            title="Toggle Layout Direction (Top-Bottom / Left-Right)"
            class="bg-gray-800 hover:bg-gray-700 active:bg-gray-600 border border-gray-700 text-gray-200 text-xs font-medium rounded-md px-2.5 py-1.5 inline-flex items-center gap-1.5 transition-colors shadow-sm"
          >
            <span>Orientation:</span>
            <span id="layout-dir-label" class="font-bold text-sky-400">
              {layoutDirection}
            </span>
          </button>

          {/* Live Auto-Refresh Button */}
          <button
            id="auto-refresh-btn"
            type="button"
            title="Toggle live auto-refresh execution polling"
            class="bg-gray-800 hover:bg-gray-700 active:bg-gray-600 border border-gray-700 text-gray-200 text-xs font-medium rounded-md px-2.5 py-1.5 inline-flex items-center gap-1.5 transition-colors shadow-sm"
          >
            <span>Live:</span>
            <span
              id="refresh-state-label"
              class={`font-bold ${autoRefresh ? "text-emerald-400" : "text-gray-500"}`}
            >
              {autoRefresh ? "ON" : "OFF"}
            </span>
          </button>

          {/* Message Board Toggle Button */}
          <button
            id="msg-board-toggle-btn"
            type="button"
            onClick={() => onTabChange?.(activeTab === "messages" ? "inspector" : "messages")}
            class="bg-gray-800 hover:bg-gray-700 active:bg-gray-600 border border-gray-700 text-gray-200 text-xs font-medium rounded-md px-2.5 py-1.5 inline-flex items-center gap-1.5 transition-colors shadow-sm"
            title="Toggle Execution Message Board"
          >
            <span>💬 Messages</span>
            <span
              id="header-msg-count"
              class="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-indigo-950 text-indigo-300 border border-indigo-800 font-mono"
            >
              {messages.length}
            </span>
          </button>

          {/* Export Actions */}
          <button
            id="export-png-btn"
            type="button"
            onClick={() => onExport?.("png")}
            title="Export workflow canvas as PNG image"
            class="bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 hover:text-white text-xs font-medium rounded-md px-2.5 py-1.5 inline-flex items-center gap-1 transition-colors shadow-sm"
          >
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
              />
            </svg>
            <span>Export PNG</span>
          </button>

          {/* Fit Viewport Button */}
          <button
            id="fit-btn"
            type="button"
            onClick={onFit}
            title="Fit canvas to viewport"
            class="bg-sky-600 hover:bg-sky-500 active:bg-sky-700 text-white text-xs font-semibold rounded-md px-3 py-1.5 inline-flex items-center gap-1 transition-colors shadow-md"
          >
            <span>Fit Canvas</span>
          </button>
        </div>
      </header>

      {/* Main Workspace Area (Canvas + Overlays + Inspector) */}
      <div class="flex-1 flex relative overflow-hidden app-main">
        {/* Cytoscape Canvas Container */}
        <div
          id="cy-container"
          class="flex-1 h-full relative cursor-grab active:cursor-grabbing bg-[radial-gradient(ellipse_at_center,_#1e293b_0%,_#090d16_100%)]"
        >
          <div id="cy" class="w-full h-full" />

          {/* Floating Canvas Control Toolbar */}
          <div
            class="absolute bottom-5 left-5 bg-gray-900/90 backdrop-blur-md border border-gray-700/80 rounded-lg p-1.5 flex items-center gap-1 z-10 shadow-xl"
            role="toolbar"
            aria-label="Canvas Navigation Toolbar"
          >
            <button
              id="zoom-in-btn"
              type="button"
              onClick={onZoomIn}
              title="Zoom In"
              class="w-7 h-7 flex items-center justify-center rounded bg-gray-800 hover:bg-gray-700 active:bg-gray-600 text-gray-200 text-sm font-bold border border-gray-700/60 transition-colors"
            >
              +
            </button>
            <button
              id="zoom-out-btn"
              type="button"
              onClick={onZoomOut}
              title="Zoom Out"
              class="w-7 h-7 flex items-center justify-center rounded bg-gray-800 hover:bg-gray-700 active:bg-gray-600 text-gray-200 text-sm font-bold border border-gray-700/60 transition-colors"
            >
              -
            </button>
            <button
              id="reset-zoom-btn"
              type="button"
              onClick={onResetZoom}
              title="Reset Zoom to 100%"
              class="px-2 h-7 flex items-center justify-center rounded bg-gray-800 hover:bg-gray-700 active:bg-gray-600 text-gray-200 text-xs font-semibold border border-gray-700/60 transition-colors"
            >
              100%
            </button>
            <div class="w-px h-4 bg-gray-700 mx-0.5" />
            <button
              id="lock-toggle-btn"
              type="button"
              title="Toggle Node Dragging Lock"
              class="px-2 h-7 flex items-center justify-center rounded bg-gray-800 hover:bg-gray-700 active:bg-gray-600 text-gray-200 text-xs font-medium border border-gray-700/60 transition-colors gap-1"
            >
              🔒 Locked
            </button>
          </div>

          {/* Visualizer Legend Overlay */}
          {showLegend && (
            <div
              class="absolute top-4 left-4 bg-gray-900/85 backdrop-blur-md border border-gray-800/90 rounded-lg p-3 z-10 shadow-lg pointer-events-auto max-w-xs transition-opacity duration-200"
              aria-label="Workflow Status Legend"
            >
              <div class="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2 flex items-center justify-between">
                <span>Legend</span>
                <span class="text-[10px] text-gray-500 lowercase font-normal">status</span>
              </div>
              <div class="flex flex-col gap-1.5">
                {DEFAULT_LEGEND_ITEMS.map((item) => (
                  <div key={item.label} class="flex items-center gap-2 text-xs text-gray-300">
                    <span class={`w-2.5 h-2.5 rounded-full ${item.color} shadow-sm shrink-0`} />
                    <span class="font-medium">{item.label}</span>
                    {item.description && (
                      <span class="text-[10px] text-gray-500 truncate ml-auto">
                        {item.description}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Optional canvas child injection */}
          {children}
        </div>

        {/* Node Details Inspector Drawer & Message Board */}
        <aside
          id="inspector"
          class={`absolute top-0 right-0 bottom-0 w-[440px] max-w-[90vw] bg-gray-900 border-l border-gray-800 flex flex-col z-50 shadow-2xl transition-transform duration-300 ease-out select-text ${
            inspectorOpen || selectedNode || activeTab === "messages" ? "" : "hidden translate-x-full pointer-events-none"
          }`}
          aria-label="Node Details Inspector and Message Board"
        >
          {/* Panel Navigation Tabs */}
          <div class="flex items-center border-b border-gray-800 bg-gray-950/70 px-4 pt-2 gap-2">
            <button
              id="tab-btn-inspector"
              type="button"
              onClick={() => onTabChange?.("inspector")}
              class={`px-3 py-2 text-xs font-semibold border-b-2 -mb-px transition-colors inline-flex items-center gap-1.5 ${
                activeTab === "inspector"
                  ? "border-sky-400 text-sky-400"
                  : "border-transparent text-gray-400 hover:text-gray-200"
              }`}
            >
              <span>🔍 Inspector</span>
            </button>
            <button
              id="tab-btn-messages"
              type="button"
              onClick={() => onTabChange?.("messages")}
              class={`px-3 py-2 text-xs font-semibold border-b-2 -mb-px transition-colors inline-flex items-center gap-1.5 ${
                activeTab === "messages"
                  ? "border-sky-400 text-sky-400"
                  : "border-transparent text-gray-400 hover:text-gray-200"
              }`}
            >
              <span>💬 Message Board</span>
              <span
                id="msg-board-count"
                class="px-1.5 py-0.5 rounded-full text-[10px] bg-gray-800 text-gray-300 font-mono"
              >
                {messages.length}
              </span>
            </button>
            <button
              id="close-inspector-btn"
              type="button"
              onClick={onCloseInspector}
              class="ml-auto text-gray-400 hover:text-white p-1 rounded hover:bg-gray-800 transition-colors"
              title="Close Drawer"
            >
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          {/* Tab 1: Node Inspector */}
          <div
            id="tab-content-inspector"
            class={`flex-1 flex flex-col overflow-hidden ${activeTab === "inspector" ? "flex" : "hidden"}`}
          >
            {/* Inspector Header */}
            <div class="px-5 py-4 border-b border-gray-800 flex items-center justify-between gap-3">
              <div class="flex flex-col gap-1.5 overflow-hidden">
                <h2
                  id="insp-name"
                  class="text-sm font-bold text-gray-100 truncate"
                >
                  {selectedNode?.name ?? "Node Details"}
                </h2>
                <div class="flex items-center gap-1.5 flex-wrap">
                  <span
                    id="insp-type-badge"
                    class="px-2 py-0.5 text-[11px] font-medium rounded bg-gray-800 text-sky-400 border border-gray-700 uppercase"
                  >
                    {selectedNode?.type ?? "step"}
                  </span>
                  <span
                    id="insp-status-badge"
                    class="px-2 py-0.5 text-[11px] font-medium rounded bg-gray-800 text-amber-400 border border-amber-900/60 uppercase"
                  >
                    {selectedNode?.status ?? "pending"}
                  </span>
                  <span
                    id="insp-barrier-badge"
                    class={`px-2 py-0.5 text-[11px] font-medium rounded bg-amber-950 text-amber-300 border border-amber-800 uppercase items-center gap-1 ${
                      selectedNode?.joinPolicy ? "inline-flex" : "hidden"
                    }`}
                    title="Barrier Join Policy"
                  >
                    🛡️ Barrier: {selectedNode?.joinPolicy ?? "all"}
                    {selectedNode?.joinPolicy === "m_of_n" && selectedNode?.joinThreshold !== undefined
                      ? ` (${selectedNode.joinThreshold})`
                      : ""}
                  </span>
                  <span
                    id="insp-subagent-badge"
                    class={`px-2 py-0.5 text-[11px] font-medium rounded bg-indigo-950 text-indigo-300 border border-indigo-800 uppercase ${
                      selectedNode?.isSubagent ? "inline-flex" : "hidden"
                    }`}
                  >
                    ⚡ Sub-Agent
                  </span>
                  <span
                    id="insp-subworkflow-badge"
                    class={`px-2 py-0.5 text-[11px] font-medium rounded bg-purple-950 text-purple-300 border border-purple-800 uppercase ${
                      selectedNode?.hasSubworkflow || selectedNode?.subworkflowId || selectedNode?.type === "subworkflow"
                        ? "inline-flex"
                        : "hidden"
                    }`}
                  >
                    📦 Subworkflow
                  </span>
                </div>
              </div>
            </div>

            {/* Inspector Body Content */}
            <div class="flex-1 p-5 overflow-y-auto flex flex-col gap-4 text-xs">
              {/* Subworkflow Drilldown Action */}
              <div
                id="insp-subworkflow-action"
                class={selectedNode?.hasSubworkflow || selectedNode?.subworkflowId || selectedNode?.type === "subworkflow" ? "block" : "hidden"}
              >
                <button
                  id="insp-drilldown-btn"
                  type="button"
                  onClick={() => onDrilldownSubworkflow?.(selectedNode?.subworkflowId || (selectedNode?.config?.childWorkflowId as string))}
                  class="w-full bg-gradient-to-r from-purple-700 to-indigo-600 hover:from-purple-600 hover:to-indigo-500 text-white font-semibold py-2 px-3 rounded-lg shadow-md flex items-center justify-center gap-2 transition-all duration-150"
                >
                  <span>📦 Drill Down into Subworkflow</span>
                  {(selectedNode?.subworkflowId || (selectedNode?.config?.childWorkflowId as string)) && (
                    <span class="font-mono text-purple-200 text-[11px]">
                      ({selectedNode?.subworkflowId || (selectedNode?.config?.childWorkflowId as string)})
                    </span>
                  )}
                </button>
              </div>

              {/* Decision Node Rules & Maps */}
              {(() => {
                const decCfg = selectedNode?.decisionConfig ||
                  (selectedNode?.config as DecisionConfigData | undefined);
                const isDecision = selectedNode?.type === "decision" ||
                  Boolean(decCfg?.field || decCfg?.map || decCfg?.numericRules || decCfg?.default);
                const decField = decCfg?.field;
                const decMap = decCfg?.map;
                const decNumRules = decCfg?.numericRules;
                const decDef = decCfg?.default;

                return (
                  <div
                    id="insp-decision-rules-card"
                    class={isDecision ? "bg-gray-950 border border-amber-900/60 rounded-lg p-3.5 flex flex-col gap-2" : "hidden bg-gray-950 border border-amber-900/60 rounded-lg p-3.5 flex flex-col gap-2"}
                  >
                    <div class="flex items-center justify-between text-[11px] font-bold text-amber-400 uppercase tracking-wider">
                      <span>⚖️ Decision Rules &amp; Maps</span>
                      {decField && <span class="font-mono text-gray-400 lowercase">field: {decField}</span>}
                    </div>
                    <div id="insp-decision-rules-content" class="flex flex-col gap-2 text-xs font-mono">
                      {decMap && Object.keys(decMap).length > 0 && (
                        <div class="flex flex-col gap-1">
                          <span class="text-[10px] text-gray-400 uppercase font-bold tracking-wider">Discrete Map:</span>
                          {Object.entries(decMap).map(([val, target]) => (
                            <div key={val} class="flex items-center justify-between bg-gray-900 px-2 py-1 rounded border border-gray-800">
                              <span class="text-sky-300">{val}</span>
                              <span class="text-gray-500">&rarr;</span>
                              <span class="text-emerald-400 font-semibold">{String(target)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {decNumRules && decNumRules.length > 0 && (
                        <div class="flex flex-col gap-1">
                          <span class="text-[10px] text-gray-400 uppercase font-bold tracking-wider">Numeric Comparison Rules:</span>
                          {decNumRules.map((rule, idx) => (
                            <div key={idx} class="flex items-center justify-between bg-gray-900 px-2 py-1 rounded border border-gray-800">
                              <span class="text-amber-300">{`${rule.op} ${rule.value}`}</span>
                              <span class="text-gray-500">&rarr;</span>
                              <span class="text-emerald-400 font-semibold">{rule.condition}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {decDef && (
                        <div class="text-[11px] text-gray-400 pt-1 border-t border-gray-900 flex justify-between">
                          <span>Default Fallback:</span>
                          <span class="text-sky-400 font-semibold">{decDef}</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* Prompt / Instruction Card */}
              <div class="bg-gray-950 border border-gray-800 rounded-lg p-3.5 flex flex-col gap-2">
                <div class="flex items-center justify-between text-[11px] font-bold text-gray-400 uppercase tracking-wider">
                  <span>📝 Prompt / Instruction</span>
                  <button
                    id="copy-prompt-btn"
                    type="button"
                    class="bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white px-2 py-0.5 rounded text-[11px] transition-colors border border-gray-700/60"
                  >
                    Copy
                  </button>
                </div>
                <div
                  id="insp-prompt"
                  class="font-mono text-xs text-gray-300 bg-gray-900/90 border border-gray-800 rounded p-2.5 max-h-48 overflow-y-auto whitespace-pre-wrap break-words leading-relaxed"
                >
                  {selectedNode?.prompt ?? "No prompt available"}
                </div>
              </div>

              {/* Configuration Card */}
              <div
                id="insp-config-card"
                class="bg-gray-950 border border-gray-800 rounded-lg p-3.5 flex flex-col gap-2"
              >
                <div class="text-[11px] font-bold text-gray-400 uppercase tracking-wider">
                  ⚙️ Configuration
                </div>
                <div
                  id="insp-config-details"
                  class="text-xs text-gray-300 flex flex-col gap-1 font-mono"
                >
                  {selectedNode?.config
                    ? (
                      Object.entries(selectedNode.config).map(([k, v]) => (
                        <div key={k} class="flex justify-between border-b border-gray-900 pb-1">
                          <span class="text-gray-500">{k}:</span>
                          <span class="text-gray-200">{String(v)}</span>
                        </div>
                      ))
                    )
                    : <span class="text-gray-500 italic">No custom config</span>}
                </div>
              </div>

              {/* Execution Status Card */}
              <div
                id="insp-execution-card"
                class="bg-gray-950 border border-gray-800 rounded-lg p-3.5 flex flex-col gap-2"
              >
                <div class="flex items-center justify-between text-[11px] font-bold text-gray-400 uppercase tracking-wider">
                  <span>⚡ Execution Status</span>
                  <span id="insp-iter-count" class="text-sky-400 font-mono text-[11px]">
                    {selectedNode?.iterationCount !== undefined
                      ? `Iter: ${selectedNode.iterationCount}`
                      : ""}
                  </span>
                </div>

                {/* Error Box */}
                <div
                  id="insp-error-wrap"
                  class={selectedNode?.error ? "block" : "hidden"}
                >
                  <div class="text-[11px] text-red-400 font-bold mb-1">Error:</div>
                  <div
                    id="insp-error"
                    class="font-mono text-xs text-red-300 bg-red-950/60 border border-red-800/80 rounded p-2 whitespace-pre-wrap leading-relaxed"
                  >
                    {selectedNode?.error ?? ""}
                  </div>
                </div>

                {/* Iteration History */}
                <div
                  id="insp-history-wrap"
                  class={selectedNode?.history && selectedNode.history.length > 0
                    ? "block mt-2"
                    : "hidden mt-2"}
                >
                  <div class="text-[10px] text-gray-500 font-bold uppercase mb-1.5">
                    Past Iteration History
                  </div>
                  <div id="insp-history-list" class="flex flex-col gap-1.5">
                    {selectedNode?.history?.map((h) => (
                      <div
                        key={h.iteration}
                        class="bg-gray-900 border border-gray-800 rounded p-2 flex items-center justify-between text-xs"
                      >
                        <span class="font-semibold text-gray-300">Iter #{h.iteration}</span>
                        <Badge status={h.status} size="sm" />
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Node Metadata Card */}
              <div class="bg-gray-950 border border-gray-800 rounded-lg p-3.5 flex flex-col gap-2">
                <div class="text-[11px] font-bold text-gray-400 uppercase tracking-wider">
                  ℹ️ Node Metadata
                </div>
                <div class="grid grid-cols-[80px_1fr] gap-1.5 text-xs text-gray-400">
                  <span>Node ID:</span>
                  <span id="insp-node-id" class="font-mono text-gray-200 truncate">
                    {selectedNode?.id ?? ""}
                  </span>
                  <span>Workflow:</span>
                  <span id="insp-wf-id" class="font-mono text-gray-200 truncate">
                    {selectedNode?.workflowId ?? workflowId ?? ""}
                  </span>
                  <span>Updated:</span>
                  <span id="insp-updated-at" class="text-gray-300">
                    {selectedNode?.updatedAt ?? ""}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Tab 2: Message Board */}
          <div
            id="tab-content-messages"
            class={`flex-1 flex flex-col overflow-hidden ${activeTab === "messages" ? "flex" : "hidden"}`}
          >
            {/* Filter Bar */}
            <div class="p-4 border-b border-gray-800 bg-gray-950/60 flex flex-col gap-2.5">
              <input
                type="text"
                id="msg-filter-task"
                placeholder="Filter by Task ID (e.g. tk-123)..."
                class="bg-gray-900 border border-gray-700 text-gray-100 placeholder-gray-500 text-xs rounded-md px-3 py-1.5 w-full focus:outline-none focus:border-sky-500 transition-colors shadow-inner"
              />
              <div class="flex items-center gap-2">
                <input
                  type="text"
                  id="msg-filter-role"
                  placeholder="Filter by Role..."
                  class="bg-gray-900 border border-gray-700 text-gray-100 placeholder-gray-500 text-xs rounded-md px-3 py-1.5 flex-1 focus:outline-none focus:border-sky-500 transition-colors shadow-inner"
                />
                <input
                  type="text"
                  id="msg-filter-topic"
                  placeholder="Filter by Topic..."
                  class="bg-gray-900 border border-gray-700 text-gray-100 placeholder-gray-500 text-xs rounded-md px-3 py-1.5 flex-1 focus:outline-none focus:border-sky-500 transition-colors shadow-inner"
                />
              </div>
            </div>

            {/* Message List */}
            <div
              id="msg-board-list"
              class="flex-1 p-4 overflow-y-auto flex flex-col gap-3"
            >
              {messages.length === 0
                ? (
                  <div class="text-center py-8 text-xs text-gray-500 italic">
                    No messages recorded for this execution.
                  </div>
                )
                : (
                  messages.map((msg) => (
                    <div
                      key={msg.id}
                      class="msg-item bg-gray-950 border border-gray-800 rounded-lg p-3 flex flex-col gap-1.5 text-xs shadow-sm hover:border-gray-700 transition-colors"
                      data-task-id={msg.taskId || ""}
                      data-role={msg.role || ""}
                      data-topic={msg.topic || ""}
                    >
                      <div class="flex items-center justify-between gap-2 flex-wrap">
                        <div class="flex items-center gap-1.5 flex-wrap">
                          <span class="font-bold text-sky-400 font-mono text-[11px]">
                            {msg.author}
                          </span>
                          {msg.role && (
                            <span class="px-1.5 py-0.2 rounded text-[10px] font-mono bg-indigo-950 text-indigo-300 border border-indigo-800">
                              @{msg.role}
                            </span>
                          )}
                          {msg.topic && (
                            <span class="px-1.5 py-0.2 rounded text-[10px] font-mono bg-sky-950 text-sky-300 border border-sky-800">
                              #{msg.topic}
                            </span>
                          )}
                          {msg.taskId && (
                            <span class="px-1.5 py-0.2 rounded text-[10px] font-mono bg-purple-950 text-purple-300 border border-purple-800">
                              📋 {msg.taskId}
                            </span>
                          )}
                        </div>
                        <span class="text-[10px] text-gray-500">
                          {msg.createdAt ? new Date(msg.createdAt).toLocaleTimeString() : ""}
                        </span>
                      </div>
                      <div class="text-gray-200 text-xs whitespace-pre-wrap leading-relaxed font-sans pt-1">
                        {msg.content}
                      </div>
                    </div>
                  ))
                )}
            </div>
          </div>
        </aside>
      </div>

      {/* Floating Toast Notification */}
      <div
        id="toast"
        class="fixed bottom-6 right-6 bg-sky-600 text-white px-4 py-2 rounded-lg text-xs font-semibold shadow-2xl opacity-0 pointer-events-none transition-all duration-200 translate-y-2 z-[100]"
      >
        Copied to clipboard!
      </div>
    </div>
  );
}
