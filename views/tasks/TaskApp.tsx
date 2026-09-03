import type { VNode } from "preact";
import { KanbanBoard } from "./KanbanBoard.tsx";
import type { TaskCardItem } from "./TaskCard.tsx";
import { TaskModal } from "./TaskModal.tsx";
import type { TaskModalItem, TaskModalMode } from "./TaskModal.tsx";
import { MemoryVault } from "../memory/MemoryVault.tsx";
import type { MemoryCardItem, MemoryMetrics } from "../memory/MemoryVault.tsx";
import { JournalView } from "../journal/JournalView.tsx";
import type { JournalEntry, RoleItem } from "../journal/JournalView.tsx";

// Helper to emit raw event handler attributes in SSR without TypeScript JSX type errors
// deno-lint-ignore no-explicit-any
const rawAttr = (attrs: Record<string, any>): any => attrs;

export interface TaskAppMetrics {
  tasks?: {
    total: number;
    ready: number;
    inProgress: number;
    blocked: number;
  };
  memories?: Partial<MemoryMetrics>;
}

export interface TaskAppProps {
  origin?: string;
  userId?: string;
  userName?: string;
  initialTab?: "tasks" | "memories" | "journals" | string;
  tasks?: TaskCardItem[];
  readyTaskIds?: Set<string> | string[];
  memories?: MemoryCardItem[];
  journalEntries?: JournalEntry[];
  roles?: (RoleItem | string)[];
  availableRoles?: string[];
  metrics?: TaskAppMetrics;
  modalTask?: TaskModalItem | null;
  isTaskModalOpen?: boolean;
  taskModalMode?: TaskModalMode;
  class?: string;
  className?: string;
}

/**
 * Top-level unified view for /tasks, /memories, and /journals assembling:
 * - Header with brand, nav links, user profile, and context-aware action button
 * - Nav tabs (Tasks, Memory Vault, Engineering Journals)
 * - KanbanBoard view
 * - MemoryVault view
 * - JournalView view
 * - TaskModal for inspection and creation
 * - Scoped Memory and Role Journal modals
 * - Toast notification banner
 * - Modular static/js/task_app.js client script initialization
 */
export function TaskApp({
  origin = "",
  userId = "",
  userName = "",
  initialTab = "tasks",
  tasks = [],
  readyTaskIds = new Set<string>(),
  memories = [],
  journalEntries = [],
  roles = [],
  availableRoles,
  metrics,
  modalTask = null,
  isTaskModalOpen = false,
  taskModalMode = "detail",
  class: classProp,
  className,
}: TaskAppProps): VNode {
  const customClass = classProp || className || "";
  const currentTab = initialTab || "tasks";
  const safeUserName = userName || userId || "Guest";
  const safeOrigin = origin.replace(/\/+$/, "");

  // Derive roles list for filters if not provided
  const computedRoles: string[] = availableRoles || (() => {
    const set = new Set<string>();
    for (const t of tasks) {
      if (t.role) set.add(t.role);
    }
    for (const r of roles) {
      const name = typeof r === "string" ? r : r.name;
      if (name) set.add(name);
    }
    for (const j of journalEntries) {
      if (j.role) set.add(j.role);
    }
    return Array.from(set).sort();
  })();

  const headerActionText = currentTab === "memories"
    ? "New Memory"
    : currentTab === "journals"
    ? "New Role"
    : "New Task";

  return (
    <div
      class={`min-h-screen flex flex-col bg-gray-950 text-gray-100 selection:bg-blue-600 selection:text-white ${customClass}`
        .trim()}
      data-origin={safeOrigin}
      data-current-user={safeUserName}
      data-initial-tab={currentTab}
    >
      <style
        dangerouslySetInnerHTML={{
          __html: `
          .main-view.hidden { display: none !important; }
          .modal-backdrop:not(.open) { display: none !important; }
          .modal-backdrop.open { display: flex !important; opacity: 1 !important; pointer-events: auto !important; }
          .toast {
            position: fixed;
            bottom: 24px;
            right: 24px;
            background: #1e293b;
            color: #f8fafc;
            border: 1px solid #334155;
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
            pointer-events: none;
          }
          .toast.show {
            transform: translateY(0);
            opacity: 1;
            pointer-events: auto;
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
          .nav-tab {
            padding: 6px 12px;
            border-radius: 8px;
            font-size: 0.875rem;
            font-weight: 600;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            cursor: pointer;
            border: 1px solid transparent;
            color: #d1d5db;
            background: transparent;
            transition: all 0.15s ease;
          }
          .nav-tab:hover {
            color: #ffffff;
            background: #1f2937;
          }
          .nav-tab.active {
            color: #60a5fa;
            background: rgba(30, 58, 138, 0.6);
            border-color: rgba(30, 64, 175, 0.6);
            box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
          }
        `,
        }}
      />

      {/* Top Application Header */}
      <header class="border-b border-gray-800 bg-gray-900/95 backdrop-blur sticky top-0 z-40">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-4">
          {/* Brand */}
          <div class="flex items-center gap-3">
            <span class="text-2xl" aria-hidden="true">📋</span>
            <div>
              <a
                href="/tasks"
                class="text-lg font-bold text-gray-100 hover:text-blue-400 transition-colors"
              >
                Workflow Tasks
              </a>
              <span class="ml-2 text-xs font-mono text-blue-400 bg-blue-950/70 border border-blue-800/60 px-2 py-0.5 rounded-full">
                v1.0
              </span>
            </div>
          </div>

          {/* Navigation Tabs */}
          <nav class="flex items-center gap-1 sm:gap-2" aria-label="Task Application Views">
            <button
              class={currentTab === "tasks" ? "nav-tab active" : "nav-tab"}
              id="tab-btn-tasks"
              {...rawAttr({ onclick: "switchMainTab('tasks')" })}
            >
              📋 Tasks
            </button>
            <button
              class={currentTab === "memories" ? "nav-tab active" : "nav-tab"}
              id="tab-btn-memories"
              {...rawAttr({ onclick: "switchMainTab('memories')" })}
            >
              🧠 Memory Vault
            </button>
            <button
              class={currentTab === "journals" ? "nav-tab active" : "nav-tab"}
              id="tab-btn-journals"
              {...rawAttr({ onclick: "switchMainTab('journals')" })}
            >
              📖 Engineering Journals
            </button>
            <span class="h-4 w-px bg-gray-800 mx-1 hidden md:inline-block" aria-hidden="true" />
            <a
              href="/"
              class="nav-link px-2.5 py-1.5 rounded-lg text-xs font-medium text-gray-400 hover:text-white hover:bg-gray-800 transition-colors hidden md:inline-flex items-center gap-1"
            >
              ⚡ Dashboard
            </a>
            <a
              href="/visualize"
              class="nav-link px-2.5 py-1.5 rounded-lg text-xs font-medium text-gray-400 hover:text-white hover:bg-gray-800 transition-colors hidden md:inline-flex items-center gap-1"
            >
              📊 Visualize
            </a>
          </nav>

          {/* User Profile & Actions */}
          <div class="flex items-center gap-3">
            <div class="hidden sm:flex items-center gap-2 text-xs text-gray-300 bg-gray-800/70 border border-gray-700/60 rounded-lg px-2.5 py-1.5 font-medium">
              <span class="w-2 h-2 rounded-full bg-emerald-400" />
              <span>{safeUserName}</span>
            </div>
            <button
              id="headerActionBtn"
              class="btn btn-sm inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-500 text-white shadow-sm transition-colors cursor-pointer"
              {...rawAttr({ onclick: "handleHeaderAction()" })}
            >
              <span>➕</span>
              <span id="headerActionBtnText">{headerActionText}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Views Container */}
      <main class="flex-1 flex flex-col">
        {/* 1. Tasks Board View */}
        <div
          id="tasksView"
          class={`main-view flex-1 flex flex-col ${currentTab === "tasks" ? "" : "hidden"}`}
        >
          <KanbanBoard
            tasks={tasks}
            readyTaskIds={readyTaskIds}
            availableRoles={computedRoles}
            showControls
          />
        </div>

        {/* 2. Memory Vault View */}
        <div
          id="memoriesView"
          class={`main-view flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 ${
            currentTab === "memories" ? "" : "hidden"
          }`}
        >
          <MemoryVault
            memories={memories}
            availableRoles={computedRoles}
            metrics={metrics?.memories}
          />
        </div>

        {/* 3. Role Journals View */}
        <div
          id="journalsView"
          class={`main-view flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 ${
            currentTab === "journals" ? "" : "hidden"
          }`}
        >
          <JournalView
            entries={journalEntries}
            roles={roles}
          />
        </div>
      </main>

      {/* Modals */}
      {/* Task Inspection & Detail Modal */}
      <TaskModal
        isOpen
        mode={taskModalMode}
        task={modalTask}
        currentUser={safeUserName}
        class={isTaskModalOpen ? "" : "hidden"}
      />

      {/* Task Creation Modal */}
      <TaskModal
        isOpen
        mode="create"
        currentUser={safeUserName}
        class="hidden"
      />

      {/* Memory Detail & Recall Modal */}
      <div
        class="modal-backdrop fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto hidden"
        id="memoryDetailModal"
        {...rawAttr({ onclick: "if(event.target===this) closeMemoryDetailModal()" })}
      >
        <div class="modal relative w-full max-w-3xl bg-gray-900 border border-gray-800 rounded-xl shadow-2xl flex flex-col overflow-hidden max-h-[90vh]">
          <div class="modal-header flex items-center justify-between px-6 py-4 border-b border-gray-800 bg-gray-900/80">
            <div class="flex items-center gap-2.5">
              <span
                id="memDetailScopeBadge"
                class="badge text-xs font-semibold px-2 py-0.5 rounded uppercase bg-blue-950/60 border border-blue-800/60 text-blue-400"
              >
                WORKFLOW
              </span>
              <span id="memDetailKey" class="font-mono text-sm font-bold text-gray-100">
                key_name
              </span>
            </div>
            <button
              class="btn btn-secondary btn-sm px-2 py-1 text-xs rounded bg-gray-800 hover:bg-gray-700 text-gray-300"
              {...rawAttr({ onclick: "closeMemoryDetailModal()" })}
            >
              ✕
            </button>
          </div>

          <div class="modal-body p-6 overflow-y-auto space-y-4">
            <div class="bg-gray-950 border border-gray-800 rounded-lg p-3.5 space-y-2">
              <div class="form-group flex flex-col gap-1">
                <label class="text-xs font-bold uppercase tracking-wider text-gray-400">
                  Summary
                </label>
                <input
                  type="text"
                  id="memDetailSummary"
                  class="form-control w-full rounded-md bg-gray-900 border border-gray-700 text-gray-100 px-3 py-1.5 text-sm"
                />
              </div>

              <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-gray-400 pt-1">
                <div>
                  Target: <code id="memDetailTarget" class="text-blue-400">-</code>
                </div>
                <div>
                  Accesses:{" "}
                  <span id="memDetailAccessCount" class="text-emerald-400 font-semibold">👁️ 0</span>
                </div>
                <div>
                  Source: <span id="memDetailSource" class="text-gray-300">-</span>
                </div>
                <div>
                  Updated: <span id="memDetailUpdatedAt" class="text-gray-300">-</span>
                </div>
              </div>

              <div class="form-group flex flex-col gap-1 pt-1">
                <label class="text-xs font-bold uppercase tracking-wider text-gray-400">
                  Tags (Comma separated)
                </label>
                <input
                  type="text"
                  id="memDetailTags"
                  class="form-control w-full rounded-md bg-gray-900 border border-gray-700 text-gray-100 px-3 py-1.5 text-xs font-mono"
                  placeholder="tag1, tag2..."
                />
              </div>
            </div>

            <div class="form-group flex flex-col gap-1">
              <label class="text-xs font-bold uppercase tracking-wider text-gray-400">
                Memory Content (Markdown / Text)
              </label>
              <textarea
                id="memDetailContent"
                class="form-control w-full rounded-md bg-gray-950 border border-gray-700 text-gray-200 font-mono text-xs px-3 py-2 min-h-[140px] resize-y"
              />
            </div>

            <div>
              <label class="text-xs font-bold uppercase tracking-wider text-gray-400 block mb-1.5">
                👁️ Access &amp; Recall History Log
              </label>
              <div class="max-h-[120px] overflow-y-auto border border-gray-800 rounded-lg bg-gray-950">
                <table class="w-full text-xs text-left">
                  <thead>
                    <tr class="border-b border-gray-800 text-gray-400 bg-gray-900/60">
                      <th class="p-2">Timestamp</th>
                      <th class="p-2">Accessed By</th>
                      <th class="p-2">Task ID</th>
                      <th class="p-2">Execution ID</th>
                    </tr>
                  </thead>
                  <tbody
                    id="memAccessLogBody"
                    class="divide-y divide-gray-800/60 text-gray-300 font-mono"
                  >
                    <tr>
                      <td colSpan={4} class="p-3 text-center text-gray-500 font-sans">
                        No access logs recorded.
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div class="modal-footer flex items-center justify-between px-6 py-3 border-t border-gray-800 bg-gray-900/80">
            <button
              class="btn btn-danger btn-sm px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-medium cursor-pointer"
              {...rawAttr({ onclick: "deleteCurrentMemory()" })}
            >
              🗑️ Delete Memory
            </button>
            <div class="flex gap-2">
              <button
                class="btn btn-secondary px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-medium cursor-pointer"
                {...rawAttr({ onclick: "closeMemoryDetailModal()" })}
              >
                Cancel
              </button>
              <button
                class="btn px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold cursor-pointer"
                {...rawAttr({ onclick: "saveMemoryDetails()" })}
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* New Memory Modal */}
      <div
        class="modal-backdrop fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto hidden"
        id="newMemoryModal"
        {...rawAttr({ onclick: "if(event.target===this) closeNewMemoryModal()" })}
      >
        <div class="modal relative w-full max-w-lg bg-gray-900 border border-gray-800 rounded-xl shadow-2xl flex flex-col overflow-hidden">
          <div class="modal-header flex items-center justify-between px-6 py-4 border-b border-gray-800 bg-gray-900/80">
            <h3 class="text-base font-bold text-gray-100 flex items-center gap-2">
              <span>🧠</span>
              <span>Save New Memory Item</span>
            </h3>
            <button
              class="btn btn-secondary btn-sm px-2 py-1 text-xs rounded bg-gray-800 hover:bg-gray-700 text-gray-300"
              {...rawAttr({ onclick: "closeNewMemoryModal()" })}
            >
              ✕
            </button>
          </div>

          <div class="modal-body p-6 space-y-3">
            <div class="grid grid-cols-2 gap-3">
              <div class="form-group flex flex-col gap-1">
                <label class="text-xs font-bold uppercase tracking-wider text-gray-400">
                  Scope *
                </label>
                <select
                  id="newMemScope"
                  class="form-control rounded-md bg-gray-950 border border-gray-700 text-gray-100 px-3 py-1.5 text-xs"
                  {...rawAttr({ onchange: "toggleScopeInputs()" })}
                >
                  <option value="workflow">Workflow</option>
                  <option value="node">Node</option>
                  <option value="role">Role</option>
                </select>
              </div>

              <div class="form-group flex flex-col gap-1" id="newMemTargetGroup">
                <label
                  class="text-xs font-bold uppercase tracking-wider text-gray-400"
                  id="newMemTargetLabel"
                >
                  Target (Workflow ID / Role)
                </label>
                <input
                  type="text"
                  id="newMemTarget"
                  class="form-control rounded-md bg-gray-950 border border-gray-700 text-gray-100 px-3 py-1.5 text-xs"
                  placeholder="e.g. backend"
                />
              </div>
            </div>

            <div class="form-group flex flex-col gap-1">
              <label class="text-xs font-bold uppercase tracking-wider text-gray-400">
                Memory Key *
              </label>
              <input
                type="text"
                id="newMemKey"
                class="form-control w-full rounded-md bg-gray-950 border border-gray-700 text-gray-100 px-3 py-1.5 text-sm font-mono"
                placeholder="e.g. auth.jwt_config"
                required
              />
            </div>

            <div class="form-group flex flex-col gap-1">
              <label class="text-xs font-bold uppercase tracking-wider text-gray-400">
                Summary *
              </label>
              <input
                type="text"
                id="newMemSummary"
                class="form-control w-full rounded-md bg-gray-950 border border-gray-700 text-gray-100 px-3 py-1.5 text-sm"
                placeholder="Brief description of this knowledge item"
                required
              />
            </div>

            <div class="form-group flex flex-col gap-1">
              <label class="text-xs font-bold uppercase tracking-wider text-gray-400">
                Content (Markdown / JSON / Notes) *
              </label>
              <textarea
                id="newMemContent"
                class="form-control w-full rounded-md bg-gray-950 border border-gray-700 text-gray-200 font-mono text-xs px-3 py-2 min-h-[120px] resize-y"
                placeholder="Document technical specifications, decisions, code patterns..."
                required
              />
            </div>

            <div class="form-group flex flex-col gap-1">
              <label class="text-xs font-bold uppercase tracking-wider text-gray-400">
                Tags (Comma separated)
              </label>
              <input
                type="text"
                id="newMemTags"
                class="form-control w-full rounded-md bg-gray-950 border border-gray-700 text-gray-100 px-3 py-1.5 text-xs font-mono"
                placeholder="auth, security, architecture"
              />
            </div>
          </div>

          <div class="modal-footer flex items-center justify-end gap-2 px-6 py-3 border-t border-gray-800 bg-gray-900/80">
            <button
              class="btn btn-secondary px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-medium cursor-pointer"
              {...rawAttr({ onclick: "closeNewMemoryModal()" })}
            >
              Cancel
            </button>
            <button
              class="btn px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold cursor-pointer"
              {...rawAttr({ onclick: "submitNewMemory()" })}
            >
              Save Memory
            </button>
          </div>
        </div>
      </div>

      {/* New Role Modal */}
      <div
        class="modal-backdrop fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto hidden"
        id="newRoleModal"
        {...rawAttr({ onclick: "if(event.target===this) closeNewRoleModal()" })}
      >
        <div class="modal relative w-full max-w-md bg-gray-900 border border-gray-800 rounded-xl shadow-2xl flex flex-col overflow-hidden">
          <div class="modal-header flex items-center justify-between px-6 py-4 border-b border-gray-800 bg-gray-900/80">
            <h3 class="text-base font-bold text-gray-100 flex items-center gap-2">
              <span>➕</span>
              <span>Define New Role</span>
            </h3>
            <button
              class="btn btn-secondary btn-sm px-2 py-1 text-xs rounded bg-gray-800 hover:bg-gray-700 text-gray-300"
              {...rawAttr({ onclick: "closeNewRoleModal()" })}
            >
              ✕
            </button>
          </div>

          <div class="modal-body p-6 space-y-3">
            <div class="form-group flex flex-col gap-1">
              <label class="text-xs font-bold uppercase tracking-wider text-gray-400">
                Role Name *
              </label>
              <input
                type="text"
                id="newRoleName"
                class="form-control w-full rounded-md bg-gray-950 border border-gray-700 text-gray-100 px-3 py-1.5 text-sm font-mono"
                placeholder="e.g. backend, frontend, qa, devops"
                required
              />
            </div>

            <div class="form-group flex flex-col gap-1">
              <label class="text-xs font-bold uppercase tracking-wider text-gray-400">
                Description
              </label>
              <textarea
                id="newRoleDesc"
                class="form-control w-full rounded-md bg-gray-950 border border-gray-700 text-gray-200 text-xs px-3 py-2 min-h-[90px] resize-y"
                placeholder="Responsibilities and scope for this role..."
              />
            </div>
          </div>

          <div class="modal-footer flex items-center justify-end gap-2 px-6 py-3 border-t border-gray-800 bg-gray-900/80">
            <button
              class="btn btn-secondary px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-medium cursor-pointer"
              {...rawAttr({ onclick: "closeNewRoleModal()" })}
            >
              Cancel
            </button>
            <button
              class="btn px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold cursor-pointer"
              {...rawAttr({ onclick: "submitNewRole()" })}
            >
              Create Role
            </button>
          </div>
        </div>
      </div>

      {/* Edit Role Journal Modal */}
      <div
        class="modal-backdrop fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto hidden"
        id="editJournalModal"
        {...rawAttr({ onclick: "if(event.target===this) closeEditJournalModal()" })}
      >
        <div class="modal relative w-full max-w-xl bg-gray-900 border border-gray-800 rounded-xl shadow-2xl flex flex-col overflow-hidden">
          <div class="modal-header flex items-center justify-between px-6 py-4 border-b border-gray-800 bg-gray-900/80">
            <div class="flex items-center gap-2">
              <span class="badge text-xs font-semibold px-2 py-0.5 rounded uppercase bg-purple-950/60 border border-purple-800/60 text-purple-400">
                ROLE JOURNAL
              </span>
              <h3 id="editJournalRoleTitle" class="text-base font-bold text-gray-100">
                frontend
              </h3>
            </div>
            <button
              class="btn btn-secondary btn-sm px-2 py-1 text-xs rounded bg-gray-800 hover:bg-gray-700 text-gray-300"
              {...rawAttr({ onclick: "closeEditJournalModal()" })}
            >
              ✕
            </button>
          </div>

          <div class="modal-body p-6 space-y-3">
            <input type="hidden" id="editJournalRoleName" />

            <div class="form-group flex flex-col gap-1">
              <label class="text-xs font-bold uppercase tracking-wider text-gray-400">
                Written By (Author)
              </label>
              <input
                type="text"
                id="editJournalAuthor"
                class="form-control w-full rounded-md bg-gray-950 border border-gray-700 text-gray-100 px-3 py-1.5 text-sm"
                defaultValue={safeUserName}
              />
            </div>

            <div class="form-group flex flex-col gap-1">
              <label class="text-xs font-bold uppercase tracking-wider text-gray-400">
                Journal Entry (Markdown / Progress / Working Handoff)
              </label>
              <textarea
                id="editJournalEntry"
                class="form-control w-full rounded-md bg-gray-950 border border-gray-700 text-gray-200 font-mono text-xs px-3 py-2 min-h-[160px] resize-y"
                placeholder="Record decisions, latest state, and instructions for incoming agents..."
              />
            </div>
          </div>

          <div class="modal-footer flex items-center justify-end gap-2 px-6 py-3 border-t border-gray-800 bg-gray-900/80">
            <button
              class="btn btn-secondary px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-medium cursor-pointer"
              {...rawAttr({ onclick: "closeEditJournalModal()" })}
            >
              Cancel
            </button>
            <button
              class="btn px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold cursor-pointer"
              {...rawAttr({ onclick: "submitJournalUpdate()" })}
            >
              Update Journal
            </button>
          </div>
        </div>
      </div>

      {/* Toast Notification Banner */}
      <div id="toast" class="toast">
        <span id="toastIcon">ℹ️</span>
        <span id="toastMsg">Notification message</span>
      </div>

      {/* Client runtime configuration and modular app script */}
      <script
        dangerouslySetInnerHTML={{
          __html: `
            globalThis.ORIGIN = ${JSON.stringify(safeOrigin).replace(/</g, "\\u003c")};
            globalThis.CURRENT_USER = ${JSON.stringify(safeUserName).replace(/</g, "\\u003c")};
            globalThis.currentTab = ${JSON.stringify(currentTab).replace(/</g, "\\u003c")};
          `,
        }}
      />
      <script src="/static/js/task_app.js" />
    </div>
  );
}
