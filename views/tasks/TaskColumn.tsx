import type { ComponentChildren, JSX, VNode } from "preact";
import { TaskCard, type TaskCardItem } from "./TaskCard.tsx";
import { EmptyState } from "../components/index.ts";

export interface TaskColumnProps {
  status: string;
  title?: string;
  tasks?: TaskCardItem[];
  count?: number;
  accentColor?: string;
  readyTaskIds?: Set<string> | string[];
  isDragOver?: boolean;
  onDragOver?: (e: JSX.TargetedDragEvent<HTMLDivElement>, status: string) => void;
  onDragLeave?: (e: JSX.TargetedDragEvent<HTMLDivElement>, status?: string) => void;
  onDrop?: (e: JSX.TargetedDragEvent<HTMLDivElement>, status: string) => void;
  onTaskClick?: (taskId: string) => void;
  onTaskDragStart?: (e: JSX.TargetedDragEvent<HTMLDivElement>, taskId: string) => void;
  onTaskDragEnd?: (e: JSX.TargetedDragEvent<HTMLDivElement>) => void;
  children?: ComponentChildren;
  class?: string;
  className?: string;
}

const DEFAULT_STATUS_CONFIG: Record<string, { label: string; dotColor: string }> = {
  open: { label: "Open / Backlog", dotColor: "#94a3b8" },
  claimed: { label: "Claimed", dotColor: "#06b6d4" },
  in_progress: { label: "In Progress", dotColor: "#3b82f6" },
  blocked: { label: "Blocked", dotColor: "#ef4444" },
  review: { label: "Review", dotColor: "#a855f7" },
  closed: { label: "Closed", dotColor: "#10b981" },
  ready: { label: "Ready Frontier", dotColor: "#34d399" },
  wontfix: { label: "Wontfix", dotColor: "#64748b" },
};

/**
 * TaskColumn represents an individual Kanban swimlane containing a status header,
 * item counter badge, dropzone area, and child TaskCards with empty state support.
 */
export function TaskColumn({
  status,
  title,
  tasks = [],
  count,
  accentColor,
  readyTaskIds,
  isDragOver = false,
  onDragOver,
  onDragLeave,
  onDrop,
  onTaskClick,
  onTaskDragStart,
  onTaskDragEnd,
  children,
  class: classProp,
  className,
}: TaskColumnProps): VNode {
  const customClass = classProp || className || "";
  const normalizedStatus = status.toLowerCase();
  const defaultConfig = DEFAULT_STATUS_CONFIG[normalizedStatus] || {
    label: status.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()),
    dotColor: "#64748b",
  };

  const columnTitle = title || defaultConfig.label;
  const dotBg = accentColor || defaultConfig.dotColor;
  const taskCount = count !== undefined ? count : tasks.length;

  const readySet = readyTaskIds instanceof Set
    ? readyTaskIds
    : Array.isArray(readyTaskIds)
    ? new Set(readyTaskIds)
    : undefined;

  const handleDragOver = (e: JSX.TargetedDragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = "move";
    }
    if (onDragOver) {
      onDragOver(e, status);
    }
  };

  const handleDragLeave = (e: JSX.TargetedDragEvent<HTMLDivElement>): void => {
    if (onDragLeave) {
      onDragLeave(e, status);
    }
  };

  const handleDrop = (e: JSX.TargetedDragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    if (onDrop) {
      onDrop(e, status);
    }
  };

  return (
    <div
      class={`kanban-column kanban-col flex flex-col flex-shrink-0 w-80 max-h-[calc(100vh-180px)] rounded-xl bg-gray-950/80 border border-gray-800 shadow-xl overflow-hidden ${customClass}`
        .trim()}
      data-status={status}
    >
      {/* Column Header */}
      <div class="column-header flex items-center justify-between px-4 py-3 border-b border-gray-800 bg-gray-900/60 select-none">
        <div class="column-title-group flex items-center gap-2.5">
          <span
            class="column-dot w-2.5 h-2.5 rounded-full shrink-0 shadow-sm"
            style={{ backgroundColor: dotBg }}
            aria-hidden="true"
          />
          <h3 class="column-title text-xs font-bold uppercase tracking-wider text-gray-200">
            {columnTitle}
          </h3>
        </div>

        <span
          id={`count-${status}`}
          class="column-count font-mono text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-800 text-gray-300 border border-gray-700/60"
        >
          {taskCount}
        </span>
      </div>

      {/* Column Cards Dropzone */}
      <div
        id={`lane-${status}`}
        class={`column-cards flex-1 p-3 overflow-y-auto flex flex-col gap-2.5 min-h-[140px] transition-colors duration-150 ${
          isDragOver
            ? "drag-over bg-blue-950/20 border-2 border-dashed border-blue-500/60 rounded-b-xl"
            : ""
        }`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {children ? children : tasks.length > 0
          ? (
            tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                isReady={readySet ? readySet.has(task.id) : task.isReady}
                onClick={onTaskClick}
                onDragStart={onTaskDragStart}
                onDragEnd={onTaskDragEnd}
              />
            ))
          )
          : (
            <EmptyState
              title="No tasks"
              description={`No items currently in ${columnTitle.toLowerCase()}`}
              class="py-6 text-xs bg-transparent border-dashed border-gray-800/80"
            />
          )}
      </div>
    </div>
  );
}
