import { assert, assertEquals, assertExists, assertNotEquals } from "@std/assert";
import { createApiToken } from "../auth/oauth.ts";
import { handleHttpRequest } from "../http_server.ts";
import { setKv } from "../store/kv.ts";
import { handleMemoryRoutes } from "./memory_routes.ts";

Deno.test("Memory REST Endpoints - POST & GET /api/memories with Filters and Scopes", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    const userId = "user_mem_filters";
    const tokenInfo = await createApiToken(userId, "Filters Token");
    const authHeaders = {
      "Authorization": `Bearer ${tokenInfo.token}`,
      "Content-Type": "application/json",
    };

    // 1. Create workflow-scoped memory
    const wfRes = await handleHttpRequest(
      new Request("http://localhost:8000/api/memories", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          key: "auth-strategy",
          summary: "OAuth2 with PKCE",
          content: "Use RFC 7636 PKCE for public clients",
          scope: "workflow",
          workflowId: "wf-100",
          tags: ["auth", "security"],
          source: "agent-architect",
        }),
      }),
    );
    assertEquals(wfRes.status, 201);
    const wfData = await wfRes.json();
    assertEquals(wfData.created, true);
    const mem1 = wfData.memory;
    assertExists(mem1.id);
    assert(mem1.id.startsWith("mem-"));
    assertEquals(mem1.key, "auth-strategy");
    assertEquals(mem1.scope, "workflow");
    assertEquals(mem1.workflowId, "wf-100");
    assertEquals(mem1.source, "agent-architect");
    assertEquals(mem1.tags, ["auth", "security"]);

    // 2. Create node-scoped memory with JSON object content and comma-delimited tags string
    const nodeRes = await handleHttpRequest(
      new Request("http://localhost:8000/api/memories", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          key: "parser-rules",
          summary: "JSON schema strict validation",
          content: { strict: true, maxDepth: 5 },
          scope: "node",
          workflowId: "wf-100",
          nodeId: "node-parse",
          tags: "parser, schema , validation",
        }),
      }),
    );
    assertEquals(nodeRes.status, 201);
    const nodeData = await nodeRes.json();
    assertEquals(nodeData.created, true);
    const mem2 = nodeData.memory;
    assertEquals(mem2.scope, "node");
    assertEquals(mem2.nodeId, "node-parse");
    assertEquals(mem2.content, JSON.stringify({ strict: true, maxDepth: 5 }));
    assertEquals(mem2.tags, ["parser", "schema", "validation"]);

    // 3. Create role-scoped memory
    const roleRes = await handleHttpRequest(
      new Request("http://localhost:8000/api/memories", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          key: "coding-standards",
          summary: "TypeScript strict typing rules",
          content: "No any types allowed, full JSDoc required",
          scope: "role",
          roleId: "developer",
          tags: ["standards", "typescript"],
        }),
      }),
    );
    assertEquals(roleRes.status, 201);
    const roleData = await roleRes.json();
    const mem3 = roleData.memory;
    assertEquals(mem3.scope, "role");
    assertEquals(mem3.roleId, "developer");

    // 4. Create global-scoped memory
    const globalRes = await handleHttpRequest(
      new Request("http://localhost:8000/api/memories", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          key: "org-motto",
          summary: "Quality first development",
          content: "Always run full test suites before committing",
          scope: "global",
          tags: ["culture"],
        }),
      }),
    );
    assertEquals(globalRes.status, 201);
    const mem4 = (await globalRes.json()).memory;
    assertEquals(mem4.scope, "global");

    // 5. Upsert existing memory (same key and scope)
    const updateRes = await handleHttpRequest(
      new Request("http://localhost:8000/api/memories", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          key: "auth-strategy",
          summary: "OAuth2 with PKCE and Passkeys",
          content: "Updated auth guide with WebAuthn support",
          scope: "workflow",
          workflowId: "wf-100",
          tags: ["auth", "security", "passkey"],
        }),
      }),
    );
    assertEquals(updateRes.status, 200);
    const updateData = await updateRes.json();
    assertEquals(updateData.created, false);
    assertEquals(updateData.memory.id, mem1.id);
    assertEquals(updateData.memory.summary, "OAuth2 with PKCE and Passkeys");
    assertEquals(updateData.memory.tags, ["auth", "security", "passkey"]);

    // 6. List all memories
    const listAllRes = await handleHttpRequest(
      new Request("http://localhost:8000/api/memories", {
        method: "GET",
        headers: authHeaders,
      }),
    );
    assertEquals(listAllRes.status, 200);
    const listAllData = await listAllRes.json();
    assertEquals(listAllData.count, 4);

    // 7. Filter by scope=workflow
    const listWfRes = await handleHttpRequest(
      new Request("http://localhost:8000/api/memories?scope=workflow", {
        method: "GET",
        headers: authHeaders,
      }),
    );
    assertEquals(listWfRes.status, 200);
    const listWfData = await listWfRes.json();
    assertEquals(listWfData.count, 1);
    assertEquals(listWfData.memories[0].id, mem1.id);

    // 8. Filter by workflowId & nodeId
    const listNodeRes = await handleHttpRequest(
      new Request("http://localhost:8000/api/memories?workflowId=wf-100&nodeId=node-parse", {
        method: "GET",
        headers: authHeaders,
      }),
    );
    assertEquals(listNodeRes.status, 200);
    const listNodeData = await listNodeRes.json();
    assertEquals(listNodeData.count, 1);
    assertEquals(listNodeData.memories[0].id, mem2.id);

    // 9. Filter by roleId
    const listRoleRes = await handleHttpRequest(
      new Request("http://localhost:8000/api/memories?roleId=developer", {
        method: "GET",
        headers: authHeaders,
      }),
    );
    assertEquals(listRoleRes.status, 200);
    const listRoleData = await listRoleRes.json();
    assertEquals(listRoleData.count, 1);
    assertEquals(listRoleData.memories[0].id, mem3.id);

    // 10. Filter by tags (multiple params and comma-separated)
    const listTagsRes = await handleHttpRequest(
      new Request("http://localhost:8000/api/memories?tags=passkey,security&tags=auth", {
        method: "GET",
        headers: authHeaders,
      }),
    );
    assertEquals(listTagsRes.status, 200);
    const listTagsData = await listTagsRes.json();
    assertEquals(listTagsData.count, 1);
    assertEquals(listTagsData.memories[0].id, mem1.id);

    // 11. Test limit parameter
    const listLimitRes = await handleHttpRequest(
      new Request("http://localhost:8000/api/memories?limit=2", {
        method: "GET",
        headers: authHeaders,
      }),
    );
    assertEquals(listLimitRes.status, 200);
    const listLimitData = await listLimitRes.json();
    assertEquals(listLimitData.count, 2);
    assertEquals(listLimitData.memories.length, 2);
  } finally {
    kv.close();
  }
});

Deno.test("Memory REST Endpoints - Recall & Access Audit Logging (GET /api/memories/:id and /access-log)", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    const userId = "user_mem_recall";
    const tokenInfo = await createApiToken(userId, "Recall Token");
    const authHeaders = {
      "Authorization": `Bearer ${tokenInfo.token}`,
      "Content-Type": "application/json",
    };

    // 1. Create a memory
    const createRes = await handleHttpRequest(
      new Request("http://localhost:8000/api/memories", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          key: "db-pooling",
          summary: "Connection pool sizing guidelines",
          content: "Max connections = (cores * 2) + effective_spindle_count",
          scope: "global",
          tags: ["database", "performance"],
        }),
      }),
    );
    assertEquals(createRes.status, 201);
    const memory = (await createRes.json()).memory;
    const memId = memory.id;
    assertEquals(memory.accessCount, 0);

    // 2. Recall memory with explicit taskId, executionId, accessedBy
    const recallRes1 = await handleHttpRequest(
      new Request(
        `http://localhost:8000/api/memories/${memId}?taskId=tk-task-01&executionId=ex-run-01&accessedBy=agent-db-expert`,
        {
          method: "GET",
          headers: authHeaders,
        },
      ),
    );
    assertEquals(recallRes1.status, 200);
    const recallData1 = await recallRes1.json();
    assertEquals(recallData1.memory.id, memId);
    assertEquals(recallData1.memory.accessCount, 1);
    assertExists(recallData1.memory.lastAccessed);

    // 3. Recall memory with default accessedBy (fallback to auth)
    const recallRes2 = await handleHttpRequest(
      new Request(`http://localhost:8000/api/memories/${memId}`, {
        method: "GET",
        headers: authHeaders,
      }),
    );
    assertEquals(recallRes2.status, 200);
    const recallData2 = await recallRes2.json();
    assertEquals(recallData2.memory.accessCount, 2);

    // 4. Fetch access log history
    const logRes = await handleHttpRequest(
      new Request(`http://localhost:8000/api/memories/${memId}/access-log`, {
        method: "GET",
        headers: authHeaders,
      }),
    );
    assertEquals(logRes.status, 200);
    const logData = await logRes.json();
    assertEquals(logData.count, 2);
    assertEquals(logData.records.length, 2);

    // Verify record fields
    const expertRecord = logData.records.find((r: { accessedBy: string }) =>
      r.accessedBy === "agent-db-expert"
    );
    assert(expertRecord, "Expert access record should exist");
    assertEquals(expertRecord.memoryId, memId);
    assertEquals(expertRecord.taskId, "tk-task-01");
    assertEquals(expertRecord.executionId, "ex-run-01");

    const userRecord = logData.records.find((r: { accessedBy: string }) => r.accessedBy === userId);
    assert(userRecord, "User access record should exist");
    assertEquals(userRecord.memoryId, memId);

    // 5. Test limit on access log
    const limitedLogRes = await handleHttpRequest(
      new Request(`http://localhost:8000/api/memories/${memId}/access-log?limit=1`, {
        method: "GET",
        headers: authHeaders,
      }),
    );
    assertEquals(limitedLogRes.status, 200);
    const limitedLogData = await limitedLogRes.json();
    assertEquals(limitedLogData.count, 1);
  } finally {
    kv.close();
  }
});

Deno.test("Memory REST Endpoints - Deletion and Index Cleanup (DELETE /api/memories/:id)", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    const userId = "user_mem_delete";
    const tokenInfo = await createApiToken(userId, "Delete Token");
    const authHeaders = {
      "Authorization": `Bearer ${tokenInfo.token}`,
      "Content-Type": "application/json",
    };

    // 1. Create a memory
    const createRes = await handleHttpRequest(
      new Request("http://localhost:8000/api/memories", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          key: "temp-cache-config",
          summary: "Temporary Redis caching notes",
          content: "Use 60s TTL for fast-moving metrics",
          scope: "workflow",
          workflowId: "wf-ephemeral",
          tags: ["cache"],
        }),
      }),
    );
    const memId = (await createRes.json()).memory.id;

    // 2. Recall memory twice to record access history
    await handleHttpRequest(
      new Request(`http://localhost:8000/api/memories/${memId}?accessedBy=worker-1`, {
        method: "GET",
        headers: authHeaders,
      }),
    );
    await handleHttpRequest(
      new Request(`http://localhost:8000/api/memories/${memId}?accessedBy=worker-2`, {
        method: "GET",
        headers: authHeaders,
      }),
    );

    // 3. Delete memory
    const delRes = await handleHttpRequest(
      new Request(`http://localhost:8000/api/memories/${memId}`, {
        method: "DELETE",
        headers: authHeaders,
      }),
    );
    assertEquals(delRes.status, 200);
    const delData = await delRes.json();
    assertEquals(delData.success, true);
    assertEquals(delData.deleted, true);
    assertEquals(delData.accessCount, 2);

    // 4. GET deleted memory returns 404
    const getAfterDel = await handleHttpRequest(
      new Request(`http://localhost:8000/api/memories/${memId}`, {
        method: "GET",
        headers: authHeaders,
      }),
    );
    assertEquals(getAfterDel.status, 404);

    // 5. Listing memories shows 0
    const listRes = await handleHttpRequest(
      new Request("http://localhost:8000/api/memories", {
        method: "GET",
        headers: authHeaders,
      }),
    );
    assertEquals(listRes.status, 200);
    assertEquals((await listRes.json()).count, 0);

    // 6. Deleting already deleted / non-existent ID returns 404
    const delAgainRes = await handleHttpRequest(
      new Request(`http://localhost:8000/api/memories/${memId}`, {
        method: "DELETE",
        headers: authHeaders,
      }),
    );
    assertEquals(delAgainRes.status, 404);
  } finally {
    kv.close();
  }
});

Deno.test("Memory REST Endpoints - Error Cases and Input Validation", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    const userId = "user_mem_errors";
    const tokenInfo = await createApiToken(userId, "Error Token");
    const authHeaders = {
      "Authorization": `Bearer ${tokenInfo.token}`,
      "Content-Type": "application/json",
    };

    // 1. Non-matching route returns null from handleMemoryRoutes
    const nonMatchingRes = await handleMemoryRoutes(
      new Request("http://localhost:8000/api/unknown"),
      new URL("http://localhost:8000/api/unknown"),
      null,
    );
    assertEquals(nonMatchingRes, null);

    // 2. POST /api/memories with empty/invalid JSON body
    const emptyBodyRes = await handleHttpRequest(
      new Request("http://localhost:8000/api/memories", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify(null),
      }),
    );
    assertEquals(emptyBodyRes.status, 400);
    assert((await emptyBodyRes.json()).error.includes("Invalid JSON payload"));

    // 3. POST /api/memories missing key
    const missingKeyRes = await handleHttpRequest(
      new Request("http://localhost:8000/api/memories", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          summary: "Summary without key",
          content: "Content",
          scope: "global",
        }),
      }),
    );
    assertEquals(missingKeyRes.status, 400);
    assert((await missingKeyRes.json()).error.includes("Memory key is required"));

    // 4. POST /api/memories missing summary
    const missingSummaryRes = await handleHttpRequest(
      new Request("http://localhost:8000/api/memories", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          key: "test-key",
          content: "Content",
          scope: "global",
        }),
      }),
    );
    assertEquals(missingSummaryRes.status, 400);
    assert((await missingSummaryRes.json()).error.includes("Memory summary is required"));

    // 5. POST /api/memories missing content
    const missingContentRes = await handleHttpRequest(
      new Request("http://localhost:8000/api/memories", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          key: "test-key",
          summary: "Test summary",
          scope: "global",
        }),
      }),
    );
    assertEquals(missingContentRes.status, 400);
    assert((await missingContentRes.json()).error.includes("Memory content is required"));

    // 6. POST /api/memories missing scope
    const missingScopeRes = await handleHttpRequest(
      new Request("http://localhost:8000/api/memories", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          key: "test-key",
          summary: "Test summary",
          content: "Content",
        }),
      }),
    );
    assertEquals(missingScopeRes.status, 400);
    assert((await missingScopeRes.json()).error.includes("Memory scope is required"));

    // 7. GET /api/memories/:id not found
    const notFoundRes = await handleHttpRequest(
      new Request("http://localhost:8000/api/memories/mem-does-not-exist", {
        method: "GET",
        headers: authHeaders,
      }),
    );
    assertEquals(notFoundRes.status, 404);
    assert((await notFoundRes.json()).error.includes("not found"));

    // 8. GET /api/memories/:id/access-log with non-existent ID returns empty list
    const emptyLogRes = await handleHttpRequest(
      new Request("http://localhost:8000/api/memories/mem-does-not-exist/access-log", {
        method: "GET",
        headers: authHeaders,
      }),
    );
    assertEquals(emptyLogRes.status, 200);
    assertEquals((await emptyLogRes.json()).count, 0);
  } finally {
    kv.close();
  }
});

Deno.test("Role & Journal REST Endpoints - Full Lifecycle (Roles, Enriched Journals, Overwrite)", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    const userId = "user_role_journal";
    const tokenInfo = await createApiToken(userId, "Role Journal Token");
    const authHeaders = {
      "Authorization": `Bearer ${tokenInfo.token}`,
      "Content-Type": "application/json",
    };

    // 1. GET /api/roles initially empty
    const initialRolesRes = await handleHttpRequest(
      new Request("http://localhost:8000/api/roles", {
        method: "GET",
        headers: authHeaders,
      }),
    );
    assertEquals(initialRolesRes.status, 200);
    assertEquals((await initialRolesRes.json()).count, 0);

    // 2. POST /api/roles - Create role "qa-engineer"
    const createRoleRes = await handleHttpRequest(
      new Request("http://localhost:8000/api/roles", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          name: "qa-engineer",
          description: "Responsible for automated test suites and coverage",
        }),
      }),
    );
    assertEquals(createRoleRes.status, 201);
    const roleData = await createRoleRes.json();
    assertEquals(roleData.role.name, "qa-engineer");
    assertEquals(roleData.role.description, "Responsible for automated test suites and coverage");

    // 3. POST /api/roles error handling (missing name, invalid body)
    const emptyRoleRes = await handleHttpRequest(
      new Request("http://localhost:8000/api/roles", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({}),
      }),
    );
    assertEquals(emptyRoleRes.status, 400);
    assert((await emptyRoleRes.json()).error.includes("Role name is required"));

    // 4. GET /api/journals/qa-engineer before writing journal -> journal: null
    const noJournalRes = await handleHttpRequest(
      new Request("http://localhost:8000/api/journals/qa-engineer", {
        method: "GET",
        headers: authHeaders,
      }),
    );
    assertEquals(noJournalRes.status, 200);
    assertEquals((await noJournalRes.json()).journal, null);

    // 5. POST /api/journals/qa-engineer - Write initial journal entry
    const writeJournalRes1 = await handleHttpRequest(
      new Request("http://localhost:8000/api/journals/qa-engineer", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          entry: "Phase 1: Added full REST memory tests",
          writtenBy: "qa-agent-1",
        }),
      }),
    );
    assertEquals(writeJournalRes1.status, 200);
    const journalData1 = await writeJournalRes1.json();
    assertEquals(journalData1.journal.roleId, "qa-engineer");
    assertEquals(journalData1.journal.entry, "Phase 1: Added full REST memory tests");
    assertEquals(journalData1.journal.writtenBy, "qa-agent-1");
    assertExists(journalData1.journal.writtenAt);

    // 6. POST /api/journals/qa-engineer with content field (alternative property name) and overwrite
    const writeJournalRes2 = await handleHttpRequest(
      new Request("http://localhost:8000/api/journals/qa-engineer", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          content: "Phase 2: Verified multi-tenant isolation and Web UI dashboards",
        }),
      }),
    );
    assertEquals(writeJournalRes2.status, 200);
    const journalData2 = await writeJournalRes2.json();
    assertEquals(
      journalData2.journal.entry,
      "Phase 2: Verified multi-tenant isolation and Web UI dashboards",
    );
    assertEquals(journalData2.journal.writtenBy, userId);

    // 7. POST /api/journals error handling (missing entry/content)
    const emptyJournalRes = await handleHttpRequest(
      new Request("http://localhost:8000/api/journals/qa-engineer", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ writtenBy: "qa-agent" }),
      }),
    );
    assertEquals(emptyJournalRes.status, 400);
    assert((await emptyJournalRes.json()).error.includes("Journal entry content is required"));

    // 8. GET /api/journals/qa-engineer returns latest overwritten journal
    const readJournalRes = await handleHttpRequest(
      new Request("http://localhost:8000/api/journals/qa-engineer", {
        method: "GET",
        headers: authHeaders,
      }),
    );
    assertEquals(readJournalRes.status, 200);
    const readJournalData = await readJournalRes.json();
    assertEquals(
      readJournalData.journal.entry,
      "Phase 2: Verified multi-tenant isolation and Web UI dashboards",
    );

    // 9. GET /api/roles returns roles enriched with their latest journal
    const listRolesRes = await handleHttpRequest(
      new Request("http://localhost:8000/api/roles", {
        method: "GET",
        headers: authHeaders,
      }),
    );
    assertEquals(listRolesRes.status, 200);
    const listRolesData = await listRolesRes.json();
    assertEquals(listRolesData.count, 1);
    const roleItem = listRolesData.roles[0];
    assertEquals(roleItem.name, "qa-engineer");
    assertExists(roleItem.journal);
    assertEquals(
      roleItem.journal.entry,
      "Phase 2: Verified multi-tenant isolation and Web UI dashboards",
    );
  } finally {
    kv.close();
  }
});

Deno.test("Multi-Tenant User Isolation - Memories, Roles, and Journals Separation", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    const userAToken = (await createApiToken("tenant_user_a", "User A")).token;
    const userBToken = (await createApiToken("tenant_user_b", "User B")).token;

    const headersA = {
      "Authorization": `Bearer ${userAToken}`,
      "Content-Type": "application/json",
    };
    const headersB = {
      "Authorization": `Bearer ${userBToken}`,
      "Content-Type": "application/json",
    };

    // User A creates a memory
    const createMemA = await handleHttpRequest(
      new Request("http://localhost:8000/api/memories", {
        method: "POST",
        headers: headersA,
        body: JSON.stringify({
          key: "user-a-secret",
          summary: "Confidential Project Info",
          content: "Top secret credentials",
          scope: "global",
        }),
      }),
    );
    assertEquals(createMemA.status, 201);
    const memAId = (await createMemA.json()).memory.id;

    // User A creates a role and journal
    await handleHttpRequest(
      new Request("http://localhost:8000/api/roles", {
        method: "POST",
        headers: headersA,
        body: JSON.stringify({
          name: "lead-architect",
          description: "System architect",
        }),
      }),
    );
    await handleHttpRequest(
      new Request("http://localhost:8000/api/journals/lead-architect", {
        method: "POST",
        headers: headersA,
        body: JSON.stringify({
          entry: "Architectural blueprint completed for User A",
        }),
      }),
    );

    // User B lists memories -> sees 0
    const listB = await handleHttpRequest(
      new Request("http://localhost:8000/api/memories", {
        method: "GET",
        headers: headersB,
      }),
    );
    assertEquals(listB.status, 200);
    assertEquals((await listB.json()).count, 0);

    // User B attempts to recall User A's memory -> 404
    const recallB = await handleHttpRequest(
      new Request(`http://localhost:8000/api/memories/${memAId}`, {
        method: "GET",
        headers: headersB,
      }),
    );
    assertEquals(recallB.status, 404);

    // User B attempts to delete User A's memory -> 404
    const deleteB = await handleHttpRequest(
      new Request(`http://localhost:8000/api/memories/${memAId}`, {
        method: "DELETE",
        headers: headersB,
      }),
    );
    assertEquals(deleteB.status, 404);

    // User B lists roles -> sees 0
    const listRolesB = await handleHttpRequest(
      new Request("http://localhost:8000/api/roles", {
        method: "GET",
        headers: headersB,
      }),
    );
    assertEquals(listRolesB.status, 200);
    assertEquals((await listRolesB.json()).count, 0);

    // User B reads journal for lead-architect -> returns null
    const journalB = await handleHttpRequest(
      new Request("http://localhost:8000/api/journals/lead-architect", {
        method: "GET",
        headers: headersB,
      }),
    );
    assertEquals(journalB.status, 200);
    assertEquals((await journalB.json()).journal, null);

    // User B creates own memory, role, and journal independently
    const createMemB = await handleHttpRequest(
      new Request("http://localhost:8000/api/memories", {
        method: "POST",
        headers: headersB,
        body: JSON.stringify({
          key: "user-b-notes",
          summary: "User B Notes",
          content: "Independent notes",
          scope: "global",
        }),
      }),
    );
    assertEquals(createMemB.status, 201);
    const memBId = (await createMemB.json()).memory.id;
    assertNotEquals(memBId, memAId);

    // User A cannot recall User B's memory
    const recallA = await handleHttpRequest(
      new Request(`http://localhost:8000/api/memories/${memBId}`, {
        method: "GET",
        headers: headersA,
      }),
    );
    assertEquals(recallA.status, 404);
  } finally {
    kv.close();
  }
});

Deno.test("Web UI Routes - HTML Rendering and Context / Role Journal Elements (/memories, /journals, /tasks)", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    // 1. GET /memories - Memory Vault & Explorer UI
    const memUiRes = await handleHttpRequest(
      new Request("http://localhost:8000/memories", { method: "GET" }),
    );
    assertEquals(memUiRes.status, 200);
    assertEquals(memUiRes.headers.get("content-type"), "text/html; charset=utf-8");
    const memHtml = await memUiRes.text();
    assert(memHtml.includes("Workflow MCP"));
    assert(memHtml.includes('class="nav-tab active" id="tab-btn-memories"'));
    assert(memHtml.includes('id="memoriesGrid"'));
    assert(memHtml.includes('id="memoryDetailModal"'));
    assert(memHtml.includes('id="newMemoryModal"'));
    assert(memHtml.includes('id="memStatTotal"'));
    assert(memHtml.includes('id="memStatWorkflow"'));
    assert(memHtml.includes('id="memStatRole"'));

    // 2. GET /journals - Role Journals UI
    const journalUiRes = await handleHttpRequest(
      new Request("http://localhost:8000/journals", { method: "GET" }),
    );
    assertEquals(journalUiRes.status, 200);
    assertEquals(journalUiRes.headers.get("content-type"), "text/html; charset=utf-8");
    const journalHtml = await journalUiRes.text();
    assert(journalHtml.includes('class="nav-tab active" id="tab-btn-journals"'));
    assert(journalHtml.includes('id="rolesGrid"'));
    assert(journalHtml.includes('id="editJournalModal"'));
    assert(journalHtml.includes('id="newRoleModal"'));
    assert(journalHtml.includes("Role Journals"));

    // 3. GET /tasks - Task Kanban Board UI
    const tasksUiRes = await handleHttpRequest(
      new Request("http://localhost:8000/tasks", { method: "GET" }),
    );
    assertEquals(tasksUiRes.status, 200);
    assertEquals(tasksUiRes.headers.get("content-type"), "text/html; charset=utf-8");
    const tasksHtml = await tasksUiRes.text();
    assert(tasksHtml.includes('class="nav-tab active" id="tab-btn-tasks"'));
    assert(tasksHtml.includes('id="tasksView"'));
    assert(tasksHtml.includes('id="kanbanBoard"'));

    // 4. Verify Task Detail modal contains Context & Role Journal elements
    assert(tasksHtml.includes('id="taskContextSection"'));
    assert(
      tasksHtml.includes("Context &amp; Role Journal") ||
        tasksHtml.includes("Context & Role Journal"),
    );
    assert(tasksHtml.includes('id="taskRoleJournalContainer"'));
    assert(tasksHtml.includes('id="taskMemoriesContainer"'));
    assert(tasksHtml.includes('id="detailContext"'));
    assert(tasksHtml.includes("Relevant Memories:"));
  } finally {
    kv.close();
  }
});
