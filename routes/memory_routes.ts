/**
 * REST API route handlers for Memories, Role Definitions, and Role Journals.
 */

import type { AuthResult } from "../auth/oauth.ts";
import {
  createRole,
  deleteMemory,
  getMemoryAccessLog,
  listMemories,
  listRoles,
  readJournal,
  recallMemory,
  saveMemory,
  writeJournal,
} from "../store/kv.ts";
import type { MemoryScope } from "../store/types.ts";
import { errorResponse, getWwwAuthenticateHeader, jsonResponse } from "./common.ts";

export async function handleMemoryRoutes(
  req: Request,
  url: URL,
  auth: AuthResult | null,
): Promise<Response | null> {
  const path = url.pathname;
  const method = req.method.toUpperCase();

  const isMemoryRoute = path === "/api/memories" || path.startsWith("/api/memories/");
  const isRoleRoute = path === "/api/roles" || path.startsWith("/api/roles/");
  const isJournalRoute = path === "/api/journals" || path.startsWith("/api/journals/");

  if (!isMemoryRoute && !isRoleRoute && !isJournalRoute) {
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

  // 1. GET /api/memories - List memories with filters
  if (path === "/api/memories" && method === "GET") {
    try {
      const scope = (url.searchParams.get("scope") as MemoryScope) || undefined;
      const workflowId = url.searchParams.get("workflowId") || undefined;
      const nodeId = url.searchParams.get("nodeId") || undefined;
      const roleId = url.searchParams.get("roleId") || undefined;
      const limitParam = url.searchParams.get("limit");
      const limit = limitParam ? Number(limitParam) : undefined;

      let tags: string[] | undefined = undefined;
      const allTagsParams = url.searchParams.getAll("tags");
      if (allTagsParams.length > 0) {
        const tagList: string[] = [];
        for (const param of allTagsParams) {
          for (const t of param.split(",")) {
            const trimmed = t.trim();
            if (trimmed) tagList.push(trimmed);
          }
        }
        if (tagList.length > 0) tags = tagList;
      }

      const memories = await listMemories(
        {
          scope,
          workflowId,
          nodeId,
          roleId,
          tags,
          limit,
        },
        { userId },
      );

      return jsonResponse({
        count: memories.length,
        memories,
      });
    } catch (err) {
      return errorResponse(err instanceof Error ? err.message : String(err), 400);
    }
  }

  // 2. POST /api/memories - Create or upsert memory
  if (path === "/api/memories" && method === "POST") {
    try {
      const body = await req.json();
      if (!body || typeof body !== "object") {
        return errorResponse("Invalid JSON payload", 400);
      }

      if (!body.key || typeof body.key !== "string" || !body.key.trim()) {
        return errorResponse("Memory key is required", 400);
      }
      if (!body.summary || typeof body.summary !== "string" || !body.summary.trim()) {
        return errorResponse("Memory summary is required", 400);
      }
      if (body.content === undefined || body.content === null) {
        return errorResponse("Memory content is required", 400);
      }
      if (!body.scope || typeof body.scope !== "string" || !body.scope.trim()) {
        return errorResponse("Memory scope is required", 400);
      }

      let tags: string[] | undefined = undefined;
      if (Array.isArray(body.tags)) {
        tags = body.tags
          .filter((t: unknown) => typeof t === "string" && t.trim())
          .map((t: string) => t.trim());
      } else if (typeof body.tags === "string") {
        tags = body.tags.split(",").map((t: string) => t.trim()).filter(Boolean);
      }

      const content = typeof body.content === "string"
        ? body.content
        : JSON.stringify(body.content);

      const result = await saveMemory({
        key: body.key.trim(),
        summary: body.summary.trim(),
        content,
        scope: body.scope as MemoryScope,
        workflowId: body.workflowId || undefined,
        nodeId: body.nodeId || undefined,
        roleId: body.roleId || undefined,
        tags,
        source: body.source || undefined,
      }, userId);

      return jsonResponse({
        memory: result.memory,
        created: result.created,
      }, result.created ? 201 : 200);
    } catch (err) {
      return errorResponse(err instanceof Error ? err.message : String(err), 400);
    }
  }

  // Memory sub-resource matching: /api/memories/:id or /api/memories/:id/access-log
  const memorySubMatch = path.match(/^\/api\/memories\/([^/]+)(?:\/(.*))?$/);
  if (memorySubMatch) {
    const memoryId = decodeURIComponent(memorySubMatch[1]);
    const subAction = memorySubMatch[2] || "";

    // 3. GET /api/memories/:id/access-log
    if (subAction === "access-log" && method === "GET") {
      try {
        const limitParam = url.searchParams.get("limit");
        const limit = limitParam ? Number(limitParam) : undefined;
        const records = await getMemoryAccessLog(memoryId, { limit, userId });
        return jsonResponse({
          count: records.length,
          records,
        });
      } catch (err) {
        return errorResponse(err instanceof Error ? err.message : String(err), 400);
      }
    }

    // 4. GET /api/memories/:id - Recall memory
    if (!subAction && method === "GET") {
      try {
        const taskId = url.searchParams.get("taskId") || undefined;
        const executionId = url.searchParams.get("executionId") || undefined;
        const accessedBy = url.searchParams.get("accessedBy") || auth?.user?.name || auth?.userId ||
          "api";

        const memory = await recallMemory({
          id: memoryId,
          accessedBy,
          taskId,
          executionId,
        }, userId);

        if (!memory) {
          return errorResponse(`Memory "${memoryId}" not found`, 404);
        }

        return jsonResponse({ memory });
      } catch (err) {
        return errorResponse(err instanceof Error ? err.message : String(err), 400);
      }
    }

    // 5. DELETE /api/memories/:id - Delete memory
    if (!subAction && method === "DELETE") {
      try {
        const result = await deleteMemory({ id: memoryId }, userId);
        if (!result.deleted) {
          return errorResponse(`Memory "${memoryId}" not found`, 404);
        }
        return jsonResponse({
          success: true,
          deleted: true,
          accessCount: result.accessCount,
        });
      } catch (err) {
        return errorResponse(err instanceof Error ? err.message : String(err), 400);
      }
    }
  }

  // 6. GET /api/roles - List all user roles with latest journal
  if (path === "/api/roles" && method === "GET") {
    try {
      const roles = await listRoles({ userId });
      const enrichedRoles = await Promise.all(
        roles.map(async (role) => {
          const journal = await readJournal(role.name, userId);
          return {
            ...role,
            journal,
          };
        }),
      );

      return jsonResponse({
        count: enrichedRoles.length,
        roles: enrichedRoles,
      });
    } catch (err) {
      return errorResponse(err instanceof Error ? err.message : String(err), 400);
    }
  }

  // 7. POST /api/roles - Create or update role
  if (path === "/api/roles" && method === "POST") {
    try {
      const body = await req.json();
      if (!body || typeof body !== "object") {
        return errorResponse("Invalid JSON payload", 400);
      }

      if (!body.name || typeof body.name !== "string" || !body.name.trim()) {
        return errorResponse("Role name is required", 400);
      }

      const role = await createRole({
        name: body.name.trim(),
        description: typeof body.description === "string" ? body.description.trim() : undefined,
      }, userId);

      return jsonResponse({ role }, 201);
    } catch (err) {
      return errorResponse(err instanceof Error ? err.message : String(err), 400);
    }
  }

  // Role Journal sub-resource matching: /api/journals/:role
  const journalMatch = path.match(/^\/api\/journals\/([^/]+)$/);
  if (journalMatch) {
    const roleName = decodeURIComponent(journalMatch[1]);

    // 8. GET /api/journals/:role - Read latest journal for role
    if (method === "GET") {
      try {
        const journal = await readJournal(roleName, userId);
        return jsonResponse({ journal });
      } catch (err) {
        return errorResponse(err instanceof Error ? err.message : String(err), 400);
      }
    }

    // 9. POST /api/journals/:role - Write journal entry for role
    if (method === "POST") {
      try {
        const body = await req.json();
        if (!body || typeof body !== "object") {
          return errorResponse("Invalid JSON payload", 400);
        }

        const entry = typeof body.entry === "string"
          ? body.entry
          : (typeof body.content === "string" ? body.content : "");

        if (!entry || !entry.trim()) {
          return errorResponse("Journal entry content is required", 400);
        }

        const writtenBy = body.writtenBy || auth?.user?.name || auth?.userId || "api";
        const journal = await writeJournal(roleName, entry.trim(), writtenBy, userId);

        return jsonResponse({ journal });
      } catch (err) {
        return errorResponse(err instanceof Error ? err.message : String(err), 400);
      }
    }
  }

  return null;
}
