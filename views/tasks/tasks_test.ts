import { assertEquals, assertStringIncludes } from "@std/assert";
import { h } from "preact";
import { renderHtmlResponse } from "../ssr.ts";
import {
  KanbanBoard,
  PipelineProgress,
  TaskApp,
  TaskCard,
  TaskColumn,
  TaskModal,
} from "./index.ts";

Deno.test("TaskCard - renders metadata, role badge, priority, and data attributes", async () => {
  const vnode = h(TaskCard, {
    task: {
      id: "tk-card-001",
      title: "Implement Authentication Module",
      description: "Implement OAuth and Passkey authentication routes.",
      status: "in_progress",
      priority: "high",
      type: "task",
      role: "security",
      assignee: "alice",
      comments: [{ id: "c1", author: "alice", content: "Working on PR" }],
      isReady: true,
    },
    isReady: true,
  });

  const res = renderHtmlResponse(vnode, { title: "Task Card Test" });
  assertEquals(res.status, 200);
  const text = await res.text();
  assertStringIncludes(text, "tk-card-001");
  assertStringIncludes(text, "Implement Authentication Module");
  assertStringIncludes(text, "Implement OAuth and Passkey authentication routes.");
  assertStringIncludes(text, 'data-task-id="tk-card-001"');
  assertStringIncludes(text, 'data-status="in_progress"');
  assertStringIncludes(text, 'data-priority="high"');
  assertStringIncludes(text, 'data-role="security"');
  assertStringIncludes(text, "@security");
  assertStringIncludes(text, "alice");
  assertStringIncludes(text, "⚡ READY");
  assertStringIncludes(text, "💬");
});

Deno.test("TaskColumn - renders column title, badge counter, and lane dropzone", async () => {
  const vnode = h(TaskColumn, {
    status: "claimed",
    title: "Claimed Work",
    count: 2,
    tasks: [
      {
        id: "tk-col-1",
        title: "Setup CI Pipeline",
        status: "claimed",
        priority: "medium",
      },
      {
        id: "tk-col-2",
        title: "Database Migration",
        status: "claimed",
        priority: "high",
      },
    ],
  });

  const res = renderHtmlResponse(vnode, { title: "Task Column Test" });
  assertEquals(res.status, 200);
  const text = await res.text();
  assertStringIncludes(text, "Claimed Work");
  assertStringIncludes(text, 'id="count-claimed"');
  assertStringIncludes(text, 'id="lane-claimed"');
  assertStringIncludes(text, 'data-status="claimed"');
  assertStringIncludes(text, "Setup CI Pipeline");
  assertStringIncludes(text, "Database Migration");
});

Deno.test("KanbanBoard - renders metrics pills, search/filter controls, and swimlanes", async () => {
  const vnode = h(KanbanBoard, {
    tasks: [
      {
        id: "tk-kb-1",
        title: "Develop Frontend Views",
        status: "open",
        priority: "medium",
        role: "developer",
      },
      {
        id: "tk-kb-2",
        title: "Perform Security Audit",
        status: "review",
        priority: "critical",
        role: "security",
        isReady: true,
      },
    ],
    readyTaskIds: new Set(["tk-kb-2"]),
    availableRoles: ["developer", "security"],
  });

  const res = renderHtmlResponse(vnode, { title: "Kanban Board Test" });
  assertEquals(res.status, 200);
  const text = await res.text();
  assertStringIncludes(text, 'id="kanbanBoard"');
  assertStringIncludes(text, 'id="statTotal"');
  assertStringIncludes(text, 'id="statReady"');
  assertStringIncludes(text, 'id="statInProgress"');
  assertStringIncludes(text, 'id="statBlocked"');
  assertStringIncludes(text, 'id="searchInput"');
  assertStringIncludes(text, 'id="roleFilter"');
  assertStringIncludes(text, 'id="priorityFilter"');
  assertStringIncludes(text, 'id="readyOnlyToggle"');
  assertStringIncludes(text, "Develop Frontend Views");
  assertStringIncludes(text, "Perform Security Audit");
});

Deno.test("PipelineProgress - renders multi-stage steps, connectors, and rejection badge", async () => {
  const vnode = h(PipelineProgress, {
    pipeline: {
      templateId: "tpl-code-review",
      currentStageId: "stage-review",
      currentStageIndex: 1,
      rejectionCount: 2,
      stages: [
        {
          id: "stage-dev",
          name: "Implementation",
          role: "developer",
          status: "completed",
          allowedTransitions: [],
        },
        {
          id: "stage-review",
          name: "Peer Review",
          role: "reviewer",
          status: "active",
          allowedTransitions: [],
        },
        {
          id: "stage-audit",
          name: "Security Audit",
          role: "auditor",
          status: "pending",
          allowedTransitions: [],
        },
      ],
    },
  });

  const res = renderHtmlResponse(vnode, { title: "Pipeline Progress Test" });
  assertEquals(res.status, 200);
  const text = await res.text();
  assertStringIncludes(text, "Pipeline Flow");
  assertStringIncludes(text, "tpl-code-review");
  assertStringIncludes(text, "Implementation");
  assertStringIncludes(text, "Peer Review");
  assertStringIncludes(text, "Security Audit");
  assertStringIncludes(text, "@developer");
  assertStringIncludes(text, "@reviewer");
  assertStringIncludes(text, "@auditor");
  assertStringIncludes(text, "2 Rejections");
});

Deno.test("TaskModal - renders create mode with form controls", async () => {
  const vnode = h(TaskModal, {
    isOpen: true,
    mode: "create",
  });

  const res = renderHtmlResponse(vnode, { title: "Task Modal Create Test" });
  assertEquals(res.status, 200);
  const text = await res.text();
  assertStringIncludes(text, 'id="createTaskModal"');
  assertStringIncludes(text, 'id="newTitle"');
  assertStringIncludes(text, 'id="newDescription"');
  assertStringIncludes(text, 'id="newPriority"');
  assertStringIncludes(text, 'id="newType"');
  assertStringIncludes(text, 'id="newRole"');
  assertStringIncludes(text, 'id="newAssignee"');
  assertStringIncludes(text, 'id="newParentTaskId"');
  assertStringIncludes(text, "Create Task");
});

Deno.test("TaskModal - renders detail/edit mode with comments, dependencies, and sidebar", async () => {
  const vnode = h(TaskModal, {
    isOpen: true,
    mode: "detail",
    task: {
      id: "tk-modal-detail",
      title: "Refactor Memory Store",
      description: "Optimize vector embeddings caching layer.",
      status: "in_progress",
      priority: "high",
      type: "task",
      role: "developer",
      assignee: "bob",
      context: "Currently profiling cache hit rates.",
      comments: [
        {
          id: "c100",
          taskId: "tk-modal-detail",
          author: "bob",
          content: "Initial benchmarks show 35% improvement.",
          createdAt: "2026-09-03T12:00:00.000Z",
        },
      ],
    },
    dependencies: {
      blockedBy: [{ fromTaskId: "tk-parent-001" }],
      blocking: [{ toTaskId: "tk-child-002" }],
    },
    childrenTasks: [{ id: "tk-sub-1", title: "Write unit tests", status: "open" }],
  });

  const res = renderHtmlResponse(vnode, { title: "Task Modal Detail Test" });
  assertEquals(res.status, 200);
  const text = await res.text();
  assertStringIncludes(text, 'id="taskModal"');
  assertStringIncludes(text, 'id="detailTaskId"');
  assertStringIncludes(text, "tk-modal-detail");
  assertStringIncludes(text, 'id="detailTitle"');
  assertStringIncludes(text, "Refactor Memory Store");
  assertStringIncludes(text, 'id="detailDescription"');
  assertStringIncludes(text, 'id="detailContext"');
  assertStringIncludes(text, 'id="taskContextSection"');
  assertStringIncludes(text, 'id="commentsList"');
  assertStringIncludes(text, "Initial benchmarks show 35% improvement.");
  assertStringIncludes(text, 'id="commentInput"');
  assertStringIncludes(text, 'id="detailStatus"');
  assertStringIncludes(text, 'id="detailPriority"');
  assertStringIncludes(text, 'id="detailDependenciesContainer"');
  assertStringIncludes(text, "tk-parent-001");
  assertStringIncludes(text, "tk-child-002");
  assertStringIncludes(text, "tk-sub-1");
  assertStringIncludes(text, "Save Changes");
});

Deno.test("TaskApp - renders header, nav tabs, views, script tags, and global runtime config", async () => {
  const vnode = h(TaskApp, {
    origin: "http://localhost:8000",
    userId: "user_alice",
    userName: "Alice Smith",
    initialTab: "tasks",
    tasks: [
      {
        id: "tk-app-1",
        title: "Setup Preact SSR Engine",
        status: "in_progress",
        priority: "critical",
        role: "developer",
        assignee: "alice",
        isReady: true,
      },
    ],
    memories: [
      {
        id: "mem-app-1",
        key: "ssr.preact",
        summary: "Preact SSR guidelines",
        scope: "workflow",
      },
    ],
    journalEntries: [
      {
        id: "j-app-1",
        role: "developer",
        author: "Alice",
        entry: "SSR views integrated smoothly.",
      },
    ],
  });

  const res = renderHtmlResponse(vnode, { title: "TaskApp Test" });
  assertEquals(res.status, 200);
  const text = await res.text();

  // Header and Brand
  assertStringIncludes(text, "Workflow Tasks");
  assertStringIncludes(text, "Alice Smith");
  assertStringIncludes(text, 'id="headerActionBtn"');
  assertStringIncludes(text, 'id="headerActionBtnText"');
  assertStringIncludes(text, "New Task");

  // Navigation Tabs
  assertStringIncludes(text, 'id="tab-btn-tasks"');
  assertStringIncludes(text, 'id="tab-btn-memories"');
  assertStringIncludes(text, 'id="tab-btn-journals"');

  // Three Main View Containers
  assertStringIncludes(text, 'id="tasksView"');
  assertStringIncludes(text, 'id="memoriesView"');
  assertStringIncludes(text, 'id="journalsView"');

  // Active view content
  assertStringIncludes(text, "tk-app-1");
  assertStringIncludes(text, "Setup Preact SSR Engine");

  // Client Runtime Script and Globals
  assertStringIncludes(text, '<script src="/static/js/task_app.js"></script>');
  assertStringIncludes(text, 'globalThis.ORIGIN = "http://localhost:8000"');
  assertStringIncludes(text, 'globalThis.CURRENT_USER = "Alice Smith"');
  assertStringIncludes(text, 'globalThis.currentTab = "tasks"');

  // Modals & Toast
  assertStringIncludes(text, 'id="taskModal"');
  assertStringIncludes(text, 'id="createTaskModal"');
  assertStringIncludes(text, 'id="memoryDetailModal"');
  assertStringIncludes(text, 'id="newMemoryModal"');
  assertStringIncludes(text, 'id="newRoleModal"');
  assertStringIncludes(text, 'id="editJournalModal"');
  assertStringIncludes(text, 'id="toast"');
});

Deno.test("TaskApp - renders with initialTab=memories and initialTab=journals", async () => {
  // Memories tab active
  const memVnode = h(TaskApp, {
    origin: "http://localhost:8000",
    initialTab: "memories",
  });
  const memRes = renderHtmlResponse(memVnode);
  const memText = await memRes.text();
  assertStringIncludes(memText, "New Memory");
  assertStringIncludes(memText, 'globalThis.currentTab = "memories"');

  // Journals tab active
  const jVnode = h(TaskApp, {
    origin: "http://localhost:8000",
    initialTab: "journals",
  });
  const jRes = renderHtmlResponse(jVnode);
  const jText = await jRes.text();
  assertStringIncludes(jText, "New Role");
  assertStringIncludes(jText, 'globalThis.currentTab = "journals"');
});
