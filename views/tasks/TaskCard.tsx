import type { JSX, VNode } from "preact";
import { Badge, type TaskPriorityVariant, type TaskStatusVariant } from "../components/index.ts";
import type { TaskPipeline } from "../../store/types.ts";

export interface TaskCardItem {
  id: string;
  title: string;
  description?: string;
  status?: string;
  priority?: string;
  type?: string;
  role?: string;
  assignee?: string;
  context?: string;
  workflowId?: string;
  parentTaskId?: string;
  comments?: Array<{ id?: string; author?: string; content?: string; createdAt?: string }> | number;
  blockedBy?: Array<string | { fromTaskId: string }>;
  blocking?: Array<string | { toTaskId: string }>;
  isBlocked?: boolean;
  isReady?: boolean;
  pipeline?: TaskPipeline;
  createdAt?: string;
  updatedAt?: string;
}

export interface TaskCardProps {
  task: TaskCardItem;
  isReady?: boolean;
  draggable?: boolean;
  onClick?: (taskId: string) => void;
  onDragStart?: (e: JSX.TargetedDragEvent<HTMLDivElement>, taskId: string) => void;
  onDragEnd?: (e: JSX.TargetedDragEvent<HTMLDivElement>) => void;
  class?: string;
  className?: string;
}

const TYPE_BADGE_STYLES: Record<string, string> = {
  task: "bg-cyan-950/70 text-cyan-300 border border-cyan-800/60",
  epic: "bg-purple-950/70 text-purple-300 border border-purple-800/60",
  subtask: "bg-slate-800/80 text-slate-300 border border-slate-700/60",
  bug: "bg-rose-950/80 text-rose-300 border border-rose-800/60",
};

/**
 * TaskCard renders an interactive, draggable Kanban card element with metadata,
 * role tag, priority badge, blocked/frontier status, and click handler.
 */
export function TaskCard({
  task,
  isReady = false,
  draggable = true,
  onClick,
  onDragStart,
  onDragEnd,
  class: classProp,
  className,
}: TaskCardProps): VNode {
  const customClass = classProp || className || "";

  // Comments count resolution
  const commentsCount = Array.isArray(task.comments)
    ? task.comments.length
    : typeof task.comments === "number"
    ? task.comments
    : 0;

  // Blocked status resolution
  const isBlocked = task.status === "blocked" ||
    Boolean(task.isBlocked) ||
    (Array.isArray(task.blockedBy) && task.blockedBy.length > 0);

  // Ready frontier resolution
  const readyFrontier = isReady || Boolean(task.isReady);

  const rawType = (task.type || "task").toLowerCase();
  const typeBadgeClass = TYPE_BADGE_STYLES[rawType] || TYPE_BADGE_STYLES.task;
  const rawPriority = (task.priority || "medium").toLowerCase() as TaskPriorityVariant;
  const rawStatus = (task.status || "open").toLowerCase() as TaskStatusVariant;

  const handleClick = (e: JSX.TargetedMouseEvent<HTMLDivElement>): void => {
    // Avoid triggering card modal if user clicked an interactive child directly
    const target = e.target as HTMLElement | null;
    if (target && target.closest("button, a, input, select, textarea")) {
      return;
    }
    if (onClick) {
      onClick(task.id);
    }
  };

  const handleDragStart = (e: JSX.TargetedDragEvent<HTMLDivElement>): void => {
    if (e.dataTransfer) {
      e.dataTransfer.setData("text/plain", task.id);
      e.dataTransfer.effectAllowed = "move";
    }
    if (onDragStart) {
      onDragStart(e, task.id);
    }
  };

  const handleDragEnd = (e: JSX.TargetedDragEvent<HTMLDivElement>): void => {
    if (onDragEnd) {
      onDragEnd(e);
    }
  };

  return (
    <div
      id={`card-${task.id}`}
      class={`task-card group relative flex flex-col gap-2.5 p-3.5 rounded-xl bg-gray-900/90 border border-gray-800 hover:border-gray-700 hover:bg-gray-850 hover:shadow-lg transition-all duration-150 cursor-pointer select-none ${customClass}`
        .trim()}
      draggable={draggable}
      data-task-id={task.id}
      data-status={task.status || "open"}
      data-priority={task.priority || "medium"}
      data-role={task.role || ""}
      onClick={handleClick}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      {/* Card Top Row: ID, Drag Grip, and Badges */}
      <div class="card-top flex items-center justify-between gap-2">
        <div class="flex items-center gap-1.5 min-w-0">
          {/* Drag Handle */}
          {draggable && (
            <span
              class="drag-handle text-gray-600 group-hover:text-gray-400 transition-colors cursor-grab active:cursor-grabbing text-xs select-none"
              title="Drag task"
              aria-hidden="true"
            >
              ⋮⋮
            </span>
          )}
          <span class="task-id font-mono text-[11px] font-semibold text-gray-400 group-hover:text-sky-400 transition-colors truncate">
            {task.id}
          </span>
        </div>

        <div class="badges-row flex items-center gap-1.5 flex-wrap justify-end">
          {/* Ready Frontier Pill */}
          {readyFrontier && (
            <span
              class="badge inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wide uppercase bg-emerald-950/70 text-emerald-400 border border-emerald-800/60"
              title="Ready Frontier: all dependencies satisfied"
            >
              ⚡ READY
            </span>
          )}

          {/* Blocked Indicator Badge */}
          {isBlocked && task.status !== "blocked" && (
            <span
              class="badge inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wide uppercase bg-rose-950/80 text-rose-400 border border-rose-800/70"
              title="Blocked by dependencies"
            >
              🛑 BLOCKED
            </span>
          )}

          {/* Type Badge */}
          <span
            class={`badge ${typeBadgeClass} px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wide uppercase`}
          >
            {rawType}
          </span>

          {/* Priority Badge */}
          <Badge
            priority={rawPriority}
            size="sm"
            pill={false}
            class={`priority-${rawPriority}`}
          />
        </div>
      </div>

      {/* Card Title */}
      <h4 class="card-title text-sm font-semibold text-gray-100 group-hover:text-white leading-snug line-clamp-2">
        {task.title}
      </h4>

      {/* Card Description Preview */}
      {task.description && (
        <p class="card-desc text-xs text-gray-400 line-clamp-2 leading-relaxed">
          {task.description}
        </p>
      )}

      {/* Role Tag & Pipeline Stage Preview */}
      {(task.role || task.pipeline) && (
        <div class="flex items-center gap-1.5 flex-wrap text-xs">
          {task.role && (
            <span
              class="inline-flex items-center gap-1 font-mono text-[11px] text-indigo-300 bg-indigo-950/60 border border-indigo-800/60 px-2 py-0.5 rounded"
              title={`Role: ${task.role}`}
            >
              <span>🏷️</span>
              <span>@{task.role}</span>
            </span>
          )}
          {task.pipeline && task.pipeline.currentStageId && (
            <span
              class="inline-flex items-center gap-1 font-mono text-[10px] text-purple-300 bg-purple-950/60 border border-purple-800/60 px-1.5 py-0.5 rounded"
              title={`Pipeline stage: ${task.pipeline.currentStageId}`}
            >
              <span>⚡</span>
              <span>stage: {task.pipeline.currentStageId}</span>
            </span>
          )}
        </div>
      )}

      {/* Card Footer: Assignee & Meta Icons */}
      <div class="card-footer flex items-center justify-between pt-2 border-t border-gray-800/70 text-xs text-gray-400 gap-2">
        {/* Assignee */}
        <div class="card-assignee flex items-center gap-1.5 truncate text-sky-400 font-medium">
          {task.assignee
            ? (
              <>
                <span class="w-4 h-4 rounded-full bg-sky-950 border border-sky-800/70 flex items-center justify-center text-[10px] text-sky-300 shrink-0">
                  👤
                </span>
                <span class="truncate text-[11px]">{task.assignee}</span>
              </>
            )
            : <span class="text-[11px] text-gray-500 italic">Unassigned</span>}
        </div>

        {/* Meta Icons: Comments, Dependencies, Status Pill */}
        <div class="card-meta-icons flex items-center gap-2 shrink-0">
          {commentsCount > 0 && (
            <span
              class="comment-count-chip inline-flex items-center gap-1 text-[11px] font-mono text-gray-400 bg-gray-800/60 px-1.5 py-0.5 rounded border border-gray-700/50"
              title={`${commentsCount} comments`}
            >
              <span>💬</span>
              <span>{commentsCount}</span>
            </span>
          )}

          {/* Status Pill */}
          <Badge
            status={rawStatus}
            size="sm"
            pill
          />
        </div>
      </div>
    </div>
  );
}
