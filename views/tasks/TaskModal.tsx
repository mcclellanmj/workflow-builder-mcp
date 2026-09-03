import type { JSX, VNode } from "preact";
import { Badge, Button, Input } from "../components/index.ts";
import { PipelineProgress } from "./PipelineProgress.tsx";
import type {
  Task,
  TaskComment,
  TaskPipeline,
  TaskPriority,
  TaskStatus,
  TaskType,
} from "../../store/types.ts";

export type TaskModalMode = "create" | "detail" | "edit";

export interface TaskModalItem extends Omit<Partial<Task>, "status" | "priority" | "type"> {
  id?: string;
  title?: string;
  description?: string;
  context?: string;
  status?: TaskStatus | string;
  priority?: TaskPriority | string;
  type?: TaskType | string;
  role?: string;
  assignee?: string;
  workflowId?: string;
  parentTaskId?: string;
  comments?: TaskComment[];
  pipeline?: TaskPipeline;
  createdAt?: string;
  updatedAt?: string;
}

export interface TaskDependencyLinks {
  blockedBy?: Array<{ fromTaskId: string }>;
  blocking?: Array<{ toTaskId: string }>;
}

export interface TaskChildItem {
  id: string;
  title: string;
  status?: string;
}

export interface TaskModalProps {
  isOpen?: boolean;
  mode?: TaskModalMode;
  task?: TaskModalItem | null;
  dependencies?: TaskDependencyLinks;
  childrenTasks?: TaskChildItem[];
  currentUser?: string;
  onClose?: () => void;
  onSave?: (task: TaskModalItem) => void;
  onCreate?: (task: TaskModalItem) => void;
  onDelete?: (taskId: string) => void;
  onAddComment?: (comment: { author: string; content: string }) => void;
  onNavigateTask?: (taskId: string) => void;
  class?: string;
  className?: string;
}

const PRIORITY_OPTIONS = [
  { value: "critical", label: "🔴 Critical" },
  { value: "high", label: "🟠 High" },
  { value: "medium", label: "🔵 Medium" },
  { value: "low", label: "⚪ Low" },
];

const STATUS_OPTIONS = [
  { value: "open", label: "Open / Backlog" },
  { value: "claimed", label: "Claimed" },
  { value: "in_progress", label: "In Progress" },
  { value: "blocked", label: "Blocked" },
  { value: "review", label: "Review" },
  { value: "closed", label: "Closed" },
  { value: "wontfix", label: "Wontfix" },
];

const TYPE_OPTIONS = [
  { value: "task", label: "Task" },
  { value: "epic", label: "Epic" },
  { value: "subtask", label: "Subtask" },
  { value: "bug", label: "Bug" },
];

/**
 * TaskModal provides a comprehensive modal dialog supporting both:
 * 1) Creation of new tasks with title, description, priority, role, type, and assignee.
 * 2) Detailed inspection & editing of existing tasks with live context, pipeline stepper,
 *    dependencies/subtasks tree, comments thread with 256-char composer, and status controls.
 */
export function TaskModal({
  isOpen = false,
  mode = "detail",
  task,
  dependencies,
  childrenTasks = [],
  currentUser = "developer",
  onClose,
  onSave,
  onCreate,
  onDelete,
  onAddComment,
  onNavigateTask,
  class: classProp,
  className,
}: TaskModalProps): VNode {
  const customClass = classProp || className || "";
  const openClass = isOpen ? "open" : "";

  // Handle outside backdrop click to close
  const handleBackdropClick = (e: JSX.TargetedMouseEvent<HTMLDivElement>): void => {
    if (e.target === e.currentTarget && onClose) {
      onClose();
    }
  };

  // =========================================================================
  // 1. CREATE MODE MODAL
  // =========================================================================
  if (mode === "create") {
    const handleCreateSubmit = (e: JSX.TargetedSubmitEvent<HTMLFormElement>): void => {
      e.preventDefault();
      const titleEl = document.getElementById("newTitle") as HTMLInputElement | null;
      const descEl = document.getElementById("newDescription") as HTMLTextAreaElement | null;
      const priorityEl = document.getElementById("newPriority") as HTMLSelectElement | null;
      const typeEl = document.getElementById("newType") as HTMLSelectElement | null;
      const roleEl = document.getElementById("newRole") as HTMLInputElement | null;
      const assigneeEl = document.getElementById("newAssignee") as HTMLInputElement | null;
      const parentEl = document.getElementById("newParentTaskId") as HTMLInputElement | null;

      if (!titleEl || !titleEl.value.trim()) return;

      const newTaskData: TaskModalItem = {
        title: titleEl.value.trim(),
        description: descEl ? descEl.value.trim() : "",
        priority: (priorityEl ? priorityEl.value : "medium") as TaskModalItem["priority"],
        type: (typeEl ? typeEl.value : "task") as TaskModalItem["type"],
        role: roleEl ? roleEl.value.trim() : undefined,
        assignee: assigneeEl ? assigneeEl.value.trim() : undefined,
        parentTaskId: parentEl ? parentEl.value.trim() : undefined,
      };

      if (onCreate) {
        onCreate(newTaskData);
      } else if (onSave) {
        onSave(newTaskData);
      }
    };

    return (
      <div
        id="createTaskModal"
        class={`modal-backdrop fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto ${openClass} ${customClass}`
          .trim()}
        onClick={handleBackdropClick}
        role="dialog"
        aria-modal="true"
      >
        <div
          id="newTaskModal"
          class="modal relative w-full max-w-lg bg-gray-900 border border-gray-800 rounded-xl shadow-2xl flex flex-col overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div class="modal-header flex items-center justify-between px-6 py-4 border-b border-gray-800 bg-gray-900/60">
            <h3 class="text-base font-bold text-gray-100 flex items-center gap-2">
              <span>➕</span>
              <span>Create New Task</span>
            </h3>
            {onClose && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onClose}
                aria-label="Close modal"
                class="text-gray-400 hover:text-white p-1"
              >
                ✕
              </Button>
            )}
          </div>

          {/* Body Form */}
          <form onSubmit={handleCreateSubmit} class="flex flex-col">
            <div class="modal-body p-6 flex flex-col gap-4 overflow-y-auto max-h-[75vh]">
              {/* Title */}
              <Input
                label="Task Title"
                id="newTitle"
                placeholder="e.g. Implement OAuth Flow or Refactor Store"
                required
                defaultValue={task?.title || ""}
              />

              {/* Description */}
              <div class="form-group flex flex-col gap-1.5">
                <label class="text-xs font-medium text-gray-300">Description</label>
                <textarea
                  id="newDescription"
                  class="w-full rounded-md bg-gray-950 border border-gray-700 text-gray-100 placeholder-gray-500 text-sm px-3 py-2 min-h-[5rem] resize-y focus:outline-none focus:border-blue-500"
                  rows={3}
                  placeholder="Details, requirements, and acceptance criteria..."
                  defaultValue={task?.description || ""}
                />
              </div>

              {/* Priority & Type */}
              <div class="grid grid-cols-2 gap-3">
                <div class="form-group flex flex-col gap-1.5">
                  <label class="text-xs font-medium text-gray-300">Priority</label>
                  <select
                    id="newPriority"
                    class="w-full rounded-md bg-gray-950 border border-gray-700 text-gray-100 text-sm px-3 py-2 focus:outline-none focus:border-blue-500"
                    defaultValue={task?.priority || "medium"}
                  >
                    {PRIORITY_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div class="form-group flex flex-col gap-1.5">
                  <label class="text-xs font-medium text-gray-300">Type</label>
                  <select
                    id="newType"
                    class="w-full rounded-md bg-gray-950 border border-gray-700 text-gray-100 text-sm px-3 py-2 focus:outline-none focus:border-blue-500"
                    defaultValue={task?.type || "task"}
                  >
                    {TYPE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Role & Assignee */}
              <div class="grid grid-cols-2 gap-3">
                <Input
                  label="Role"
                  id="newRole"
                  placeholder="e.g. developer, qa"
                  defaultValue={task?.role || ""}
                />

                <Input
                  label="Assignee"
                  id="newAssignee"
                  placeholder="e.g. alice, agent-1"
                  defaultValue={task?.assignee || ""}
                />
              </div>

              {/* Parent Task ID */}
              <Input
                label="Parent Task ID (Optional)"
                id="newParentTaskId"
                placeholder="e.g. tk-000000"
                defaultValue={task?.parentTaskId || ""}
              />
            </div>

            {/* Footer */}
            <div class="modal-footer flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-800 bg-gray-950/60">
              {onClose && (
                <Button variant="secondary" onClick={onClose}>
                  Cancel
                </Button>
              )}
              <Button type="submit" variant="primary">
                Create Task
              </Button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  // =========================================================================
  // 2. DETAIL / EDIT MODE MODAL
  // =========================================================================
  const taskId = task?.id || "tk-000000";
  const rawType = (task?.type || "task").toLowerCase();
  const rawStatus = task?.status || "open";
  const rawPriority = task?.priority || "medium";
  const comments = task?.comments || [];

  const handleDetailSave = (): void => {
    if (!onSave || !task) return;
    const titleEl = document.getElementById("detailTitle") as HTMLInputElement | null;
    const descEl = document.getElementById("detailDescription") as HTMLTextAreaElement | null;
    const contextEl = document.getElementById("detailContext") as HTMLTextAreaElement | null;
    const statusEl = document.getElementById("detailStatus") as HTMLSelectElement | null;
    const priorityEl = document.getElementById("detailPriority") as HTMLSelectElement | null;
    const typeEl = document.getElementById("detailType") as HTMLSelectElement | null;
    const assigneeEl = document.getElementById("detailAssignee") as HTMLInputElement | null;
    const roleEl = document.getElementById("detailRole") as HTMLInputElement | null;
    const workflowIdEl = document.getElementById("detailWorkflowId") as HTMLInputElement | null;
    const parentIdEl = document.getElementById("detailParentTaskId") as HTMLInputElement | null;

    onSave({
      ...task,
      title: titleEl ? titleEl.value.trim() : task.title,
      description: descEl ? descEl.value.trim() : task.description,
      context: contextEl ? contextEl.value.trim() : task.context,
      status: (statusEl ? statusEl.value : task.status) as TaskModalItem["status"],
      priority: (priorityEl ? priorityEl.value : task.priority) as TaskModalItem["priority"],
      type: (typeEl ? typeEl.value : task.type) as TaskModalItem["type"],
      assignee: assigneeEl ? assigneeEl.value.trim() : task.assignee,
      role: roleEl ? roleEl.value.trim() : task.role,
      workflowId: workflowIdEl ? workflowIdEl.value.trim() : task.workflowId,
      parentTaskId: parentIdEl ? parentIdEl.value.trim() : task.parentTaskId,
    });
  };

  const handleCommentSubmit = (e: JSX.TargetedSubmitEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const commentInput = document.getElementById("commentInput") as HTMLTextAreaElement | null;
    const authorInput = document.getElementById("commentAuthor") as HTMLInputElement | null;

    if (!commentInput || !commentInput.value.trim()) return;

    const content = commentInput.value.trim().slice(0, 256);
    const author = (authorInput && authorInput.value.trim()) || currentUser || "Guest";

    if (onAddComment) {
      onAddComment({ author, content });
      commentInput.value = "";
      const counterEl = document.getElementById("commentCharCount");
      if (counterEl) counterEl.textContent = "0 / 256";
    }
  };

  const handleCommentInput = (e: JSX.TargetedEvent<HTMLTextAreaElement>): void => {
    const text = (e.currentTarget as HTMLTextAreaElement).value;
    const counterEl = document.getElementById("commentCharCount");
    if (counterEl) {
      counterEl.textContent = `${text.length} / 256`;
      if (text.length > 240) {
        counterEl.className = "char-counter text-rose-400 font-bold";
      } else if (text.length > 200) {
        counterEl.className = "char-counter text-amber-400 font-medium";
      } else {
        counterEl.className = "char-counter text-gray-400";
      }
    }
  };

  return (
    <div
      id="taskModal"
      class={`modal-backdrop fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto ${openClass} ${customClass}`
        .trim()}
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
    >
      <div
        id="taskDetailModal"
        class="modal relative w-full max-w-4xl bg-gray-900 border border-gray-800 rounded-xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div class="modal-header flex items-center justify-between px-6 py-4 border-b border-gray-800 bg-gray-900/80">
          <div class="flex items-center gap-2.5">
            <span
              id="detailTaskId"
              class="task-id font-mono text-sm font-bold text-sky-400 bg-sky-950/60 border border-sky-800/60 px-2 py-0.5 rounded"
            >
              {taskId}
            </span>
            <span
              id="detailTypeBadge"
              class={`badge badge-${rawType} text-xs font-semibold px-2 py-0.5 rounded uppercase`}
            >
              {rawType}
            </span>
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            aria-label="Close dialog"
            class="text-gray-400 hover:text-white p-1"
          >
            ✕
          </Button>
        </div>

        {/* Modal Body: Two-Column Responsive Layout */}
        <div class="modal-body p-6 overflow-y-auto grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6 text-gray-200">
          {/* Main Column */}
          <div class="flex flex-col gap-4">
            {/* Title */}
            <div class="form-group flex flex-col gap-1.5">
              <label class="text-xs font-bold uppercase tracking-wider text-gray-400">
                Task Title
              </label>
              <input
                type="text"
                id="detailTitle"
                class="form-control w-full rounded-md bg-gray-950 border border-gray-700 text-gray-100 font-semibold text-base px-3 py-2 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30"
                defaultValue={task?.title || ""}
              />
            </div>

            {/* Description */}
            <div class="form-group flex flex-col gap-1.5">
              <label class="text-xs font-bold uppercase tracking-wider text-gray-400">
                Description
              </label>
              <textarea
                id="detailDescription"
                class="form-control w-full rounded-md bg-gray-950 border border-gray-700 text-gray-200 text-sm px-3 py-2 min-h-[75px] resize-y focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30"
                rows={3}
                placeholder="Task description and requirements..."
                defaultValue={task?.description || ""}
              />
            </div>

            {/* Working Context & Notes */}
            <div class="form-group flex flex-col gap-1.5">
              <label class="text-xs font-bold uppercase tracking-wider text-gray-400">
                Working Context &amp; Notes
              </label>
              <textarea
                id="detailContext"
                class="form-control w-full rounded-md bg-gray-950 border border-gray-700 text-gray-200 font-mono text-xs px-3 py-2 min-h-[60px] resize-y focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30"
                rows={2}
                placeholder="Accumulated agent working notes, decisions, progress..."
                defaultValue={task?.context || ""}
              />
            </div>

            {/* Multi-stage Pipeline Progress (if available) */}
            {task?.pipeline && (
              <div class="mt-2">
                <PipelineProgress pipeline={task.pipeline} />
              </div>
            )}

            {/* Context & Role Journal Section */}
            <div id="taskContextSection" class="context-section mt-3 pt-4 border-t border-gray-800">
              <h4 class="context-section-title text-xs font-bold uppercase tracking-wider text-sky-400 flex items-center gap-1.5 mb-2.5">
                <span>🧠</span>
                <span>Context &amp; Role Journal</span>
              </h4>

              <div
                id="taskRoleJournalContainer"
                class="rounded-lg bg-gray-950 border border-gray-800/80 p-3 text-xs"
              >
                {task?.role
                  ? (
                    <div class="context-journal-card flex flex-col gap-1.5">
                      <div class="context-journal-header flex items-center justify-between text-gray-400 text-[11px] pb-1 border-b border-gray-800">
                        <span>
                          <strong>📖 Role Journal:</strong> @{task.role}
                        </span>
                        <span>Active</span>
                      </div>
                      <p class="text-gray-300 italic font-mono text-xs pt-1">
                        Role journal synchronized for role @{task.role}.
                      </p>
                    </div>
                  )
                  : (
                    <p class="text-gray-500 text-xs">
                      Assign a <code>role</code> to view connected working journals and memories.
                    </p>
                  )}
              </div>

              {/* Scoped Memories List Container */}
              <div class="mt-3">
                <span class="text-[11px] font-semibold text-gray-400 uppercase tracking-wider block mb-1.5">
                  Relevant Memories:
                </span>
                <div
                  id="taskMemoriesContainer"
                  class="context-memories-list flex flex-wrap gap-1.5"
                >
                  <span class="text-gray-500 text-xs italic">
                    Memories automatically scoped by role and workflow.
                  </span>
                </div>
              </div>
            </div>

            {/* Dependencies & Child Subtasks Container */}
            <div id="detailDependenciesContainer" class="mt-2 flex flex-col gap-2 text-xs">
              {dependencies && (
                <>
                  {dependencies.blockedBy && dependencies.blockedBy.length > 0 && (
                    <div class="rounded-lg bg-rose-950/40 border border-rose-800/60 p-2.5 text-rose-300">
                      <strong class="text-rose-400">🛑 Blocked by:</strong>{" "}
                      {dependencies.blockedBy.map((d) => (
                        <button
                          key={d.fromTaskId}
                          type="button"
                          class="text-sky-400 hover:underline font-mono font-medium mx-1"
                          onClick={() => onNavigateTask?.(d.fromTaskId)}
                        >
                          {d.fromTaskId}
                        </button>
                      ))}
                    </div>
                  )}

                  {dependencies.blocking && dependencies.blocking.length > 0 && (
                    <div class="rounded-lg bg-amber-950/40 border border-amber-800/60 p-2.5 text-amber-300">
                      <strong class="text-amber-400">⛓️ Blocks:</strong>{" "}
                      {dependencies.blocking.map((d) => (
                        <button
                          key={d.toTaskId}
                          type="button"
                          class="text-sky-400 hover:underline font-mono font-medium mx-1"
                          onClick={() => onNavigateTask?.(d.toTaskId)}
                        >
                          {d.toTaskId}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}

              {childrenTasks && childrenTasks.length > 0 && (
                <div class="rounded-lg bg-gray-950 border border-gray-800 p-2.5">
                  <strong class="text-purple-300 block mb-1.5">
                    📑 Subtasks ({childrenTasks.length}):
                  </strong>
                  <ul class="flex flex-col gap-1 pl-2">
                    {childrenTasks.map((c) => (
                      <li key={c.id} class="flex items-center gap-2">
                        <button
                          type="button"
                          class="text-sky-400 hover:underline font-mono text-xs"
                          onClick={() => onNavigateTask?.(c.id)}
                        >
                          {c.id}
                        </button>
                        <span class="text-gray-300 text-xs truncate">{c.title}</span>
                        {c.status && <Badge status={c.status} size="sm" pill />}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Comments Thread Section */}
            <div class="comments-section mt-4 pt-4 border-t border-gray-800">
              <div class="comments-header flex items-center justify-between mb-3">
                <span class="text-xs font-bold uppercase tracking-wider text-gray-200">
                  💬 Comments (<span id="commentCount">{comments.length}</span>)
                </span>
                <span class="text-[10px] text-gray-500 font-mono">Max 256 chars per comment</span>
              </div>

              {/* Comments List */}
              <div
                id="commentsList"
                class="comments-list flex flex-col gap-2 max-h-52 overflow-y-auto pr-1 mb-3"
              >
                {comments.length > 0
                  ? (
                    comments.map((cmt) => (
                      <div
                        key={cmt.id || `${cmt.author}-${cmt.createdAt}`}
                        class="comment-bubble rounded-lg bg-gray-950 border border-gray-800 p-2.5 text-xs flex flex-col gap-1"
                      >
                        <div class="comment-top flex items-center justify-between text-[11px] text-gray-400">
                          <span class="comment-author font-semibold text-sky-400">
                            {cmt.author}
                          </span>
                          {cmt.createdAt && (
                            <span class="text-gray-500">
                              {new Date(cmt.createdAt).toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                          )}
                        </div>
                        <p class="comment-body text-gray-200 leading-relaxed break-words">
                          {cmt.content}
                        </p>
                      </div>
                    ))
                  )
                  : (
                    <div class="empty-state py-4 text-center text-xs text-gray-500 border border-dashed border-gray-800 rounded-lg">
                      No comments yet. Write a note below!
                    </div>
                  )}
              </div>

              {/* Comment Composer */}
              <form
                onSubmit={handleCommentSubmit}
                class="comment-composer flex flex-col gap-2 p-3 rounded-lg bg-gray-950 border border-gray-800"
              >
                <div class="flex items-center gap-2">
                  <input
                    type="text"
                    id="commentAuthor"
                    class="form-control rounded bg-gray-900 border border-gray-700 text-xs px-2.5 py-1 text-gray-200 w-36"
                    placeholder="Author name"
                    defaultValue={currentUser}
                  />
                </div>

                <textarea
                  id="commentInput"
                  class="form-control w-full rounded bg-gray-900 border border-gray-700 text-xs px-2.5 py-1.5 text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500"
                  rows={2}
                  maxLength={256}
                  placeholder="Write a short and sweet note (max 256 chars)..."
                  onInput={handleCommentInput}
                />

                <div class="composer-meta flex items-center justify-between text-xs text-gray-400 pt-1">
                  <span id="commentCharCount" class="char-counter font-mono text-[11px]">
                    0 / 256
                  </span>
                  <Button type="submit" size="sm" variant="primary">
                    Post Comment
                  </Button>
                </div>
              </form>
            </div>
          </div>

          {/* Sidebar Column: Metadata & Controls */}
          <div class="flex flex-col gap-3.5 bg-gray-950/80 p-4 rounded-xl border border-gray-800 text-xs">
            {/* Status Select */}
            <div class="form-group flex flex-col gap-1">
              <label class="font-bold text-gray-400 uppercase tracking-wider text-[11px]">
                Status
              </label>
              <select
                id="detailStatus"
                class="form-control rounded-md bg-gray-900 border border-gray-700 text-gray-100 px-2.5 py-1.5 text-xs focus:outline-none focus:border-blue-500"
                defaultValue={rawStatus}
              >
                {STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Priority Select */}
            <div class="form-group flex flex-col gap-1">
              <label class="font-bold text-gray-400 uppercase tracking-wider text-[11px]">
                Priority
              </label>
              <select
                id="detailPriority"
                class="form-control rounded-md bg-gray-900 border border-gray-700 text-gray-100 px-2.5 py-1.5 text-xs focus:outline-none focus:border-blue-500"
                defaultValue={rawPriority}
              >
                {PRIORITY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Item Type Select */}
            <div class="form-group flex flex-col gap-1">
              <label class="font-bold text-gray-400 uppercase tracking-wider text-[11px]">
                Item Type
              </label>
              <select
                id="detailType"
                class="form-control rounded-md bg-gray-900 border border-gray-700 text-gray-100 px-2.5 py-1.5 text-xs focus:outline-none focus:border-blue-500"
                defaultValue={rawType}
              >
                {TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Assignee Input */}
            <div class="form-group flex flex-col gap-1">
              <label class="font-bold text-gray-400 uppercase tracking-wider text-[11px]">
                Assignee
              </label>
              <input
                type="text"
                id="detailAssignee"
                class="form-control rounded-md bg-gray-900 border border-gray-700 text-gray-100 px-2.5 py-1.5 text-xs focus:outline-none focus:border-blue-500"
                placeholder="e.g. alice, agent-1"
                defaultValue={task?.assignee || ""}
              />
            </div>

            {/* Role Input */}
            <div class="form-group flex flex-col gap-1">
              <label class="font-bold text-gray-400 uppercase tracking-wider text-[11px]">
                Role
              </label>
              <input
                type="text"
                id="detailRole"
                class="form-control rounded-md bg-gray-900 border border-gray-700 text-gray-100 px-2.5 py-1.5 text-xs focus:outline-none focus:border-blue-500"
                placeholder="e.g. frontend, backend"
                defaultValue={task?.role || ""}
              />
            </div>

            {/* Workflow ID */}
            <div class="form-group flex flex-col gap-1">
              <label class="font-bold text-gray-400 uppercase tracking-wider text-[11px]">
                Workflow ID
              </label>
              <input
                type="text"
                id="detailWorkflowId"
                class="form-control rounded-md bg-gray-900 border border-gray-700 text-gray-100 px-2.5 py-1.5 text-xs focus:outline-none focus:border-blue-500"
                placeholder="e.g. wf_123456"
                defaultValue={task?.workflowId || ""}
              />
            </div>

            {/* Parent Task ID */}
            <div class="form-group flex flex-col gap-1">
              <label class="font-bold text-gray-400 uppercase tracking-wider text-[11px]">
                Parent Task ID
              </label>
              <input
                type="text"
                id="detailParentTaskId"
                class="form-control rounded-md bg-gray-900 border border-gray-700 text-gray-100 px-2.5 py-1.5 text-xs focus:outline-none focus:border-blue-500"
                placeholder="e.g. tk-123456"
                defaultValue={task?.parentTaskId || ""}
              />
            </div>

            {/* Timestamps */}
            <div class="mt-auto pt-3 border-t border-gray-800 text-[10px] text-gray-500 flex flex-col gap-1">
              <div>
                Created: <span id="detailCreatedAt">{task?.createdAt || "-"}</span>
              </div>
              <div>
                Updated: <span id="detailUpdatedAt">{task?.updatedAt || "-"}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div class="modal-footer flex items-center justify-between px-6 py-4 border-t border-gray-800 bg-gray-950/80">
          {onDelete && task?.id
            ? (
              <Button
                variant="danger"
                size="sm"
                onClick={() => onDelete(task.id!)}
              >
                🗑️ Delete Task
              </Button>
            )
            : <div />}

          <div class="flex items-center gap-3">
            {onClose && (
              <Button variant="secondary" onClick={onClose}>
                Cancel
              </Button>
            )}
            <Button variant="primary" onClick={handleDetailSave}>
              Save Changes
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
