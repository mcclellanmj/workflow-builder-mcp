import type { JSX, VNode } from "preact";
import { useState } from "preact/hooks";
import { Button } from "../components/index.ts";
import { TaskColumn } from "./TaskColumn.tsx";
import type { TaskCardItem } from "./TaskCard.tsx";

export interface KanbanColumnDef {
  status: string;
  title: string;
  dotColor?: string;
}

export interface KanbanBoardProps {
  tasks?: TaskCardItem[];
  readyTaskIds?: Set<string> | string[];
  columns?: KanbanColumnDef[];
  availableRoles?: string[];
  searchQuery?: string;
  selectedRole?: string;
  selectedPriority?: string;
  selectedType?: string;
  readyOnly?: boolean;
  onSearchChange?: (query: string) => void;
  onRoleChange?: (role: string) => void;
  onPriorityChange?: (priority: string) => void;
  onTypeChange?: (type: string) => void;
  onReadyOnlyToggle?: (readyOnly: boolean) => void;
  onTaskClick?: (taskId: string) => void;
  onTaskMove?: (taskId: string, targetStatus: string) => void;
  onNewTask?: () => void;
  onRefresh?: () => void;
  showControls?: boolean;
  class?: string;
  className?: string;
}

export const DEFAULT_KANBAN_COLUMNS: KanbanColumnDef[] = [
  { status: "open", title: "Open / Backlog", dotColor: "#94a3b8" },
  { status: "claimed", title: "Claimed", dotColor: "#06b6d4" },
  { status: "in_progress", title: "In Progress", dotColor: "#3b82f6" },
  { status: "blocked", title: "Blocked", dotColor: "#ef4444" },
  { status: "review", title: "Review", dotColor: "#a855f7" },
  { status: "closed", title: "Closed", dotColor: "#10b981" },
];

/**
 * KanbanBoard renders a complete, responsive Kanban Board interface with metrics bar,
 * multi-attribute filter controls (search, role, priority, type, ready frontier),
 * and drag-and-drop dropzones across customizable or default status lanes.
 */
export function KanbanBoard({
  tasks = [],
  readyTaskIds = new Set<string>(),
  columns = DEFAULT_KANBAN_COLUMNS,
  availableRoles = [],
  searchQuery: initialSearch = "",
  selectedRole: initialRole = "",
  selectedPriority: initialPriority = "",
  selectedType: initialType = "",
  readyOnly: initialReadyOnly = false,
  onSearchChange,
  onRoleChange,
  onPriorityChange,
  onTypeChange,
  onReadyOnlyToggle,
  onTaskClick,
  onTaskMove,
  onNewTask,
  onRefresh,
  showControls = true,
  class: classProp,
  className,
}: KanbanBoardProps): VNode {
  const customClass = classProp || className || "";

  // Local state for interactive filtering
  const [search, setSearch] = useState(initialSearch);
  const [role, setRole] = useState(initialRole);
  const [priority, setPriority] = useState(initialPriority);
  const [type, setType] = useState(initialType);
  const [readyOnly, setReadyOnly] = useState(initialReadyOnly);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);

  const readySet = readyTaskIds instanceof Set
    ? readyTaskIds
    : Array.isArray(readyTaskIds)
    ? new Set(readyTaskIds)
    : new Set<string>();

  // Extract unique roles from tasks + prop
  const allRoles = Array.from(
    new Set([
      ...availableRoles,
      ...tasks.map((t) => t.role).filter((r): r is string => Boolean(r)),
    ]),
  ).sort();

  // Filter tasks
  const filteredTasks = tasks.filter((t) => {
    if (readyOnly && !readySet.has(t.id) && !t.isReady) return false;
    if (role && t.role !== role) return false;
    if (priority && (t.priority || "").toLowerCase() !== priority.toLowerCase()) return false;
    if (type && (t.type || "task").toLowerCase() !== type.toLowerCase()) return false;

    if (search.trim()) {
      const q = search.toLowerCase().trim();
      const matchTitle = (t.title || "").toLowerCase().includes(q);
      const matchDesc = (t.description || "").toLowerCase().includes(q);
      const matchId = (t.id || "").toLowerCase().includes(q);
      const matchAssignee = (t.assignee || "").toLowerCase().includes(q);
      const matchRole = (t.role || "").toLowerCase().includes(q);
      if (!matchTitle && !matchDesc && !matchId && !matchAssignee && !matchRole) {
        return false;
      }
    }
    return true;
  });

  // Calculate metrics
  const totalCount = tasks.length;
  const readyCount = tasks.filter((t) => readySet.has(t.id) || t.isReady).length;
  const inProgressCount = tasks.filter(
    (t) => t.status === "in_progress" || t.status === "claimed",
  ).length;
  const blockedCount = tasks.filter(
    (t) =>
      t.status === "blocked" || t.isBlocked ||
      (Array.isArray(t.blockedBy) && t.blockedBy.length > 0),
  ).length;

  // Group tasks by lane status
  const tasksByStatus: Record<string, TaskCardItem[]> = {};
  columns.forEach((col) => {
    tasksByStatus[col.status] = [];
  });

  filteredTasks.forEach((t) => {
    let lane = (t.status || "open").toLowerCase();
    if (lane === "wontfix") lane = "closed";
    if (!tasksByStatus[lane]) {
      // If task status doesn't match predefined columns, place in open or default
      if (tasksByStatus["open"]) lane = "open";
      else lane = columns[0]?.status || "open";
    }
    tasksByStatus[lane]?.push(t);
  });

  // Filter change handlers
  const handleSearchInput = (e: JSX.TargetedEvent<HTMLInputElement>): void => {
    const val = (e.currentTarget as HTMLInputElement).value;
    setSearch(val);
    onSearchChange?.(val);
  };

  const handleRoleSelect = (e: JSX.TargetedEvent<HTMLSelectElement>): void => {
    const val = (e.currentTarget as HTMLSelectElement).value;
    setRole(val);
    onRoleChange?.(val);
  };

  const handlePrioritySelect = (e: JSX.TargetedEvent<HTMLSelectElement>): void => {
    const val = (e.currentTarget as HTMLSelectElement).value;
    setPriority(val);
    onPriorityChange?.(val);
  };

  const handleTypeSelect = (e: JSX.TargetedEvent<HTMLSelectElement>): void => {
    const val = (e.currentTarget as HTMLSelectElement).value;
    setType(val);
    onTypeChange?.(val);
  };

  const handleReadyToggle = (e: JSX.TargetedEvent<HTMLInputElement>): void => {
    const checked = (e.currentTarget as HTMLInputElement).checked;
    setReadyOnly(checked);
    onReadyOnlyToggle?.(checked);
  };

  // Drag & Drop handlers
  const handleDragOverColumn = (
    _e: JSX.TargetedDragEvent<HTMLDivElement>,
    colStatus: string,
  ): void => {
    setDragOverColumn(colStatus);
  };

  const handleDragLeaveColumn = (): void => {
    setDragOverColumn(null);
  };

  const handleDropColumn = (e: JSX.TargetedDragEvent<HTMLDivElement>, colStatus: string): void => {
    setDragOverColumn(null);
    const taskId = e.dataTransfer?.getData("text/plain");
    if (taskId && onTaskMove) {
      onTaskMove(taskId, colStatus);
    }
  };

  return (
    <div class={`main-view flex flex-col flex-1 min-h-0 ${customClass}`.trim()}>
      {/* Controls & Metrics Bar */}
      {showControls && (
        <div class="controls-bar flex flex-col gap-3 p-4 bg-gray-950 border-b border-gray-800 select-none">
          {/* Metrics Row */}
          <div class="metrics-row flex items-center gap-2.5 flex-wrap text-xs">
            <div class="metric-pill flex items-center gap-2 bg-gray-900 border border-gray-800 rounded-lg px-3 py-1.5 shadow-sm">
              <span class="text-gray-400">Total:</span>
              <span id="statTotal" class="metric-num font-mono font-bold text-gray-100 text-sm">
                {totalCount}
              </span>
            </div>

            <div class="metric-pill flex items-center gap-2 bg-gray-900 border border-emerald-900/60 rounded-lg px-3 py-1.5 shadow-sm">
              <span class="text-emerald-400">⚡ Ready (Frontier):</span>
              <span id="statReady" class="metric-num font-mono font-bold text-emerald-400 text-sm">
                {readyCount}
              </span>
            </div>

            <div class="metric-pill flex items-center gap-2 bg-gray-900 border border-blue-900/60 rounded-lg px-3 py-1.5 shadow-sm">
              <span class="text-sky-400">🏃 In Progress:</span>
              <span id="statInProgress" class="metric-num font-mono font-bold text-sky-400 text-sm">
                {inProgressCount}
              </span>
            </div>

            <div class="metric-pill flex items-center gap-2 bg-gray-900 border border-rose-900/60 rounded-lg px-3 py-1.5 shadow-sm">
              <span class="text-rose-400">🛑 Blocked:</span>
              <span id="statBlocked" class="metric-num font-mono font-bold text-rose-400 text-sm">
                {blockedCount}
              </span>
            </div>
          </div>

          {/* Filters Row */}
          <div class="filters-row flex items-center gap-2.5 flex-wrap text-xs">
            {/* Search Input */}
            <input
              type="text"
              id="searchInput"
              class="search-input flex-1 min-w-[220px] bg-gray-900 border border-gray-800 rounded-md px-3 py-1.5 text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              placeholder="🔍 Search tasks by title, ID, assignee, or role..."
              value={search}
              onInput={handleSearchInput}
            />

            {/* Role Filter */}
            <select
              id="roleFilter"
              class="filter-select bg-gray-900 border border-gray-800 rounded-md px-2.5 py-1.5 text-gray-200 cursor-pointer focus:outline-none focus:border-blue-500"
              value={role}
              onChange={handleRoleSelect}
            >
              <option value="">All Roles</option>
              {allRoles.map((r) => (
                <option key={r} value={r}>
                  @{r}
                </option>
              ))}
            </select>

            {/* Priority Filter */}
            <select
              id="priorityFilter"
              class="filter-select bg-gray-900 border border-gray-800 rounded-md px-2.5 py-1.5 text-gray-200 cursor-pointer focus:outline-none focus:border-blue-500"
              value={priority}
              onChange={handlePrioritySelect}
            >
              <option value="">All Priorities</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>

            {/* Type Filter */}
            <select
              id="typeFilter"
              class="filter-select bg-gray-900 border border-gray-800 rounded-md px-2.5 py-1.5 text-gray-200 cursor-pointer focus:outline-none focus:border-blue-500"
              value={type}
              onChange={handleTypeSelect}
            >
              <option value="">All Types</option>
              <option value="task">Task</option>
              <option value="epic">Epic</option>
              <option value="subtask">Subtask</option>
              <option value="bug">Bug</option>
            </select>

            {/* Ready Only Toggle */}
            <label class="toggle-label flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-gray-900 border border-gray-800 text-gray-300 cursor-pointer hover:border-gray-700">
              <input
                type="checkbox"
                id="readyOnlyToggle"
                checked={readyOnly}
                onChange={handleReadyToggle}
                class="cursor-pointer text-blue-600 rounded bg-gray-800 border-gray-700 focus:ring-0"
              />
              <span>⚡ Ready Only</span>
            </label>

            {/* Refresh Button */}
            {onRefresh && (
              <Button
                variant="secondary"
                size="sm"
                onClick={onRefresh}
                title="Refresh tasks from server"
              >
                <span>🔄</span>
                <span>Refresh</span>
              </Button>
            )}

            {/* New Task Button */}
            {onNewTask && (
              <Button
                variant="primary"
                size="sm"
                onClick={onNewTask}
                title="Create a new task"
              >
                <span>➕</span>
                <span>New Task</span>
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Kanban Board Columns Horizontal Scroll */}
      <main
        id="kanbanBoard"
        class="kanban-board flex-1 flex gap-4 p-5 overflow-x-auto items-start bg-gray-950/40"
      >
        {columns.map((col) => {
          const colTasks = tasksByStatus[col.status] || [];
          const isOver = dragOverColumn === col.status;

          return (
            <TaskColumn
              key={col.status}
              status={col.status}
              title={col.title}
              accentColor={col.dotColor}
              tasks={colTasks}
              count={colTasks.length}
              readyTaskIds={readySet}
              isDragOver={isOver}
              onDragOver={handleDragOverColumn}
              onDragLeave={handleDragLeaveColumn}
              onDrop={handleDropColumn}
              onTaskClick={onTaskClick}
            />
          );
        })}
      </main>
    </div>
  );
}
