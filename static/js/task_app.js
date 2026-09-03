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
    currentTab = tab;

    // Update navigation buttons
    document.querySelectorAll(".nav-tab").forEach((btn) => btn.classList.remove("active"));
    const activeBtn = document.getElementById("tab-btn-" + tab);
    if (activeBtn) activeBtn.classList.add("active");

    // Update header action button label
    const actionText = document.getElementById("headerActionBtnText");
    if (actionText) {
      if (tab === "tasks") actionText.textContent = "New Task";
      else if (tab === "memories") actionText.textContent = "New Memory";
      else if (tab === "journals") actionText.textContent = "New Role";
    }

    // Toggle view containers
    document.querySelectorAll(".main-view").forEach((v) => v.classList.add("hidden"));
    const activeView = document.getElementById(tab + "View");
    if (activeView) activeView.classList.remove("hidden");

    if (updateHistory) {
      globalThis.history.pushState({ tab }, "", "/" + tab);
    }

    // Load corresponding dataset
    if (tab === "tasks") loadTasks();
    else if (tab === "memories") loadMemories();
    else if (tab === "journals") loadJournals();
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
        empty.className = "empty-state";
        empty.textContent = "No tasks in this lane";
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
    card.className = "task-card";
    card.draggable = true;
    card.id = "card-" + task.id;

    card.ondragstart = (e) => {
      handleDragStart(e, task.id);
    };

    card.ondragend = (e) => {
      handleDragEnd(e);
    };

    card.onclick = () => openTaskDetails(task.id);

    const typeClass = "badge-" + (task.type || "task");
    const priorityClass = "priority-" + (task.priority || "medium");
    const isReady = readyTaskIds.has(task.id);
    const commentsCount = (task.comments && Array.isArray(task.comments))
      ? task.comments.length
      : 0;

    card.innerHTML = `
      <div class="card-top">
        <span class="task-id">${escapeHtml(task.id)}</span>
        <div class="badges-row">
          ${
      isReady
        ? '<span class="badge" style="background: rgba(16, 185, 129, 0.2); color: #34d399;" title="Ready frontier">⚡ READY</span>'
        : ""
    }
          <span class="badge ${typeClass}">${escapeHtml((task.type || "task").toUpperCase())}</span>
          <span class="badge ${priorityClass}">${
      escapeHtml((task.priority || "medium").toUpperCase())
    }</span>
        </div>
      </div>
      <div class="card-title">${escapeHtml(task.title)}</div>
      ${task.description ? '<div class="card-desc">' + escapeHtml(task.description) + "</div>" : ""}
      <div class="card-footer">
        <div class="card-assignee">
          ${
      task.assignee
        ? "👤 " + escapeHtml(task.assignee)
        : (task.role
          ? "🏷️ " + escapeHtml(task.role)
          : '<span style="color: var(--text-dim);">Unassigned</span>')
    }
        </div>
        <div class="card-meta-icons">
          ${
      commentsCount > 0 ? '<span class="comment-count-chip">💬 ' + commentsCount + "</span>" : ""
    }
        </div>
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

      const modalEl = document.getElementById("taskDetailModal");
      if (modalEl) modalEl.classList.add("open");
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
    const modal = document.getElementById("taskDetailModal");
    if (modal) modal.classList.remove("open");
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
    const modal = document.getElementById("newTaskModal");
    if (modal) modal.classList.add("open");
    setTimeout(() => {
      const titleInput = document.getElementById("newTitle");
      if (titleInput) titleInput.focus();
    }, 50);
  }

  function closeNewTaskModal() {
    const modal = document.getElementById("newTaskModal");
    if (modal) modal.classList.remove("open");
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

  function getFilteredMemories() {
    const searchEl = document.getElementById("memSearchInput");
    const scopeEl = document.getElementById("memScopeFilter");
    const tagEl = document.getElementById("memTagFilter");

    const search = (searchEl ? searchEl.value : "").toLowerCase().trim();
    const scopeFilter = scopeEl ? scopeEl.value : "";
    const tagFilter = (tagEl ? tagEl.value : "").toLowerCase().trim();

    return allMemories.filter((m) => {
      if (scopeFilter && m.scope !== scopeFilter) return false;

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
        const matchContent = (m.content || "").toLowerCase().includes(search);
        const matchTags = m.tags && m.tags.some((t) => t.toLowerCase().includes(search));
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
      grid.innerHTML = '<div class="empty-state">No memories found in the vault.</div>';
      return;
    }

    grid.innerHTML = filtered.map((m) => {
      const scopeBadgeClass = "scope-badge-" + (m.scope || "workflow");
      const targetRef = m.scope === "workflow"
        ? ("Workflow: " + (m.workflowId || "global"))
        : (m.scope === "node"
          ? ("Node: " + (m.nodeId || "-") + " in " + (m.workflowId || "-"))
          : (m.scope === "role" ? ("Role: " + (m.roleId || "-")) : ""));

      const tagsHtml = (m.tags && Array.isArray(m.tags) && m.tags.length > 0)
        ? m.tags.map((t) => '<span class="tag-chip">#' + escapeHtml(t) + "</span>").join("")
        : "";

      return `
        <div class="memory-card" onclick="openMemoryDetailModal('${escapeHtml(m.id)}')">
          <div class="memory-card-header">
            <span class="badge ${scopeBadgeClass}">${
        escapeHtml((m.scope || "workflow").toUpperCase())
      }</span>
            <span class="access-chip">👁️ ${m.accessCount || 0} recalls</span>
          </div>
          <div class="memory-key">${escapeHtml(m.key)}</div>
          <div class="memory-summary">${escapeHtml(m.summary)}</div>
          ${
        targetRef ? '<div class="memory-target-ref">🎯 ' + escapeHtml(targetRef) + "</div>" : ""
      }
          ${tagsHtml ? '<div class="tags-row">' + tagsHtml + "</div>" : ""}
          <div class="memory-card-footer">
            <span>Updated: ${m.updatedAt ? new Date(m.updatedAt).toLocaleDateString() : "-"}</span>
            <div style="display: flex; gap: 6px;">
              <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); copyMemoryContent('${
        escapeHtml(m.content || m.summary).replace(/'/g, "\\'")
      }')" title="Copy Content">📋</button>
              <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); openMemoryDetailModal('${
        escapeHtml(m.id)
      }')">Inspect</button>
              <button class="btn btn-danger btn-sm" onclick="event.stopPropagation(); deleteMemoryItem('${
        escapeHtml(m.id)
      }')">🗑️</button>
            </div>
          </div>
        </div>
      `;
    }).join("");
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
    const statRoles = document.getElementById("journalStatRoles");
    const statEntries = document.getElementById("journalStatEntries");

    if (statRoles) statRoles.textContent = allRoles.length;
    const activeJournals = allRoles.filter((r) => r.journal && r.journal.entry).length;
    if (statEntries) statEntries.textContent = activeJournals;
  }

  function renderJournalsGrid() {
    const grid = document.getElementById("rolesGrid");
    if (!grid) return;
    const searchEl = document.getElementById("journalSearchInput");
    const search = (searchEl ? searchEl.value : "").toLowerCase().trim();

    const filtered = allRoles.filter((r) => {
      if (!search) return true;
      const matchName = (r.name || "").toLowerCase().includes(search);
      const matchDesc = (r.description || "").toLowerCase().includes(search);
      const matchJournal = r.journal && (r.journal.entry || "").toLowerCase().includes(search);
      return matchName || matchDesc || matchJournal;
    });

    if (filtered.length === 0) {
      grid.innerHTML =
        '<div class="empty-state">No roles found. Click "+ New Role" to create one.</div>';
      return;
    }

    grid.innerHTML = filtered.map((r) => {
      const hasJournal = r.journal && r.journal.entry;
      const journalHtml = hasJournal
        ? `
        <div class="journal-box">
          <div class="journal-box-header">
            <span>👤 <strong>${escapeHtml(r.journal.writtenBy || "unknown")}</strong></span>
            <span>🕒 ${new Date(r.journal.updatedAt).toLocaleString()}</span>
          </div>
          <div class="journal-entry-text">${escapeHtml(r.journal.entry)}</div>
        </div>
      `
        : `
        <div class="journal-box" style="text-align: center; color: var(--text-dim); padding: 20px 10px;">
          No journal snapshot recorded yet for this role.
        </div>
      `;

      return `
        <div class="role-card">
          <div class="role-card-header">
            <div class="role-name">
              <span>🏷️</span>
              <span>${escapeHtml(r.name)}</span>
            </div>
            <span class="badge badge-epic">ROLE</span>
          </div>

          ${r.description ? '<div class="role-desc">' + escapeHtml(r.description) + "</div>" : ""}

          ${journalHtml}

          <div class="role-card-actions">
            <button class="btn btn-secondary btn-sm" onclick="viewRoleTasks('${
        escapeHtml(r.name)
      }')">
              📋 View Role Tasks
            </button>
            <button class="btn btn-sm" onclick="openEditJournalModal('${escapeHtml(r.name)}', '${
        hasJournal ? escapeHtml(r.journal.entry).replace(/'/g, "\\'") : ""
      }')">
              ${hasJournal ? "✏️ Update Journal" : "📝 Write Journal"}
            </button>
          </div>
        </div>
      `;
    }).join("");
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
          if (backdrop.id === "taskDetailModal") currentTask = null;
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
  globalThis.initTaskApp = initTaskApp;

  // Auto-initialize when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initTaskApp);
  } else {
    initTaskApp();
  }
})();
