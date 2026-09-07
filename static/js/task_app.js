/**
 * Task Board, Memory Vault & Role Journals — Client Application Script
 *
 * Modular client-side logic providing:
 * - Tab navigation (Tasks vs Memory Vault vs Role Journals)
 * - Kanban drag-and-drop workflow with optimistic UI updates and REST sync
 * - Task search and multi-attribute filters (title, priority, role, type, ready status)
 * - Task modals (Creation, Detailed Inspector with dependencies, comments, and context)
 * - Memory Vault CRUD, search, scoping, access logging, and clipboard copy
 * - Role Journals browsing, searching, creation, and updating
 * - Toast notification banner system
 * - Clean event delegation and keyboard shortcuts (Escape, Ctrl+Enter)
 */

(() => {
  "use strict";

  // Global environment and active user configuration
  const _ORIGIN = globalThis.ORIGIN || (document.body && document.body.dataset.origin) ||
    (globalThis.location ? globalThis.location.origin : "");
  const CURRENT_USER = globalThis.CURRENT_USER ||
    (document.body && document.body.dataset.currentUser) || "Guest";
  let currentTab = globalThis.currentTab || (document.body && document.body.dataset.initialTab) ||
    ((globalThis.location && globalThis.location.pathname.replace(/^\//, "")) || "tasks");

  // In-memory data caches
  let allTasks = [];
  let readyTaskIds = new Set();
  let currentTask = null;
  let draggedTaskId = null;

  let allMemories = [];
  let currentMemory = null;

  let allRoles = [];

  /* =========================================================================
     UTILITIES
     ========================================================================= */

  /**
   * Escape HTML entities to prevent XSS.
   */
  function escapeHtml(str) {
    if (str == null) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  /**
   * Display interactive toast feedback notification.
   */
  function showToast(msg, isError = false) {
    const toast = document.getElementById("toast");
    const msgEl = document.getElementById("toastMsg");
    const iconEl = document.getElementById("toastIcon");

    if (!toast) {
      if (isError) console.error("[Toast]", msg);
      else console.log("[Toast]", msg);
      return;
    }

    toast.className = "toast show " + (isError ? "toast-error" : "toast-success");
    if (iconEl) iconEl.textContent = isError ? "⚠️" : "✅";
    if (msgEl) msgEl.textContent = msg;

    if (toast._timer) clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
      toast.className = "toast";
    }, 3500);
  }

  /* =========================================================================
     GLOBAL NAVIGATION & TAB SWITCHING
     ========================================================================= */

  /**
   * Switch active top-level tab (tasks, memories, journals).
   */
  function switchMainTab(tab, updateHistory = true) {
    if (
      updateHistory && typeof updateHistory === "object" &&
      typeof updateHistory.preventDefault === "function"
    ) {
      updateHistory.preventDefault();
      updateHistory = true;
    }
    const safeTab = (tab === "memories" || tab === "journals") ? tab : "tasks";
    currentTab = safeTab;

    // Update navigation buttons
    document.querySelectorAll(".nav-tab").forEach((btn) => btn.classList.remove("active"));
    const activeBtn = document.getElementById("tab-btn-" + safeTab);
    if (activeBtn) activeBtn.classList.add("active");

    // Update header action button label
    const actionText = document.getElementById("headerActionBtnText");
    if (actionText) {
      if (safeTab === "tasks") actionText.textContent = "New Task";
      else if (safeTab === "memories") actionText.textContent = "New Memory";
      else if (safeTab === "journals") actionText.textContent = "New Role";
    }

    // Toggle view containers cleanly
    const tabViews = ["tasksView", "memoriesView", "journalsView"];
    tabViews.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.classList.add("hidden");
    });
    // Ensure any elements with .main-view that match top views are hidden
    document.querySelectorAll(".main-view").forEach((v) => {
      if (tabViews.includes(v.id)) {
        v.classList.add("hidden");
      }
    });

    const activeView = document.getElementById(safeTab + "View");
    if (activeView) {
      activeView.classList.remove("hidden");
      // Safety: ensure any nested containers inside active view don't get stuck hidden
      activeView.querySelectorAll(".main-view.hidden, .kanban-board-container.hidden").forEach(
        (child) => {
          child.classList.remove("hidden");
        },
      );
    }

    if (updateHistory) {
      globalThis.history.pushState({ tab: safeTab }, "", "/" + safeTab);
    }

    // Load corresponding dataset
    if (safeTab === "tasks") loadTasks();
    else if (safeTab === "memories") loadMemories();
    else if (safeTab === "journals") loadJournals();
  }

  /**
   * Delegate header primary action button to the modal for current view.
   */
  function handleHeaderAction() {
    if (currentTab === "tasks") openNewTaskModal();
    else if (currentTab === "memories") openNewMemoryModal();
    else if (currentTab === "journals") openNewRoleModal();
  }

  /* =========================================================================
     1. TASKS KANBAN IMPLEMENTATION
     ========================================================================= */

  /**
   * Fetch all tasks and ready-frontier tasks from API.
   */
  async function loadTasks(showNotification = false) {
    const openLane = document.getElementById("lane-open");
    if (openLane && allTasks.length === 0) {
      openLane.innerHTML = `
        <div class="flex flex-col items-center justify-center p-8 text-center text-gray-400 gap-2">
          <div class="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
          <span class="text-xs font-medium">Loading tasks...</span>
        </div>
      `;
    }
    try {
      const [tasksRes, readyRes] = await Promise.all([
        fetch("/api/tasks"),
        fetch("/api/tasks/ready"),
      ]);

      if (!tasksRes.ok) throw new Error("Failed to load tasks");

      const tasksData = await tasksRes.json();
      const readyData = await readyRes.json();

      allTasks = tasksData.tasks || [];
      readyTaskIds = new Set((readyData.tasks || []).map((t) => t.id));

      populateRoleFilter();
      renderBoard();
      if (showNotification) showToast("Tasks refreshed");
    } catch (err) {
      showToast(err.message, true);
      if (openLane && allTasks.length === 0) {
        openLane.innerHTML = `
          <div class="flex flex-col items-center justify-center p-6 text-center text-rose-400 gap-2">
            <span class="text-xl">⚠️</span>
            <span class="text-xs font-medium">${escapeHtml(err.message)}</span>
            <button type="button" class="btn btn-sm px-2.5 py-1 text-xs bg-gray-800 hover:bg-gray-700 text-gray-200 rounded mt-1" onclick="loadTasks(true)">Retry</button>
          </div>
        `;
      }
    }
  }

  /**
   * Populate unique roles into roleFilter dropdown.
   */
  function populateRoleFilter() {
    const select = document.getElementById("roleFilter");
    if (!select) return;
    const currentVal = select.value;
    const roles = Array.from(new Set(allTasks.map((t) => t.role).filter(Boolean))).sort();

    select.innerHTML = '<option value="">All Roles</option>' +
      roles.map((r) => '<option value="' + escapeHtml(r) + '">' + escapeHtml(r) + "</option>").join(
        "",
      );
    select.value = currentVal;
  }

  /**
   * Trigger board re-render based on filter changes.
   */
  function applyFilters() {
    renderBoard();
  }

  /**
   * Filter in-memory tasks based on current filter control values.
   */
  function getFilteredTasks() {
    const searchEl = document.getElementById("searchInput");
    const roleEl = document.getElementById("roleFilter");
    const priorityEl = document.getElementById("priorityFilter");
    const typeEl = document.getElementById("typeFilter");
    const readyOnlyEl = document.getElementById("readyOnlyToggle");

    const query = (searchEl ? searchEl.value : "").toLowerCase().trim();
    const roleFilter = roleEl ? roleEl.value : "";
    const priorityFilter = priorityEl ? priorityEl.value : "";
    const typeFilter = typeEl ? typeEl.value : "";
    const readyOnly = readyOnlyEl ? readyOnlyEl.checked : false;

    return allTasks.filter((task) => {
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
        const matchTags = Array.isArray(task.tags) &&
          task.tags.some((t) => String(t).toLowerCase().includes(query));
        if (!matchTitle && !matchDesc && !matchId && !matchAssignee && !matchRole && !matchTags) {
          return false;
        }
      }
      return true;
    });
  }

  /**
   * Render Kanban columns and task cards.
   */
  function renderBoard() {
    const lanes = {
      open: document.getElementById("lane-open"),
      claimed: document.getElementById("lane-claimed"),
      in_progress: document.getElementById("lane-in_progress"),
      blocked: document.getElementById("lane-blocked"),
      review: document.getElementById("lane-review"),
      closed: document.getElementById("lane-closed"),
    };

    if (!lanes.open) return; // Tasks view might not be active

    const counts = {
      open: 0,
      claimed: 0,
      in_progress: 0,
      blocked: 0,
      review: 0,
      closed: 0,
    };

    Object.values(lanes).forEach((lane) => {
      if (lane) lane.innerHTML = "";
    });

    const filtered = getFilteredTasks();

    const statTotal = document.getElementById("statTotal");
    const statReady = document.getElementById("statReady");
    const statInProgress = document.getElementById("statInProgress");
    const statBlocked = document.getElementById("statBlocked");

    if (statTotal) statTotal.textContent = allTasks.length;
    if (statReady) statReady.textContent = readyTaskIds.size;
    if (statInProgress) {
      statInProgress.textContent = allTasks.filter((t) =>
        t.status === "in_progress" || t.status === "claimed"
      ).length;
    }
    if (statBlocked) {
      statBlocked.textContent = allTasks.filter((t) => t.status === "blocked").length;
    }

    filtered.forEach((task) => {
      let laneKey = task.status || "open";
      if (laneKey === "wontfix") laneKey = "closed";
      if (!lanes[laneKey]) laneKey = "open";

      counts[laneKey]++;
      if (lanes[laneKey]) {
        lanes[laneKey].appendChild(createTaskCard(task));
      }
    });

    Object.keys(lanes).forEach((k) => {
      if (counts[k] === 0 && lanes[k]) {
        const empty = document.createElement("div");
        empty.className =
          "flex flex-col items-center justify-center p-6 text-center text-gray-500 rounded-lg border border-dashed border-gray-800/80 my-2";
        empty.innerHTML = `<span class="text-xs font-medium">No tasks in this lane</span>`;
        lanes[k].appendChild(empty);
      }
    });

    Object.keys(counts).forEach((k) => {
      const el = document.getElementById("count-" + k);
      if (el) el.textContent = counts[k];
    });
  }

  /**
   * Build a draggable Kanban card element for a task.
   */
  function createTaskCard(task) {
    const card = document.createElement("div");
    card.className =
      "task-card group relative flex flex-col gap-2.5 p-3.5 rounded-xl bg-gray-900/90 border border-gray-800 hover:border-gray-700 hover:bg-gray-850 hover:shadow-lg transition-all duration-150 cursor-pointer select-none";
    card.draggable = true;
    card.id = "card-" + task.id;

    card.ondragstart = (e) => {
      handleDragStart(e, task.id);
    };

    card.ondragend = (e) => {
      handleDragEnd(e);
    };

    card.onclick = () => openTaskDetails(task.id);

    const isReady = readyTaskIds.has(task.id);
    const commentsCount = (task.comments && Array.isArray(task.comments))
      ? task.comments.length
      : 0;

    const typeStyle = task.type === "epic"
      ? "bg-purple-950/70 text-purple-300 border border-purple-800/60"
      : (task.type === "bug"
        ? "bg-rose-950/80 text-rose-300 border border-rose-800/60"
        : (task.type === "subtask"
          ? "bg-slate-800/80 text-slate-300 border border-slate-700/60"
          : "bg-cyan-950/70 text-cyan-300 border border-cyan-800/60"));

    const priorityStyle = task.priority === "critical"
      ? "bg-red-950/80 text-red-300 border border-red-800/60"
      : (task.priority === "high"
        ? "bg-amber-950/80 text-amber-300 border border-amber-800/60"
        : (task.priority === "low"
          ? "bg-slate-800/80 text-slate-400 border border-slate-700/60"
          : "bg-blue-950/80 text-blue-300 border border-blue-800/60"));

    card.innerHTML = `
      <div class="flex items-center justify-between gap-2">
        <span class="font-mono text-xs font-semibold text-blue-400">
          ${escapeHtml(task.id)}
        </span>
        <div class="flex items-center gap-1.5 flex-wrap">
          ${
      isReady
        ? '<span class="inline-flex items-center gap-1 font-medium select-none bg-emerald-950/70 text-emerald-300 border border-emerald-800/70 px-2 py-0.5 text-[11px] rounded-full" title="Ready frontier">⚡ READY</span>'
        : ""
    }
          <span class="inline-flex items-center gap-1 font-medium uppercase select-none px-2 py-0.5 text-[11px] rounded-full ${typeStyle}">
            ${escapeHtml(task.type || "task")}
          </span>
          <span class="inline-flex items-center gap-1 font-medium uppercase select-none px-2 py-0.5 text-[11px] rounded-full ${priorityStyle}">
            ${escapeHtml(task.priority || "medium")}
          </span>
        </div>
      </div>
      <h4 class="text-sm font-medium text-gray-100 leading-snug line-clamp-2">
        ${escapeHtml(task.title)}
      </h4>
      ${
      task.description
        ? `<p class="text-xs text-gray-400 line-clamp-2 leading-relaxed">${
          escapeHtml(task.description)
        }</p>`
        : ""
    }
      <div class="flex items-center justify-between gap-2 pt-2 border-t border-gray-800/80 text-xs text-gray-400">
        <div class="flex items-center gap-1.5 min-w-0">
          ${
      task.assignee
        ? `<span class="inline-flex items-center gap-1 text-gray-300"><span>👤</span><span class="truncate font-mono">${
          escapeHtml(task.assignee)
        }</span></span>`
        : (task.role
          ? `<span class="inline-flex items-center gap-1 bg-indigo-950/60 text-indigo-300 border border-indigo-800/60 px-2 py-0.5 text-[10px] rounded-full font-mono uppercase">@${
            escapeHtml(task.role)
          }</span>`
          : '<span class="text-gray-500 italic">Unassigned</span>')
    }
        </div>
        ${
      commentsCount > 0
        ? `<span class="inline-flex items-center gap-1 text-[11px] text-gray-400 bg-gray-800/70 border border-gray-700/60 px-1.5 py-0.5 rounded">💬 ${commentsCount}</span>`
        : ""
    }
      </div>
    `;

    return card;
  }

  /* Drag & Drop Event Handlers */
  function handleDragStart(e, taskId) {
    draggedTaskId = taskId;
    if (e.currentTarget) e.currentTarget.classList.add("dragging");
    if (e.dataTransfer) {
      e.dataTransfer.setData("text/plain", taskId);
      e.dataTransfer.effectAllowed = "move";
    }
  }

  function handleDragEnd(e) {
    draggedTaskId = null;
    if (e.currentTarget) e.currentTarget.classList.remove("dragging");
    document.querySelectorAll(".column-cards.drag-over").forEach((el) =>
      el.classList.remove("drag-over")
    );
  }

  function handleDragOver(e) {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    if (e.currentTarget) e.currentTarget.classList.add("drag-over");
  }

  function handleDragLeave(e) {
    if (e.currentTarget) e.currentTarget.classList.remove("drag-over");
  }

  async function handleDrop(e, targetStatus) {
    e.preventDefault();
    if (e.currentTarget) e.currentTarget.classList.remove("drag-over");
    const taskId = (e.dataTransfer && e.dataTransfer.getData("text/plain")) || draggedTaskId;
    if (!taskId) return;

    const task = allTasks.find((t) => t.id === taskId);
    if (!task || task.status === targetStatus) return;

    // Optimistic UI update
    const previousStatus = task.status;
    task.status = targetStatus;
    renderBoard();

    try {
      const res = await fetch("/api/tasks/" + encodeURIComponent(taskId), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: targetStatus }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to update status");
      }
      showToast("Task " + taskId + " moved to " + targetStatus);
      loadTasks();
    } catch (err) {
      task.status = previousStatus;
      renderBoard();
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
      document.getElementById("detailTypeBadge").textContent = (currentTask.type || "task")
        .toUpperCase();
      document.getElementById("detailTypeBadge").className = "badge badge-" +
        (currentTask.type || "task");
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
      document.getElementById("detailCreatedAt").textContent = currentTask.createdAt
        ? new Date(currentTask.createdAt).toLocaleString()
        : "-";
      document.getElementById("detailUpdatedAt").textContent = currentTask.updatedAt
        ? new Date(currentTask.updatedAt).toLocaleString()
        : "-";

      renderComments(currentTask.comments || []);
      renderDependencies(data.dependencies, data.children);

      // Fetch and render context-aware Role Journal & Scoped Memories
      loadTaskContextDetails(currentTask);

      const modalEl = document.getElementById("taskModal") ||
        document.getElementById("taskDetailModal");
      if (modalEl) modalEl.classList.add("open");
      const innerModal = document.getElementById("taskDetailModal");
      if (innerModal) innerModal.classList.add("open");
      resetCommentComposer();
    } catch (err) {
      showToast(err.message, true);
    }
  }

  async function loadTaskContextDetails(task) {
    const journalContainer = document.getElementById("taskRoleJournalContainer");
    const memContainer = document.getElementById("taskMemoriesContainer");

    // 1. Role Journal Snapshot
    if (task.role && journalContainer) {
      journalContainer.innerHTML =
        '<div style="color: var(--text-dim); font-size: 0.8rem;">Loading journal for role "' +
        escapeHtml(task.role) + '"...</div>';
      try {
        const jRes = await fetch("/api/journals/" + encodeURIComponent(task.role));
        if (jRes.ok) {
          const jData = await jRes.json();
          if (jData.journal && jData.journal.entry) {
            journalContainer.innerHTML = `
              <div class="context-journal-card">
                <div class="context-journal-header">
                  <span><strong>📖 Role Journal:</strong> ${escapeHtml(task.role)}</span>
                  <span>👤 ${escapeHtml(jData.journal.writtenBy || "unknown")} • 🕒 ${
              new Date(jData.journal.updatedAt).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })
            }</span>
                </div>
                <div class="journal-entry-text">${escapeHtml(jData.journal.entry)}</div>
                <div style="margin-top: 8px;">
                  <button class="btn btn-secondary btn-sm" onclick="openEditJournalModal('${
              escapeHtml(task.role)
            }', '${
              escapeHtml(jData.journal.entry).replace(/'/g, "\\'")
            }')">✏️ Update Role Journal</button>
                </div>
              </div>
            `;
          } else {
            journalContainer.innerHTML = `
              <div class="context-journal-card" style="display: flex; justify-content: space-between; align-items: center;">
                <span style="font-size: 0.8rem; color: var(--text-dim);">No active journal entry for role "<strong>${
              escapeHtml(task.role)
            }</strong>".</span>
                <button class="btn btn-secondary btn-sm" onclick="openEditJournalModal('${
              escapeHtml(task.role)
            }', '')">📝 Write Entry</button>
              </div>
            `;
          }
        } else {
          journalContainer.innerHTML =
            '<div style="font-size: 0.8rem; color: var(--text-dim);">No role journal found.</div>';
        }
      } catch (_) {
        journalContainer.innerHTML =
          '<div style="font-size: 0.8rem; color: var(--text-dim);">Could not load role journal.</div>';
      }
    } else if (journalContainer) {
      journalContainer.innerHTML =
        '<div style="font-size: 0.8rem; color: var(--text-dim);">Assign a <code>role</code> to view its working journal.</div>';
    }

    // 2. Scoped Memories
    if (memContainer) {
      memContainer.innerHTML =
        '<div style="color: var(--text-dim); font-size: 0.8rem;">Searching relevant memories...</div>';
      try {
        const queryParams = new URLSearchParams();
        if (task.role) queryParams.set("roleId", task.role);
        if (task.workflowId) queryParams.set("workflowId", task.workflowId);

        const mRes = await fetch("/api/memories?" + queryParams.toString());
        if (mRes.ok) {
          const mData = await mRes.json();
          const memories = mData.memories || [];
          if (memories.length > 0) {
            memContainer.innerHTML = memories.map((m) => `
              <div class="context-mem-chip" onclick="openMemoryDetailModal('${
              escapeHtml(m.id)
            }', '${escapeHtml(task.id)}')" title="${escapeHtml(m.summary)}">
                <span class="badge scope-badge-${escapeHtml(m.scope)}">${
              escapeHtml(m.scope.toUpperCase())
            }</span>
                <strong>${escapeHtml(m.key)}</strong>
                <span style="color: #34d399; font-size: 0.72rem;">👁️ ${m.accessCount || 0}</span>
              </div>
            `).join("");
          } else {
            memContainer.innerHTML =
              '<div style="font-size: 0.8rem; color: var(--text-dim);">No scoped memories found for this task.</div>';
          }
        }
      } catch (_) {
        memContainer.innerHTML =
          '<div style="font-size: 0.8rem; color: var(--text-dim);">Could not load memories.</div>';
      }
    }
  }

  function refreshTaskContextDetails() {
    if (currentTask) {
      const roleEl = document.getElementById("detailRole");
      currentTask.role = roleEl ? (roleEl.value.trim() || undefined) : undefined;
      loadTaskContextDetails(currentTask);
    }
  }

  function renderDependencies(dependencies, children) {
    const container = document.getElementById("detailDependenciesContainer");
    if (!container) return;
    let html = "";

    if (dependencies && (dependencies.blocking?.length > 0 || dependencies.blockedBy?.length > 0)) {
      html +=
        '<div style="background: #090d16; border: 1px solid var(--border); border-radius: 6px; padding: 8px 12px; margin-bottom: 10px;">';
      if (dependencies.blockedBy && dependencies.blockedBy.length > 0) {
        html +=
          '<div style="color: #f87171; margin-bottom: 4px;"><strong>🛑 Blocked by:</strong> ' +
          dependencies.blockedBy.map((d) =>
            '<a href="javascript:void(0)" onclick="openTaskDetails(\'' + escapeHtml(d.fromTaskId) +
            '\')" style="color: #60a5fa; text-decoration: none; margin-right: 6px;">' +
            escapeHtml(d.fromTaskId) + "</a>"
          ).join(", ") + "</div>";
      }
      if (dependencies.blocking && dependencies.blocking.length > 0) {
        html += '<div style="color: #fbbf24;"><strong>⛓️ Blocks:</strong> ' +
          dependencies.blocking.map((d) =>
            '<a href="javascript:void(0)" onclick="openTaskDetails(\'' + escapeHtml(d.toTaskId) +
            '\')" style="color: #60a5fa; text-decoration: none; margin-right: 6px;">' +
            escapeHtml(d.toTaskId) + "</a>"
          ).join(", ") + "</div>";
      }
      html += "</div>";
    }

    if (children && children.length > 0) {
      html +=
        '<div style="background: #090d16; border: 1px solid var(--border); border-radius: 6px; padding: 8px 12px;">';
      html += '<div style="color: #c084fc; margin-bottom: 4px;"><strong>📑 Child Subtasks (' +
        children.length + "):</strong></div>";
      html += '<ul style="padding-left: 16px; margin: 0;">';
      children.forEach((c) => {
        html += '<li><a href="javascript:void(0)" onclick="openTaskDetails(\'' + escapeHtml(c.id) +
          '\')" style="color: #60a5fa; text-decoration: none;">' + escapeHtml(c.title) + " (" +
          escapeHtml(c.id) + ')</a> - <span style="font-size: 0.75rem; color: var(--text-dim);">' +
          escapeHtml(c.status) + "</span></li>";
      });
      html += "</ul></div>";
    }

    container.innerHTML = html;
  }

  function renderComments(comments) {
    const list = document.getElementById("commentsList");
    const countEl = document.getElementById("commentCount");
    if (countEl) countEl.textContent = comments.length;
    if (!list) return;

    if (!comments || comments.length === 0) {
      list.innerHTML =
        '<div class="empty-state">No comments yet. Be the first to leave a note!</div>';
      return;
    }

    list.innerHTML = comments.map((c) => `
      <div class="comment-bubble">
        <div class="comment-top">
          <span class="comment-author">${escapeHtml(c.author || "anonymous")}</span>
          <span>${
      c.createdAt
        ? new Date(c.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        : ""
    }</span>
        </div>
        <div class="comment-body">${escapeHtml(c.content)}</div>
      </div>
    `).join("");

    list.scrollTop = list.scrollHeight;
  }

  function updateCharCounter() {
    const input = document.getElementById("commentInput");
    const counter = document.getElementById("commentCharCount");
    if (!input || !counter) return;

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
    const input = document.getElementById("commentInput");
    if (input) input.value = "";
    updateCharCounter();
  }

  async function postComment() {
    if (!currentTask) return;
    const input = document.getElementById("commentInput");
    const authorInput = document.getElementById("commentAuthor");

    const text = input ? input.value.trim() : "";
    const author = authorInput ? (authorInput.value.trim() || CURRENT_USER) : CURRENT_USER;

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
        body: JSON.stringify({ content: text, author }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
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

    const titleEl = document.getElementById("detailTitle");
    const title = titleEl ? titleEl.value.trim() : "";
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
      parentTaskId: document.getElementById("detailParentTaskId").value.trim() || undefined,
    };

    try {
      const res = await fetch("/api/tasks/" + encodeURIComponent(currentTask.id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
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
    if (!confirm("Are you sure you want to permanently delete task " + currentTask.id + "?")) {
      return;
    }

    try {
      const res = await fetch("/api/tasks/" + encodeURIComponent(currentTask.id), {
        method: "DELETE",
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
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
    const modal = document.getElementById("taskModal") ||
      document.getElementById("taskDetailModal");
    if (modal) modal.classList.remove("open");
    const inner = document.getElementById("taskDetailModal");
    if (inner) inner.classList.remove("open");
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
    const modal = document.getElementById("createTaskModal") ||
      document.getElementById("newTaskModal");
    if (modal) modal.classList.add("open");
    const inner = document.getElementById("newTaskModal");
    if (inner) inner.classList.add("open");
    setTimeout(() => {
      const titleInput = document.getElementById("newTitle");
      if (titleInput) titleInput.focus();
    }, 50);
  }

  function closeNewTaskModal() {
    const modal = document.getElementById("createTaskModal") ||
      document.getElementById("newTaskModal");
    if (modal) modal.classList.remove("open");
    const inner = document.getElementById("newTaskModal");
    if (inner) inner.classList.remove("open");
  }

  async function submitNewTask() {
    const titleEl = document.getElementById("newTitle");
    const title = titleEl ? titleEl.value.trim() : "";
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
      parentTaskId: document.getElementById("newParentTaskId").value.trim() || undefined,
    };

    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
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

  /**
   * Fetch all memories from Memory Vault API.
   */
  async function loadMemories(showNotification = false) {
    const grid = document.getElementById("memoriesGrid");
    if (grid && allMemories.length === 0) {
      grid.innerHTML = `
        <div class="flex flex-col items-center justify-center p-12 text-center text-gray-400 gap-3">
          <div class="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
          <p class="text-sm font-medium">Loading Memory Vault records...</p>
        </div>
      `;
    }
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
      if (grid && allMemories.length === 0) {
        grid.innerHTML = `
          <div class="flex flex-col items-center justify-center p-12 text-center text-rose-400 gap-3 bg-gray-900/40 rounded-xl border border-rose-900/30">
            <span class="text-3xl">⚠️</span>
            <p class="text-sm font-medium">Failed to load memories: ${escapeHtml(err.message)}</p>
            <button type="button" class="btn btn-sm btn-secondary px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs mt-2" onclick="loadMemories(true)">Retry</button>
          </div>
        `;
      }
    }
  }

  function updateMemoryMetrics() {
    const statTotal = document.getElementById("memStatTotal");
    const statWf = document.getElementById("memStatWorkflow");
    const statNode = document.getElementById("memStatNode");
    const statRole = document.getElementById("memStatRole");
    const statAccess = document.getElementById("memStatAccessCount");

    if (statTotal) statTotal.textContent = allMemories.length;
    if (statWf) statWf.textContent = allMemories.filter((m) => m.scope === "workflow").length;
    if (statNode) statNode.textContent = allMemories.filter((m) => m.scope === "node").length;
    if (statRole) statRole.textContent = allMemories.filter((m) => m.scope === "role").length;

    const totalAccess = allMemories.reduce((sum, m) => sum + (m.accessCount || 0), 0);
    if (statAccess) statAccess.textContent = totalAccess;
  }

  function formatValuePreview(raw) {
    if (raw === undefined || raw === null) return { isJson: false, text: "" };
    const str = typeof raw === "object" ? JSON.stringify(raw, null, 2) : String(raw);
    const trimmed = str.trim();
    if (
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    ) {
      try {
        const parsed = JSON.parse(trimmed);
        return { isJson: true, text: JSON.stringify(parsed, null, 2) };
      } catch {
        // Fall through to plain text
      }
    }
    return { isJson: false, text: trimmed };
  }

  function formatTimestamp(isoString) {
    if (!isoString) return "-";
    try {
      const d = new Date(isoString);
      if (isNaN(d.getTime())) return isoString;
      return d.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return isoString;
    }
  }

  function getRoleColor(role) {
    const normalized = (role || "").toLowerCase();
    if (normalized.includes("dev") || normalized.includes("engineer")) {
      return { bg: "bg-blue-950/70", text: "text-blue-400", border: "border-blue-800/60" };
    }
    if (normalized.includes("arch") || normalized.includes("lead")) {
      return { bg: "bg-purple-950/70", text: "text-purple-400", border: "border-purple-800/60" };
    }
    if (normalized.includes("review") || normalized.includes("qa") || normalized.includes("test")) {
      return { bg: "bg-emerald-950/70", text: "text-emerald-400", border: "border-emerald-800/60" };
    }
    if (normalized.includes("sec") || normalized.includes("ops")) {
      return { bg: "bg-rose-950/70", text: "text-rose-400", border: "border-rose-800/60" };
    }
    return { bg: "bg-indigo-950/70", text: "text-indigo-400", border: "border-indigo-800/60" };
  }

  function filterMemoriesByRole(roleId) {
    const roleSelect = document.getElementById("memory-role-select");
    if (roleSelect) {
      roleSelect.value = roleId;
    }
    renderMemoriesGrid();
  }

  let activeJournalRoleTab = "all";

  function filterJournalsByRole(roleName) {
    activeJournalRoleTab = roleName || "all";
    updateJournalTabsUi(activeJournalRoleTab);
    renderJournalsGrid();
  }

  function updateJournalTabsUi(selectedTabId) {
    const nav = document.querySelector('nav[aria-label="Role Journal Tabs"]');
    if (!nav) return;
    const buttons = nav.querySelectorAll("button");
    buttons.forEach((btn) => {
      const tabId = btn.getAttribute("data-tab-id") ||
        (btn.textContent.includes("All Roles")
          ? "all"
          : btn.textContent.trim().replace(/^@/, "").split(/\s+/)[0]);
      const isActive =
        (selectedTabId === "all" && (tabId === "all" || btn.textContent.includes("All Roles"))) ||
        tabId.toLowerCase() === selectedTabId.toLowerCase();
      if (isActive) {
        btn.setAttribute("aria-current", "true");
        btn.className =
          "group inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors duration-150 select-none whitespace-nowrap focus:outline-none border-blue-500 text-blue-400 font-semibold";
      } else {
        btn.removeAttribute("aria-current");
        btn.className =
          "group inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors duration-150 select-none whitespace-nowrap focus:outline-none border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-600";
      }
    });
  }

  function getFilteredMemories() {
    const searchEl = document.getElementById("memory-search-input") ||
      document.getElementById("memSearchInput");
    const scopeEl = document.getElementById("memory-scope-select") ||
      document.getElementById("memScopeFilter");
    const roleEl = document.getElementById("memory-role-select");
    const tagEl = document.getElementById("memTagFilter");

    const search = (searchEl ? searchEl.value : "").toLowerCase().trim();
    const scopeFilter = scopeEl ? scopeEl.value : "";
    const roleFilter = (roleEl ? roleEl.value : "").toLowerCase().trim();
    const tagFilter = (tagEl ? tagEl.value : "").toLowerCase().trim();

    return allMemories.filter((m) => {
      if (scopeFilter && m.scope !== scopeFilter) return false;
      if (roleFilter && (m.roleId || "").toLowerCase() !== roleFilter) return false;

      if (tagFilter) {
        if (!m.tags || !m.tags.some((t) => t.toLowerCase().includes(tagFilter))) {
          return false;
        }
      }

      if (search) {
        const matchKey = (m.key || "").toLowerCase().includes(search);
        const matchSummary = (m.summary || "").toLowerCase().includes(search);
        const matchWorkflow = (m.workflowId || "").toLowerCase().includes(search);
        const matchNode = (m.nodeId || "").toLowerCase().includes(search);
        const matchRole = (m.roleId || "").toLowerCase().includes(search);
        const matchContent = (m.content || m.value || "").toLowerCase().includes(search);
        const matchTags = m.tags && Array.isArray(m.tags) &&
          m.tags.some((t) => t.toLowerCase().includes(search));
        if (
          !matchKey && !matchSummary && !matchWorkflow && !matchNode && !matchRole &&
          !matchContent && !matchTags
        ) {
          return false;
        }
      }

      return true;
    });
  }

  function renderMemoriesGrid() {
    const grid = document.getElementById("memoriesGrid");
    if (!grid) return;
    const filtered = getFilteredMemories();

    if (filtered.length === 0) {
      const isFiltered = Boolean(
        (document.getElementById("memory-search-input") ||
          document.getElementById("memSearchInput"))?.value ||
          (document.getElementById("memory-scope-select") ||
            document.getElementById("memScopeFilter"))?.value ||
          document.getElementById("memory-role-select")?.value,
      );
      grid.innerHTML = `
        <div class="flex flex-col items-center justify-center p-12 text-center text-gray-400 gap-3 bg-gray-900/40 rounded-xl border border-gray-800">
          <span class="text-3xl">${isFiltered ? "🔍" : "🧠"}</span>
          <h3 class="text-base font-semibold text-gray-200">${
        isFiltered ? "No matching memories" : "No memories found"
      }</h3>
          <p class="text-sm text-gray-400 max-w-md">${
        isFiltered
          ? "No memories matched your search query or scope filter. Try clearing filters or searching for another term."
          : "The Memory Vault has no saved records yet. Save your first memory to persist knowledge across task runs and engineering roles."
      }</p>
          ${
        !isFiltered
          ? `
            <button type="button" class="btn btn-sm btn-primary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-500 text-white shadow-sm transition-colors cursor-pointer mt-2" onclick="openNewMemoryModal()">
              <span>➕</span>
              <span>Save First Memory</span>
            </button>
          `
          : ""
      }
        </div>
      `;
      return;
    }

    const cardsHtml = filtered.map((m) => {
      const rawContent = m.content ?? m.value ?? "";
      const preview = formatValuePreview(rawContent);
      const timeLabel = formatTimestamp(m.updatedAt || m.createdAt);

      const scope = m.scope || (m.roleId ? "role" : "workflow");
      const targetRef = m.workflowId
        ? ("Workflow: " + m.workflowId)
        : (m.nodeId ? ("Node: " + m.nodeId) : (m.roleId ? ("Role: " + m.roleId) : null));

      let scopeBadgeHtml = "";
      if (m.roleId) {
        scopeBadgeHtml =
          `<span class="inline-flex items-center gap-1 font-medium tracking-wide uppercase select-none bg-indigo-950/70 text-indigo-300 border border-indigo-800/70 font-mono px-2 py-0.5 text-xs rounded-full cursor-pointer hover:bg-indigo-900/80 transition-colors" onclick="event.stopPropagation(); filterMemoriesByRole('${
            escapeHtml(m.roleId)
          }')" title="Filter by role @${escapeHtml(m.roleId)}">@${escapeHtml(m.roleId)}</span>`;
      } else if (scope === "role") {
        scopeBadgeHtml =
          `<span class="inline-flex items-center gap-1 font-medium tracking-wide uppercase select-none bg-indigo-950/70 text-indigo-300 border border-indigo-800/70 font-mono px-2 py-0.5 text-xs rounded-full">ROLE</span>`;
      } else if (scope === "node") {
        scopeBadgeHtml =
          `<span class="inline-flex items-center gap-1 font-medium tracking-wide uppercase select-none bg-purple-950/60 text-purple-400 border border-purple-800/60 px-2 py-0.5 text-xs rounded-full">NODE</span>`;
      } else {
        scopeBadgeHtml =
          `<span class="inline-flex items-center gap-1 font-medium tracking-wide uppercase select-none bg-sky-950/60 text-sky-400 border border-sky-800/60 px-2 py-0.5 text-xs rounded-full">WORKFLOW</span>`;
      }

      const sourceHtml = m.source
        ? `
        <span class="text-[10px] font-mono uppercase tracking-wider text-gray-500 bg-gray-800/80 px-1.5 py-0.5 rounded border border-gray-700/50">
          ${escapeHtml(m.source)}
        </span>
      `
        : "";

      const tagsHtml = (m.tags && Array.isArray(m.tags) && m.tags.length > 0)
        ? `<div class="flex flex-wrap gap-1">${
          m.tags.map((t) => `
            <span class="text-[11px] font-mono text-gray-400 bg-gray-800/70 border border-gray-700/60 px-1.5 py-0.5 rounded hover:text-gray-200 transition-colors">
              #${escapeHtml(t)}
            </span>
          `).join("")
        }</div>`
        : "";

      return `
        <div
          class="group relative flex flex-col justify-between gap-3 p-4 rounded-xl bg-gray-900/90 border border-gray-800 hover:border-gray-700 transition-all duration-150 shadow-sm hover:shadow-md cursor-pointer"
          data-memory-id="${escapeHtml(m.id)}"
          onclick="openMemoryDetailModal('${escapeHtml(m.id)}')"
        >
          <!-- Header: Key & Role/Scope Badges -->
          <div class="flex flex-col gap-2">
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-1.5 flex-wrap">
                ${scopeBadgeHtml}
                ${sourceHtml}
              </div>

              <span
                class="inline-flex items-center gap-1 text-[11px] font-mono text-emerald-400 bg-emerald-950/50 border border-emerald-800/50 px-2 py-0.5 rounded-full"
                title="Total recall count"
              >
                <span>👁️</span>
                <span>${m.accessCount ?? 0}</span>
              </span>
            </div>

            <!-- Memory Key -->
            <h4
              class="font-mono font-semibold text-sm text-sky-400 hover:text-sky-300 break-all cursor-pointer transition-colors"
              title="${escapeHtml(m.key)}"
            >
              ${escapeHtml(m.key)}
            </h4>

            <!-- Short Summary -->
            ${
        m.summary
          ? `
              <p class="text-xs text-gray-300 line-clamp-2 leading-relaxed">
                ${escapeHtml(m.summary)}
              </p>
            `
          : ""
      }

            <!-- Target Reference -->
            ${
        targetRef
          ? `
              <div class="text-[11px] font-mono text-gray-500 flex items-center gap-1">
                <span>🎯</span>
                <span class="truncate">${escapeHtml(targetRef)}</span>
              </div>
            `
          : ""
      }
          </div>

          <!-- Content / Value Preview (with JSON formatting) -->
          <div class="rounded-lg bg-gray-950 border border-gray-800/80 p-2.5 overflow-hidden">
            <div class="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-gray-500 mb-1.5 pb-1 border-b border-gray-800/60">
              <span>${preview.isJson ? "JSON Payload" : "Content Preview"}</span>
              <span class="text-gray-600">${rawContent.length} chars</span>
            </div>
            ${
        preview.isJson
          ? `
                <pre class="font-mono text-xs text-emerald-400 overflow-x-auto max-h-28 whitespace-pre scrollbar-thin scrollbar-thumb-gray-800">${
            escapeHtml(preview.text)
          }</pre>
              `
          : `
                <p class="font-mono text-xs text-gray-300 whitespace-pre-wrap break-all line-clamp-4 max-h-28 overflow-y-auto">
                  ${
            preview.text
              ? escapeHtml(preview.text)
              : '<span class="text-gray-600 italic">(Empty memory content)</span>'
          }
                </p>
              `
      }
          </div>

          <!-- Tags Row -->
          ${tagsHtml}

          <!-- Footer: Timestamp & Action Buttons -->
          <div class="flex items-center justify-between pt-2.5 border-t border-gray-800/80 gap-2">
            <span
              class="text-[11px] text-gray-500 truncate"
              title="Updated at ${escapeHtml(m.updatedAt || m.createdAt || "unknown")}"
            >
              🕒 ${escapeHtml(timeLabel)}
            </span>

            <div class="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                class="inline-flex items-center justify-center gap-1 transition-colors duration-150 focus:outline-none select-none bg-gray-800 hover:bg-gray-700 active:bg-gray-600 text-gray-200 font-medium border border-gray-600 px-2.5 py-1 text-xs rounded shadow-sm"
                onclick="event.stopPropagation(); copyMemoryContent('${
        escapeHtml(rawContent).replace(/'/g, "\\'")
      }')"
                title="Copy memory content to clipboard"
                data-action="copy"
              >
                <span>📋</span>
                <span>Copy</span>
              </button>

              <button
                type="button"
                class="inline-flex items-center justify-center gap-1 transition-colors duration-150 focus:outline-none select-none bg-gray-800 hover:bg-gray-700 active:bg-gray-600 text-gray-200 font-medium border border-gray-600 px-2.5 py-1 text-xs rounded shadow-sm"
                onclick="event.stopPropagation(); openMemoryDetailModal('${escapeHtml(m.id)}')"
                title="Inspect memory details"
                data-action="inspect"
              >
                <span>🔍</span>
                <span>Inspect</span>
              </button>

              <button
                type="button"
                class="inline-flex items-center justify-center transition-colors duration-150 focus:outline-none select-none bg-red-600 hover:bg-red-700 active:bg-red-800 text-white font-medium border border-transparent px-2.5 py-1 text-xs rounded shadow-sm"
                onclick="event.stopPropagation(); deleteMemoryItem('${escapeHtml(m.id)}')"
                title="Delete this memory"
                data-action="delete"
              >
                <span>🗑️</span>
              </button>
            </div>
          </div>
        </div>
      `;
    }).join("");

    grid.innerHTML =
      `<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">${cardsHtml}</div>`;
  }

  /**
   * Copy memory content to clipboard with toast confirmation.
   */
  async function copyMemoryContent(content) {
    let textToCopy = content;
    if (!textToCopy && currentMemory) {
      textToCopy = currentMemory.content || currentMemory.summary || "";
    }
    if (!textToCopy) {
      const contentEl = document.getElementById("memDetailContent");
      if (contentEl) textToCopy = contentEl.value;
    }

    if (!textToCopy) {
      showToast("No content to copy.", true);
      return;
    }

    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(textToCopy);
      } else {
        // Fallback for older browsers / non-HTTPS
        const ta = document.createElement("textarea");
        ta.value = textToCopy;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      showToast("Memory content copied to clipboard!");
    } catch (_) {
      showToast("Failed to copy to clipboard", true);
    }
  }

  async function openMemoryDetailModal(memoryId, taskId = "") {
    try {
      const query = taskId
        ? ("?taskId=" + encodeURIComponent(taskId) + "&accessedBy=" +
          encodeURIComponent(CURRENT_USER))
        : "";
      const [memRes, logRes] = await Promise.all([
        fetch("/api/memories/" + encodeURIComponent(memoryId) + query),
        fetch("/api/memories/" + encodeURIComponent(memoryId) + "/access-log"),
      ]);

      if (!memRes.ok) throw new Error("Memory not found");
      const memData = await memRes.json();
      currentMemory = memData.memory;

      const logData = logRes.ok ? await logRes.json() : { records: [] };

      document.getElementById("memDetailKey").textContent = currentMemory.key;
      document.getElementById("memDetailScopeBadge").textContent =
        (currentMemory.scope || "workflow").toUpperCase();
      document.getElementById("memDetailScopeBadge").className = "badge scope-badge-" +
        (currentMemory.scope || "workflow");
      document.getElementById("memDetailSummary").value = currentMemory.summary || "";
      document.getElementById("memDetailTags").value = (currentMemory.tags || []).join(", ");
      document.getElementById("memDetailContent").value = currentMemory.content || "";

      const target = currentMemory.scope === "workflow"
        ? ("Workflow: " + (currentMemory.workflowId || "global"))
        : (currentMemory.scope === "node"
          ? ("Node: " + (currentMemory.nodeId || "-") + " (" + (currentMemory.workflowId || "-") +
            ")")
          : (currentMemory.scope === "role" ? ("Role: " + (currentMemory.roleId || "-")) : "-"));
      document.getElementById("memDetailTarget").textContent = target;
      document.getElementById("memDetailAccessCount").textContent = "👁️ " +
        (currentMemory.accessCount || 0);
      document.getElementById("memDetailSource").textContent = currentMemory.source || "manual";
      document.getElementById("memDetailUpdatedAt").textContent = currentMemory.updatedAt
        ? new Date(currentMemory.updatedAt).toLocaleString()
        : "-";

      // Render Access Log Table
      const logBody = document.getElementById("memAccessLogBody");
      const logs = logData.records || [];
      if (logBody) {
        if (logs.length === 0) {
          logBody.innerHTML =
            '<tr><td colspan="4" style="text-align: center; color: var(--text-dim);">No access logs recorded.</td></tr>';
        } else {
          logBody.innerHTML = logs.map((l) => `
            <tr>
              <td>${new Date(l.accessedAt).toLocaleString()}</td>
              <td><span style="color: #60a5fa; font-weight: 500;">${
            escapeHtml(l.accessedBy || "unknown")
          }</span></td>
              <td>${l.taskId ? ("<code>" + escapeHtml(l.taskId) + "</code>") : "-"}</td>
              <td>${l.executionId ? ("<code>" + escapeHtml(l.executionId) + "</code>") : "-"}</td>
            </tr>
          `).join("");
        }
      }

      const modal = document.getElementById("memoryDetailModal");
      if (modal) modal.classList.add("open");
      loadMemories(); // Refresh access counters in background
    } catch (err) {
      showToast(err.message, true);
    }
  }

  function closeMemoryDetailModal() {
    const modal = document.getElementById("memoryDetailModal");
    if (modal) modal.classList.remove("open");
    currentMemory = null;
  }

  async function saveMemoryDetails() {
    if (!currentMemory) return;

    const summaryEl = document.getElementById("memDetailSummary");
    const contentEl = document.getElementById("memDetailContent");
    const tagsEl = document.getElementById("memDetailTags");

    const summary = summaryEl ? summaryEl.value.trim() : "";
    const content = contentEl ? contentEl.value.trim() : "";
    const tagsRaw = tagsEl ? tagsEl.value.trim() : "";
    const tags = tagsRaw ? tagsRaw.split(",").map((t) => t.trim()).filter(Boolean) : [];

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
        content,
      };

      const res = await fetch("/api/memories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
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
        method: "DELETE",
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
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
    const modal = document.getElementById("newMemoryModal");
    if (modal) modal.classList.add("open");
    setTimeout(() => {
      const keyInput = document.getElementById("newMemKey");
      if (keyInput) keyInput.focus();
    }, 50);
  }

  function closeNewMemoryModal() {
    const modal = document.getElementById("newMemoryModal");
    if (modal) modal.classList.remove("open");
  }

  function toggleScopeInputs() {
    const scopeEl = document.getElementById("newMemScope");
    const label = document.getElementById("scopeTargetLabel");
    const input = document.getElementById("newMemTargetId");
    if (!scopeEl || !label || !input) return;

    const scope = scopeEl.value;
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

    const tags = tagsRaw ? tagsRaw.split(",").map((t) => t.trim()).filter(Boolean) : [];

    const payload = {
      key,
      scope,
      summary,
      content,
      tags,
      workflowId: scope === "workflow" ? (targetId || undefined) : undefined,
      nodeId: scope === "node" ? targetId : undefined,
      roleId: scope === "role" ? targetId : undefined,
    };

    try {
      const res = await fetch("/api/memories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
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

  /**
   * Fetch all roles with active journal entries.
   */
  async function loadJournals(showNotification = false) {
    const grid = document.getElementById("rolesGrid");
    if (grid && allRoles.length === 0) {
      grid.innerHTML = `
        <div class="flex flex-col items-center justify-center p-12 text-center text-gray-400 gap-3">
          <div class="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
          <p class="text-sm font-medium">Loading Role Journal entries...</p>
        </div>
      `;
    }
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
      if (grid && allRoles.length === 0) {
        grid.innerHTML = `
          <div class="flex flex-col items-center justify-center p-12 text-center text-rose-400 gap-3 bg-gray-900/40 rounded-xl border border-rose-900/30">
            <span class="text-3xl">⚠️</span>
            <p class="text-sm font-medium">Failed to load role journals: ${
          escapeHtml(err.message)
        }</p>
            <button type="button" class="btn btn-sm btn-secondary px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs mt-2" onclick="loadJournals(true)">Retry</button>
          </div>
        `;
      }
    }
  }

  function updateJournalMetrics() {
    const statRoles = document.getElementById("journalStatRoles");
    const statEntries = document.getElementById("journalStatEntries");

    if (statRoles) statRoles.textContent = allRoles.length;
    const activeJournals = allRoles.filter((r) => r.journal && r.journal.entry).length;
    if (statEntries) statEntries.textContent = activeJournals;
  }

  function renderJournalsGrid() {
    const grid = document.getElementById("rolesGrid");
    if (!grid) return;
    const searchEl = document.getElementById("journal-search-input") ||
      document.getElementById("journalSearchInput");
    const search = (searchEl ? searchEl.value : "").toLowerCase().trim();

    const filtered = allRoles.filter((r) => {
      if (activeJournalRoleTab && activeJournalRoleTab !== "all" && activeJournalRoleTab !== "") {
        if ((r.name || "").toLowerCase() !== activeJournalRoleTab.toLowerCase()) {
          return false;
        }
      }

      if (!search) return true;
      const matchName = (r.name || "").toLowerCase().includes(search);
      const matchDesc = (r.description || "").toLowerCase().includes(search);
      const matchJournal = r.journal && (r.journal.entry || "").toLowerCase().includes(search);
      const matchAuthor = r.journal && (r.journal.writtenBy || "").toLowerCase().includes(search);
      const matchTags = r.journal && r.journal.tags && Array.isArray(r.journal.tags) &&
        r.journal.tags.some((t) => t.toLowerCase().includes(search));
      return matchName || matchDesc || matchJournal || matchAuthor || matchTags;
    });

    if (filtered.length === 0) {
      const isFiltered = Boolean(
        (document.getElementById("journal-search-input") ||
          document.getElementById("journalSearchInput"))?.value ||
          (activeJournalRoleTab && activeJournalRoleTab !== "all"),
      );
      grid.innerHTML = `
        <div class="flex flex-col items-center justify-center p-12 text-center text-gray-400 gap-3 bg-gray-900/40 rounded-xl border border-gray-800">
          <span class="text-3xl">${isFiltered ? "🔍" : "📖"}</span>
          <h3 class="text-base font-semibold text-gray-200">${
        isFiltered ? "No matching journal entries" : "No role journals found"
      }</h3>
          <p class="text-sm text-gray-400 max-w-md">${
        isFiltered
          ? "No journal entries match your selected role or search query. Try clearing filters or selecting another role tab."
          : "No engineering roles or journal entries have been recorded yet. Click '+ New Role' to create one."
      }</p>
          <div class="flex items-center gap-2 mt-2">
            <button type="button" class="btn btn-sm btn-secondary px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-200" onclick="openNewRoleModal()">
              <span>➕</span>
              <span>New Role</span>
            </button>
          </div>
        </div>
      `;
      return;
    }

    const cardsHtml = filtered.map((r) => {
      const hasJournal = Boolean(r.journal && r.journal.entry);
      const colors = getRoleColor(r.name);
      const initial = (r.name || "R").trim().charAt(0).toUpperCase() || "R";
      const isoTime = hasJournal
        ? (r.journal.updatedAt || r.journal.createdAt || r.journal.timestamp)
        : null;
      const formattedTime = isoTime ? formatTimestamp(isoTime) : null;
      const journalEntryText = hasJournal ? r.journal.entry : "";

      const tagsHtml =
        (hasJournal && r.journal.tags && Array.isArray(r.journal.tags) && r.journal.tags.length > 0)
          ? `<div class="flex flex-wrap items-center gap-1.5 pt-1">
            <span class="text-[10px] uppercase font-semibold text-gray-500 tracking-wider">Tags:</span>
            ${
            r.journal.tags.map((tag) => `
              <span class="text-[11px] font-mono text-gray-400 bg-gray-800/70 border border-gray-700/60 px-2 py-0.5 rounded-full hover:text-gray-200 transition-colors">
                #${escapeHtml(tag)}
              </span>
            `).join("")
          }
          </div>`
          : "";

      return `
        <div
          class="group relative flex flex-col gap-3 p-5 rounded-xl bg-gray-900/90 border border-gray-800 hover:border-gray-700 transition-all duration-150 shadow-sm hover:shadow-md"
          data-role="${escapeHtml(r.name)}"
        >
          <!-- Header: Role Avatar, Role Badge, Author, & Formatted Timestamp -->
          <div class="flex items-start justify-between gap-3 flex-wrap sm:flex-nowrap">
            <div class="flex items-center gap-3">
              <!-- Role Avatar -->
              <div
                class="w-9 h-9 rounded-lg flex items-center justify-center font-mono font-bold text-sm border ${colors.bg} ${colors.text} ${colors.border} shadow-sm shrink-0"
                title="Role: ${escapeHtml(r.name)}"
              >
                ${escapeHtml(initial)}
              </div>

              <div class="flex flex-col gap-0.5">
                <div class="flex items-center gap-2 flex-wrap">
                  <span
                    class="inline-flex items-center gap-1 font-medium tracking-wide uppercase select-none bg-indigo-950/70 text-indigo-300 border border-indigo-800/70 font-mono px-2 py-0.5 text-xs rounded-full cursor-pointer hover:bg-indigo-900/80 transition-colors"
                    onclick="filterJournalsByRole('${escapeHtml(r.name)}')"
                    title="Filter journals by @${escapeHtml(r.name)}"
                  >
                    @${escapeHtml(r.name)}
                  </span>
                  ${
        hasJournal && r.journal.writtenBy
          ? `
                    <span class="text-xs text-gray-400 flex items-center gap-1">
                      <span>by</span>
                      <span class="text-gray-200 font-medium font-mono">${
            escapeHtml(r.journal.writtenBy)
          }</span>
                    </span>
                  `
          : ""
      }
                </div>

                ${
        isoTime
          ? `
                  <time
                    datetime="${escapeHtml(isoTime)}"
                    title="${escapeHtml(isoTime)}"
                    class="text-[11px] font-mono text-gray-500 flex items-center gap-1"
                  >
                    <span>🕒</span>
                    <span>${escapeHtml(formattedTime)}</span>
                  </time>
                `
          : ""
      }
              </div>
            </div>

            <!-- Action Controls -->
            <div class="flex items-center gap-1.5 self-start sm:self-center shrink-0 flex-wrap">
              ${
        hasJournal
          ? `
                <button
                  type="button"
                  class="inline-flex items-center justify-center gap-1 transition-colors duration-150 focus:outline-none select-none bg-transparent hover:bg-gray-800 active:bg-gray-700 text-gray-400 hover:text-gray-200 font-medium border border-transparent px-2.5 py-1 text-xs rounded"
                  onclick="copyMemoryContent('${
            escapeHtml(journalEntryText).replace(/'/g, "\\'")
          }')"
                  title="Copy journal entry content"
                >
                  <span>📋</span>
                  <span class="hidden sm:inline">Copy</span>
                </button>
              `
          : ""
      }

              <button
                type="button"
                class="inline-flex items-center justify-center gap-1 transition-colors duration-150 focus:outline-none select-none bg-transparent hover:bg-gray-800 active:bg-gray-700 text-gray-400 hover:text-gray-200 font-medium border border-transparent px-2.5 py-1 text-xs rounded"
                onclick="openEditJournalModal('${escapeHtml(r.name)}', '${
        hasJournal ? escapeHtml(journalEntryText).replace(/'/g, "\\'") : ""
      }')"
                title="${hasJournal ? "Edit journal entry" : "Write journal entry"}"
              >
                <span>${hasJournal ? "✏️" : "📝"}</span>
                <span class="hidden sm:inline">${hasJournal ? "Edit" : "Write"}</span>
              </button>

              <button
                type="button"
                class="inline-flex items-center justify-center gap-1 transition-colors duration-150 focus:outline-none select-none bg-gray-800 hover:bg-gray-700 active:bg-gray-600 text-gray-200 font-medium border border-gray-600 px-2.5 py-1 text-xs rounded shadow-sm"
                onclick="viewRoleTasks('${escapeHtml(r.name)}')"
                title="View tasks assigned to this role"
              >
                <span>📋</span>
                <span>Tasks</span>
              </button>
            </div>
          </div>

          <!-- Role Description (if provided) -->
          ${
        r.description
          ? `
            <p class="text-xs text-gray-400 italic">
              ${escapeHtml(r.description)}
            </p>
          `
          : ""
      }

          <!-- Markdown / Text Body -->
          <div class="rounded-lg bg-gray-950/80 border border-gray-800/80 p-4 text-sm text-gray-200 font-sans leading-relaxed whitespace-pre-wrap break-words overflow-x-auto">
            ${
        hasJournal
          ? escapeHtml(journalEntryText)
          : '<span class="text-gray-600 italic">No journal snapshot recorded yet for this role.</span>'
      }
          </div>

          <!-- Tags Row (if provided) -->
          ${tagsHtml}
        </div>
      `;
    }).join("");

    grid.innerHTML = `<div class="flex flex-col gap-4">${cardsHtml}</div>`;
  }

  function viewRoleTasks(roleName) {
    switchMainTab("tasks");
    const select = document.getElementById("roleFilter");
    if (select) {
      select.value = roleName;
      applyFilters();
    }
  }

  function openNewRoleModal() {
    document.getElementById("newRoleName").value = "";
    document.getElementById("newRoleDesc").value = "";
    const modal = document.getElementById("newRoleModal");
    if (modal) modal.classList.add("open");
    setTimeout(() => {
      const nameInput = document.getElementById("newRoleName");
      if (nameInput) nameInput.focus();
    }, 50);
  }

  function closeNewRoleModal() {
    const modal = document.getElementById("newRoleModal");
    if (modal) modal.classList.remove("open");
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
        body: JSON.stringify({ name, description: description || undefined }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
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
    const modal = document.getElementById("editJournalModal");
    if (modal) modal.classList.add("open");
    setTimeout(() => {
      const entryInput = document.getElementById("editJournalEntry");
      if (entryInput) entryInput.focus();
    }, 50);
  }

  function closeEditJournalModal() {
    const modal = document.getElementById("editJournalModal");
    if (modal) modal.classList.remove("open");
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
        body: JSON.stringify({ entry, writtenBy }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
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

  /* =========================================================================
     INITIALIZATION & EVENT DELEGATION
     ========================================================================= */

  function initTaskApp() {
    // Backdrop click delegation to close modals
    document.querySelectorAll(".modal-backdrop").forEach((backdrop) => {
      backdrop.addEventListener("click", (e) => {
        if (e.target === backdrop) {
          backdrop.classList.remove("open");
          if (backdrop.id === "taskDetailModal" || backdrop.id === "taskModal") currentTask = null;
          if (backdrop.id === "memoryDetailModal") currentMemory = null;
        }
      });
    });

    // Keyboard Shortcuts
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

    // Comment composer keyboard shortcut
    const commentInput = document.getElementById("commentInput");
    if (commentInput) {
      commentInput.addEventListener("keydown", (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
          e.preventDefault();
          postComment();
        }
      });
    }

    // Popstate handling for browser navigation
    globalThis.addEventListener("popstate", (e) => {
      if (e.state && e.state.tab) {
        switchMainTab(e.state.tab, false);
      } else {
        const path = globalThis.location.pathname.replace(/^\//, "");
        if (path === "memories" || path === "journals" || path === "tasks") {
          switchMainTab(path, false);
        } else {
          switchMainTab("tasks", false);
        }
      }
    });

    // Memory Vault search & filters listeners
    const memSearch = document.getElementById("memory-search-input") ||
      document.getElementById("memSearchInput");
    if (memSearch) {
      memSearch.addEventListener("input", () => renderMemoriesGrid());
    }
    const memRole = document.getElementById("memory-role-select");
    if (memRole) {
      memRole.addEventListener("change", () => renderMemoriesGrid());
    }
    const memScope = document.getElementById("memory-scope-select") ||
      document.getElementById("memScopeFilter");
    if (memScope) {
      memScope.addEventListener("change", () => renderMemoriesGrid());
    }

    // Role Journals search & role tabs delegation
    const journalSearch = document.getElementById("journal-search-input") ||
      document.getElementById("journalSearchInput");
    if (journalSearch) {
      journalSearch.addEventListener("input", () => renderJournalsGrid());
    }
    const journalNav = document.querySelector('nav[aria-label="Role Journal Tabs"]');
    if (journalNav) {
      journalNav.addEventListener("click", (e) => {
        const btn = e.target.closest("button");
        if (!btn) return;
        const tabId = btn.getAttribute("data-tab-id") ||
          (btn.textContent.includes("All Roles")
            ? "all"
            : btn.textContent.trim().replace(/^@/, "").split(/\s+/)[0]);
        if (tabId) {
          filterJournalsByRole(tabId);
        }
      });
    }

    // Initial view load
    if (currentTab === "memories") {
      loadMemories();
    } else if (currentTab === "journals") {
      loadJournals();
    } else {
      loadTasks();
    }
  }

  // Export functions to window for template inline handlers and global access
  globalThis.escapeHtml = escapeHtml;
  globalThis.showToast = showToast;
  globalThis.switchMainTab = switchMainTab;
  globalThis.handleHeaderAction = handleHeaderAction;
  globalThis.loadTasks = loadTasks;
  globalThis.populateRoleFilter = populateRoleFilter;
  globalThis.applyFilters = applyFilters;
  globalThis.getFilteredTasks = getFilteredTasks;
  globalThis.renderBoard = renderBoard;
  globalThis.createTaskCard = createTaskCard;
  globalThis.handleDragStart = handleDragStart;
  globalThis.handleDragEnd = handleDragEnd;
  globalThis.handleDragOver = handleDragOver;
  globalThis.handleDragLeave = handleDragLeave;
  globalThis.handleDrop = handleDrop;
  globalThis.openTaskDetails = openTaskDetails;
  globalThis.loadTaskContextDetails = loadTaskContextDetails;
  globalThis.refreshTaskContextDetails = refreshTaskContextDetails;
  globalThis.renderDependencies = renderDependencies;
  globalThis.renderComments = renderComments;
  globalThis.updateCharCounter = updateCharCounter;
  globalThis.resetCommentComposer = resetCommentComposer;
  globalThis.postComment = postComment;
  globalThis.saveTaskDetails = saveTaskDetails;
  globalThis.deleteCurrentTask = deleteCurrentTask;
  globalThis.closeModal = closeModal;
  globalThis.openNewTaskModal = openNewTaskModal;
  globalThis.closeNewTaskModal = closeNewTaskModal;
  globalThis.submitNewTask = submitNewTask;
  globalThis.loadMemories = loadMemories;
  globalThis.updateMemoryMetrics = updateMemoryMetrics;
  globalThis.getFilteredMemories = getFilteredMemories;
  globalThis.renderMemoriesGrid = renderMemoriesGrid;
  globalThis.copyMemoryContent = copyMemoryContent;
  globalThis.openMemoryDetailModal = openMemoryDetailModal;
  globalThis.closeMemoryDetailModal = closeMemoryDetailModal;
  globalThis.saveMemoryDetails = saveMemoryDetails;
  globalThis.deleteCurrentMemory = deleteCurrentMemory;
  globalThis.deleteMemoryItem = deleteMemoryItem;
  globalThis.openNewMemoryModal = openNewMemoryModal;
  globalThis.closeNewMemoryModal = closeNewMemoryModal;
  globalThis.toggleScopeInputs = toggleScopeInputs;
  globalThis.submitNewMemory = submitNewMemory;
  globalThis.loadJournals = loadJournals;
  globalThis.updateJournalMetrics = updateJournalMetrics;
  globalThis.renderJournalsGrid = renderJournalsGrid;
  globalThis.viewRoleTasks = viewRoleTasks;
  globalThis.openNewRoleModal = openNewRoleModal;
  globalThis.closeNewRoleModal = closeNewRoleModal;
  globalThis.submitNewRole = submitNewRole;
  globalThis.openEditJournalModal = openEditJournalModal;
  globalThis.closeEditJournalModal = closeEditJournalModal;
  globalThis.submitJournalUpdate = submitJournalUpdate;
  globalThis.formatValuePreview = formatValuePreview;
  globalThis.formatTimestamp = formatTimestamp;
  globalThis.getRoleColor = getRoleColor;
  globalThis.filterMemoriesByRole = filterMemoriesByRole;
  globalThis.filterJournalsByRole = filterJournalsByRole;
  globalThis.initTaskApp = initTaskApp;

  // Auto-initialize when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initTaskApp);
  } else {
    initTaskApp();
  }
})();
