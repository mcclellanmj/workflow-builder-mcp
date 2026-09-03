/**
 * REST API and Web UI route handlers for Task Management, Kanban Board, and Comments.
 */

import type { AuthResult } from "../auth/oauth.ts";
import {
  addTaskComment,
  claimTask,
  closeTask,
  computeReadyFrontier,
  createTask,
  createTasks,
  deleteTask,
  getDependencies,
  getTask,
  getTaskComments,
  listClosedTasks,
  listTasks,
  updateTask,
} from "../store/kv.ts";
import type { TaskPriority, TaskStatus, TaskType } from "../store/types.ts";
import { CORS_HEADERS, errorResponse, getWwwAuthenticateHeader, jsonResponse } from "./common.ts";
import { renderTaskKanbanHtml } from "./task_ui.ts";

export async function handleTaskRoutes(
  req: Request,
  url: URL,
  auth: AuthResult | null,
): Promise<Response | null> {
  const path = url.pathname;
  const method = req.method.toUpperCase();

  // 1. Web UI: GET /tasks, GET /memories, GET /journals
  if ((path === "/tasks" || path === "/memories" || path === "/journals") && method === "GET") {
    if (!auth) {
      return new Response(null, {
        status: 302,
        headers: {
          Location: `/?redirect=${encodeURIComponent(path)}`,
          ...CORS_HEADERS,
        },
      });
    }

    const initialTab = path === "/memories"
      ? "memories"
      : (path === "/journals" ? "journals" : "tasks");
    const html = renderTaskKanbanHtml({
      origin: url.origin,
      userId: auth.userId,
      userName: auth.user?.name || auth.userId,
      initialTab,
    });

    return new Response(html, {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-cache, no-store, must-revalidate",
        ...CORS_HEADERS,
      },
    });
  }

  // Check if this is an /api/tasks route
  if (!path.startsWith("/api/tasks")) {
    return null;
  }

  if (!auth) {
    return errorResponse(
      "Unauthorized. Please log in or provide Bearer token.",
      401,
      getWwwAuthenticateHeader(url.origin),
    );
  }

  const userId = auth.userId;

  // 2. GET /api/tasks/ready - Ready frontier
  if (path === "/api/tasks/ready" && method === "GET") {
    const role = url.searchParams.get("role") || undefined;
    const workflowId = url.searchParams.get("workflowId") || undefined;
    const unclaimedOnly = url.searchParams.get("unclaimedOnly") === "true";
    const includeEpics = url.searchParams.get("includeEpics") === "true";

    const readyTasks = await computeReadyFrontier({
      role,
      workflowId,
      unclaimedOnly,
      includeEpics,
      userId,
    });

    return jsonResponse({
      count: readyTasks.length,
      tasks: readyTasks,
    });
  }

  // 3. GET /api/tasks - List all tasks
  if (path === "/api/tasks" && method === "GET") {
    const status = url.searchParams.get("status") as TaskStatus | null;
    const role = url.searchParams.get("role") || undefined;
    const assignee = url.searchParams.get("assignee") || undefined;
    const type = url.searchParams.get("type") as TaskType | null;
    const workflowId = url.searchParams.get("workflowId") || undefined;
    const parentTaskId = url.searchParams.get("parentTaskId") || undefined;
    const limit = url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined;

    const tasks = await listTasks({
      status: status || undefined,
      role,
      assignee,
      type: type || undefined,
      workflowId,
      parentTaskId,
      limit,
      userId,
    });

    return jsonResponse({
      count: tasks.length,
      tasks,
    });
  }
  // 5. GET /api/tasks/closed - List closed tasks (optional endpoint)
  if (path === "/api/tasks/closed" && method === "GET") {
    const role = url.searchParams.get("role") || undefined;
    const assignee = url.searchParams.get("assignee") || undefined;
    const type = url.searchParams.get("type") as TaskType | null;
    const workflowId = url.searchParams.get("workflowId") || undefined;
    const parentTaskId = url.searchParams.get("parentTaskId") || undefined;
    const limit = url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined;

    const tasks = await listClosedTasks({
      status: "closed",
      role,
      assignee,
      type: type || undefined,
      workflowId,
      parentTaskId,
      limit,
      userId,
    });
    return jsonResponse({
      count: tasks.length,
      tasks,
    });
  }
  // 4. POST /api/tasks/batch - Create tasks in batch
  if (path === "/api/tasks/batch" && method === "POST") {
    try {
      const body = await req.json();
      if (!body || typeof body !== "object") {
        return errorResponse("Invalid JSON payload", 400);
      }

      const tasksList = Array.isArray(body) ? body : (Array.isArray(body.tasks) ? body.tasks : null);
      if (!tasksList || tasksList.length === 0) {
        return errorResponse("Batch tasks array is required", 400);
      }

      const batchPipelineTemplateId = typeof body.pipelineTemplateId === "string"
        ? body.pipelineTemplateId
        : undefined;
      const batchWorkflowId = typeof body.workflowId === "string" ? body.workflowId : undefined;
      const batchExecutionId = typeof body.executionId === "string" ? body.executionId : undefined;

      const taskInputs = tasksList.map((t: Record<string, unknown>) => ({
        id: typeof t.id === "string" ? t.id : undefined,
        title: String(t.title || "").trim(),
        description: typeof t.description === "string" ? t.description : undefined,
        status: t.status as TaskStatus | undefined,
        priority: t.priority as TaskPriority | undefined,
        type: t.type as TaskType | undefined,
        role: typeof t.role === "string" ? t.role : undefined,
        assignee: typeof t.assignee === "string" ? t.assignee : undefined,
        parentTaskId: typeof t.parentTaskId === "string" ? t.parentTaskId : undefined,
        workflowId: typeof t.workflowId === "string" ? t.workflowId : batchWorkflowId,
        executionId: typeof t.executionId === "string" ? t.executionId : batchExecutionId,
        nodeId: typeof t.nodeId === "string" ? t.nodeId : undefined,
        context: typeof t.context === "string" ? t.context : undefined,
        pipelineTemplateId: typeof t.pipelineTemplateId === "string"
          ? t.pipelineTemplateId
          : batchPipelineTemplateId,
      }));

      for (const t of taskInputs) {
        if (!t.title) {
          return errorResponse("Task title is required for all tasks in batch", 400);
        }
      }

      const created = await createTasks(taskInputs, userId);
      return jsonResponse({ count: created.length, tasks: created }, 201);
    } catch (err) {
      return errorResponse(err instanceof Error ? err.message : String(err), 400);
    }
  }

  // 5. POST /api/tasks - Create task
  if (path === "/api/tasks" && method === "POST") {
    try {
      const body = await req.json();
      if (!body || typeof body !== "object") {
        return errorResponse("Invalid JSON payload", 400);
      }

      if (!body.title || typeof body.title !== "string" || !body.title.trim()) {
        return errorResponse("Task title is required", 400);
      }

      const created = await createTask({
        title: body.title.trim(),
        description: body.description,
        status: body.status as TaskStatus,
        priority: body.priority as TaskPriority,
        type: body.type as TaskType,
        role: body.role,
        assignee: body.assignee,
        parentTaskId: body.parentTaskId,
        workflowId: body.workflowId,
        executionId: body.executionId,
        nodeId: body.nodeId,
        context: body.context,
        pipelineTemplateId: body.pipelineTemplateId,
      }, userId);

      return jsonResponse({ task: created }, 201);
    } catch (err) {
      return errorResponse(err instanceof Error ? err.message : String(err), 400);
    }
  }

  // Match /api/tasks/:id and sub-resources
  const taskSubMatch = path.match(/^\/api\/tasks\/([^/]+)(?:\/(.*))?$/);
  if (!taskSubMatch) {
    return null;
  }

  const taskId = decodeURIComponent(taskSubMatch[1]);
  const subAction = taskSubMatch[2] || "";

  // 5. POST /api/tasks/:id/comments - Add short comment (max 256 chars)
  if (subAction === "comments" && method === "POST") {
    try {
      const body = await req.json();
      if (!body || typeof body !== "object") {
        return errorResponse("Invalid JSON payload", 400);
      }

      const content = (body.content || body.comment || "").trim();
      if (!content) {
        return errorResponse("Comment content cannot be empty", 400);
      }

      if (content.length > 256) {
        return errorResponse(
          `Comment exceeds maximum length of 256 characters (received ${content.length} characters)`,
          400,
        );
      }

      const author = body.author || auth?.user?.name || auth?.userId || "anonymous";
      const comment = await addTaskComment(taskId, { author, content }, userId);

      return jsonResponse({ comment }, 201);
    } catch (err) {
      return errorResponse(err instanceof Error ? err.message : String(err), 400);
    }
  }

  // 6. GET /api/tasks/:id/comments - Get task comments
  if (subAction === "comments" && method === "GET") {
    try {
      const comments = await getTaskComments(taskId, userId);
      return jsonResponse({ count: comments.length, comments });
    } catch (err) {
      return errorResponse(err instanceof Error ? err.message : String(err), 404);
    }
  }

  // 7. POST /api/tasks/:id/claim - Claim task
  if (subAction === "claim" && method === "POST") {
    try {
      const body = await req.json().catch(() => ({}));
      const assignee = body.assignee || auth?.user?.name || auth?.userId || "user";
      const claimed = await claimTask(taskId, assignee, userId);
      return jsonResponse({ task: claimed });
    } catch (err) {
      return errorResponse(err instanceof Error ? err.message : String(err), 400);
    }
  }

  // 8. POST /api/tasks/:id/close - Close task
  if (subAction === "close" && method === "POST") {
    try {
      const body = await req.json().catch(() => ({}));
      const result = await closeTask(taskId, body.reason, userId);
      return jsonResponse(result);
    } catch (err) {
      return errorResponse(err instanceof Error ? err.message : String(err), 400);
    }
  }

  // 9. GET /api/tasks/:id - Get single task with dependencies and subtasks
  if (!subAction && method === "GET") {
    const task = await getTask(taskId, userId);
    if (!task) {
      return errorResponse(`Task "${taskId}" not found`, 404);
    }

    const [blocking, blockedBy, children] = await Promise.all([
      getDependencies(taskId, "blocking", userId),
      getDependencies(taskId, "blocked-by", userId),
      listTasks({ parentTaskId: taskId, userId }),
    ]);

    return jsonResponse({
      task,
      dependencies: { blocking, blockedBy },
      children,
    });
  }

  // 10. PATCH /api/tasks/:id - Update task details
  if (!subAction && method === "PATCH") {
    try {
      const body = await req.json();
      if (!body || typeof body !== "object") {
        return errorResponse("Invalid JSON payload", 400);
      }

      const updates: Record<string, unknown> = {};
      if (body.title !== undefined) updates.title = body.title;
      if (body.description !== undefined) updates.description = body.description;
      if (body.status !== undefined) updates.status = body.status;
      if (body.priority !== undefined) updates.priority = body.priority;
      if (body.type !== undefined) updates.type = body.type;
      if (body.assignee !== undefined) updates.assignee = body.assignee;
      if (body.role !== undefined) updates.role = body.role;
      if (body.parentTaskId !== undefined) updates.parentTaskId = body.parentTaskId;
      if (body.context !== undefined) updates.context = body.context;
      if (body.closedReason !== undefined) updates.closedReason = body.closedReason;

      const updated = await updateTask(taskId, updates, userId);
      return jsonResponse({ task: updated });
    } catch (err) {
      return errorResponse(err instanceof Error ? err.message : String(err), 400);
    }
  }

  // 11. DELETE /api/tasks/:id - Delete task
  if (!subAction && method === "DELETE") {
    try {
      await deleteTask(taskId, userId);
      return jsonResponse({ success: true, deletedTaskId: taskId });
    } catch (err) {
      return errorResponse(err instanceof Error ? err.message : String(err), 400);
    }
  }

  return null;
}
