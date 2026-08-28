import { assert, assertEquals } from "@std/assert";
import { createApiToken } from "./auth/oauth.ts";
import { handleHttpRequest } from "./http_server.ts";
import { setKv } from "./store/kv.ts";

Deno.test("HTTP Server - Health and Discovery Endpoints", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    // 1. Health Probe
    const healthReq = new Request("http://localhost:8000/health", { method: "GET" });
    const healthRes = await handleHttpRequest(healthReq);
    assertEquals(healthRes.status, 200);
    const healthData = await healthRes.json();
    assertEquals(healthData.status, "ok");
    assertEquals(healthData.server, "workflow-mcp");

    // 2. Discovery Homepage
    const homeReq = new Request("http://localhost:8000/", {
      method: "GET",
      headers: { "Accept": "text/html" },
    });
    const homeRes = await handleHttpRequest(homeReq);
    assertEquals(homeRes.status, 200);
    const homeHtml = await homeRes.text();
    assert(homeHtml.includes("Workflow MCP Remote Server"));
    assert(homeHtml.includes("Stateless JSON-RPC"));
    assert(homeHtml.includes("switchAuthTab"));

    // Verify embedded script syntax
    const scriptMatch = homeHtml.match(/<script>([\s\S]*?)<\/script>/i);
    assert(scriptMatch, "Landing page must contain an inline script");
    // Ensure script parses without syntax error (e.g. invalid regex literals)
    new Function(scriptMatch[1]);

    // 3. CORS Preflight
    const corsReq = new Request("http://localhost:8000/mcp", { method: "OPTIONS" });
    const corsRes = await handleHttpRequest(corsReq);
    assertEquals(corsRes.status, 204);
    assertEquals(corsRes.headers.get("Access-Control-Allow-Origin"), "*");
  } finally {
    kv.close();
  }
});

Deno.test("HTTP Server - Bearer Token Lifecycle & Auth Guard", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    // 1. Unauthenticated /api/me and /api/tokens should be 401 with WWW-Authenticate
    const unauthReq = new Request("http://localhost:8000/api/me", { method: "GET" });
    const unauthRes = await handleHttpRequest(unauthReq);
    assertEquals(unauthRes.status, 401);
    assert(unauthRes.headers.get("www-authenticate")?.includes("oauth-protected-resource"));

    const unauthTokensReq = new Request("http://localhost:8000/api/tokens", { method: "GET" });
    const unauthTokensRes = await handleHttpRequest(unauthTokensReq);
    assertEquals(unauthTokensRes.status, 401);
    assert(unauthTokensRes.headers.get("www-authenticate")?.includes("oauth-protected-resource"));

    // 2. Generate a token directly
    const tokenInfo = await createApiToken("user_charlie", "Charlie Work Laptop", 30);
    assert(tokenInfo.token.startsWith("wf_"));

    // 3. Authenticate /api/me with the Bearer token
    const authReq = new Request("http://localhost:8000/api/me", {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${tokenInfo.token}`,
      },
    });
    const authRes = await handleHttpRequest(authReq);
    assertEquals(authRes.status, 200);
    const authData = await authRes.json();
    assertEquals(authData.userId, "user_charlie");
    assertEquals(authData.authMethod, "bearer");

    // 4. Create another token via /api/token endpoint
    const createTokenReq = new Request("http://localhost:8000/api/token", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${tokenInfo.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "CI/CD Token", expiresInDays: 7 }),
    });
    const createTokenRes = await handleHttpRequest(createTokenReq);
    assertEquals(createTokenRes.status, 201);
    const newTokenData = await createTokenRes.json();
    assert(newTokenData.token.startsWith("wf_"));
    assertEquals(newTokenData.name, "CI/CD Token");

    // 5. List tokens
    const listTokensReq = new Request("http://localhost:8000/api/tokens", {
      method: "GET",
      headers: { "Authorization": `Bearer ${tokenInfo.token}` },
    });
    const listTokensRes = await handleHttpRequest(listTokensReq);
    assertEquals(listTokensRes.status, 200);
    const listTokensData = await listTokensRes.json();
    assertEquals(listTokensData.tokens.length, 2);

    // 6. Revoke token
    const revokeReq = new Request(`http://localhost:8000/api/tokens/${newTokenData.id}`, {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${tokenInfo.token}` },
    });
    const revokeRes = await handleHttpRequest(revokeReq);
    assertEquals(revokeRes.status, 200);

    // Verify revoked token cannot authenticate
    const revokedAuthReq = new Request("http://localhost:8000/api/me", {
      method: "GET",
      headers: { "Authorization": `Bearer ${newTokenData.token}` },
    });
    const revokedAuthRes = await handleHttpRequest(revokedAuthReq);
    assertEquals(revokedAuthRes.status, 401);
  } finally {
    kv.close();
  }
});

Deno.test("HTTP Server - Stateless JSON-RPC MCP Tools Protocol & User Scoping", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    // Create tokens for two separate users
    const aliceToken = (await createApiToken("user_alice", "Alice")).token;
    const bobToken = (await createApiToken("user_bob", "Bob")).token;

    // 1. Initialize call (Alice)
    const initReq = new Request("http://localhost:8000/mcp", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${aliceToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          clientInfo: { name: "test-runner", version: "1.0.0" },
        },
      }),
    });
    const initRes = await handleHttpRequest(initReq);
    assertEquals(initRes.status, 200);
    const initData = await initRes.json();
    assertEquals(initData.result.serverInfo.name, "workflow-mcp");
    assertEquals(initData.result.protocolVersion, "2024-11-05");

    // 2. Tools List call (Alice)
    const listToolsReq = new Request("http://localhost:8000/mcp", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${aliceToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
      }),
    });
    const listToolsRes = await handleHttpRequest(listToolsReq);
    assertEquals(listToolsRes.status, 200);
    const listToolsData = await listToolsRes.json();
    assert(listToolsData.result.tools.length >= 16);

    // 3. Alice creates a workflow via tools/call
    const createWfReq = new Request("http://localhost:8000/mcp", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${aliceToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "workflow_create",
          arguments: {
            name: "Alice Remote Graph",
            description: "Serverless execution",
          },
        },
      }),
    });
    const createWfRes = await handleHttpRequest(createWfReq);
    assertEquals(createWfRes.status, 200);
    const createWfData = await createWfRes.json();
    assertEquals(createWfData.result.isError, undefined);
    const createdPayload = JSON.parse(createWfData.result.content[0].text);
    const aliceWfId = createdPayload.workflow.id;
    assertEquals(createdPayload.workflow.name, "Alice Remote Graph");

    // 4. Bob calls workflow_list via tools/call — should see 0 workflows
    const bobListReq = new Request("http://localhost:8000/mcp", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${bobToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "workflow_list",
          arguments: {
            format: "json",
          },
        },
      }),
    });
    const bobListRes = await handleHttpRequest(bobListReq);
    assertEquals(bobListRes.status, 200);
    const bobListData = await bobListRes.json();
    const bobWorkflows = JSON.parse(bobListData.result.content[0].text);
    assertEquals(bobWorkflows.length, 0);

    // 5. Bob tries to get Alice's workflow — should get error / not found
    const bobGetReq = new Request("http://localhost:8000/mcp", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${bobToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: {
          name: "workflow_get",
          arguments: {
            workflowId: aliceWfId,
          },
        },
      }),
    });
    const bobGetRes = await handleHttpRequest(bobGetReq);
    const bobGetData = await bobGetRes.json();
    assertEquals(bobGetData.result.isError, true);
    assert(bobGetData.result.content[0].text.includes("not found"));

    // 6. Alice lists workflows — should see 1
    const aliceListReq = new Request("http://localhost:8000/mcp", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${aliceToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: {
          name: "workflow_list",
          arguments: { format: "json" },
        },
      }),
    });
    const aliceListRes = await handleHttpRequest(aliceListReq);
    const aliceListData = await aliceListRes.json();
    const aliceWorkflows = JSON.parse(aliceListData.result.content[0].text);
    assertEquals(aliceWorkflows.length, 1);
    assertEquals(aliceWorkflows[0].id, aliceWfId);
  } finally {
    kv.close();
  }
});

Deno.test("HTTP Server - Batch JSON-RPC and Notifications", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    const token = (await createApiToken("user_batch", "Batch User")).token;

    // Batch request: initialize + ping + notification
    const batchReq = new Request("http://localhost:8000/mcp", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        { jsonrpc: "2.0", id: 10, method: "initialize", params: {} },
        { jsonrpc: "2.0", id: 11, method: "ping" },
        { jsonrpc: "2.0", method: "notifications/initialized" },
      ]),
    });
    const batchRes = await handleHttpRequest(batchReq);
    assertEquals(batchRes.status, 200);
    const batchData = await batchRes.json();
    assertEquals(Array.isArray(batchData), true);
    assertEquals(batchData.length, 2); // 2 responses (notification omitted)
    assertEquals(batchData[0].id, 10);
    assertEquals(batchData[1].id, 11);
  } finally {
    kv.close();
  }
});

Deno.test("HTTP Server - Authenticated Passkey Management Lifecycle", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    const userId = "user_passkey_mgr";
    const tokenInfo = await createApiToken(userId, "Manager Token");

    // 1. Unauthenticated /api/passkeys should return 401 Unauthorized with WWW-Authenticate
    const unauthReq = new Request("http://localhost:8000/api/passkeys", { method: "GET" });
    const unauthRes = await handleHttpRequest(unauthReq);
    assertEquals(unauthRes.status, 401);
    assert(unauthRes.headers.get("www-authenticate")?.includes("oauth-protected-resource"));

    // 2. Add sample passkeys in KV
    await kv.set(["users", userId, "passkeys", "key_laptop"], {
      id: "key_laptop",
      publicKey: "pk1",
      counter: 0,
      deviceType: "platform",
      createdAt: new Date().toISOString(),
    });
    await kv.set(["users", userId, "passkeys", "key_yubikey"], {
      id: "key_yubikey",
      publicKey: "pk2",
      counter: 0,
      deviceType: "cross-platform",
      createdAt: new Date().toISOString(),
    });

    // 3. List passkeys authenticated
    const listReq = new Request("http://localhost:8000/api/passkeys", {
      method: "GET",
      headers: { "Authorization": `Bearer ${tokenInfo.token}` },
    });
    const listRes = await handleHttpRequest(listReq);
    assertEquals(listRes.status, 200);
    const listData = await listRes.json();
    assertEquals(listData.passkeys.length, 2);

    // 4. Delete one passkey
    const delReq = new Request("http://localhost:8000/api/passkeys/key_laptop", {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${tokenInfo.token}` },
    });
    const delRes = await handleHttpRequest(delReq);
    assertEquals(delRes.status, 200);

    // 5. Deleting the last passkey fails with 400
    const delLastReq = new Request("http://localhost:8000/api/passkeys/key_yubikey", {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${tokenInfo.token}` },
    });
    const delLastRes = await handleHttpRequest(delLastReq);
    assertEquals(delLastRes.status, 400);
    const delLastData = await delLastRes.json();
    assert(delLastData.error.includes("only registered passkey"));
  } finally {
    kv.close();
  }
});

import { createViewTicket, saveNode, saveWorkflow } from "./store/kv.ts";

Deno.test("HTTP Server - SSR Visualizer and 30-Minute Share Ticket Routes", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    const userId = "user_viz_test";
    const tokenInfo = await createApiToken(userId, "Viz Token");
    const now = new Date().toISOString();

    // 1. Create a workflow and nodes in KV
    const workflowId = "wf-ssr-1";
    await saveWorkflow({
      id: workflowId,
      name: "SSR Test Pipeline",
      description: "Testing server-side rendering",
      createdAt: now,
      updatedAt: now,
    }, userId);

    await saveNode({
      id: "node-start",
      workflowId,
      type: "start",
      name: "Begin",
      description: "Starting node",
      runInSubAgent: false,
      config: {},
      status: "completed",
      error: null,
      createdAt: now,
      updatedAt: now,
    }, userId);

    await saveNode({
      id: "node-step",
      workflowId,
      type: "step",
      name: "Transform Records",
      description: "Data transformation step",
      runInSubAgent: true,
      config: {},
      status: "running",
      error: null,
      createdAt: now,
      updatedAt: now,
    }, userId);

    // 2. Unauthenticated request without ticket -> 401
    const unauthReq = new Request(`http://localhost:8000/visualize/${workflowId}`, {
      method: "GET",
    });
    const unauthRes = await handleHttpRequest(unauthReq);
    assertEquals(unauthRes.status, 401);
    const unauthHtml = await unauthRes.text();
    assert(unauthHtml.includes("Access Restricted"));

    // 3. Authenticated request with Bearer token -> 200 OK SSR HTML
    const authReq = new Request(`http://localhost:8000/visualize/${workflowId}`, {
      method: "GET",
      headers: { "Authorization": `Bearer ${tokenInfo.token}` },
    });
    const authRes = await handleHttpRequest(authReq);
    assertEquals(authRes.status, 200);
    const authHtml = await authRes.text();
    assert(authHtml.includes("SSR Test Pipeline"));
    assert(authHtml.includes('id="cy"'));
    assert(authHtml.includes("Transform Records"));
    assert(authHtml.includes("⚡ Sub-Agent"));
    assert(!authHtml.includes("cdnjs.cloudflare.com"));

    // 4. Create View Ticket with default 1 week expiration
    const defaultTicket = await createViewTicket(workflowId, undefined, undefined, userId);
    assert(defaultTicket.ticketId);
    assert(defaultTicket.expiresAt > Date.now() + 6 * 24 * 60 * 60 * 1000); // at least 6+ days

    const ticket = await createViewTicket(workflowId, undefined, 30, userId);
    assert(ticket.ticketId);

    // 5. Unauthenticated request with valid ticket -> 200 OK SSR HTML
    const ticketReq = new Request(
      `http://localhost:8000/visualize/${workflowId}?ticket=${defaultTicket.ticketId}`,
      {
        method: "GET",
      },
    );
    const ticketRes = await handleHttpRequest(ticketReq);
    assertEquals(ticketRes.status, 200);
    const ticketHtml = await ticketRes.text();
    assert(ticketHtml.includes("SSR Test Pipeline"));
    assert(ticketHtml.includes("Shared Link"));
    assert(ticketHtml.includes("Transform Records"));

    // 6. Test polling endpoint /api/visualize/:workflowId/data with ticket
    const dataReq = new Request(
      `http://localhost:8000/api/visualize/${workflowId}/data?ticket=${ticket.ticketId}`,
      {
        method: "GET",
      },
    );
    const dataRes = await handleHttpRequest(dataReq);
    assertEquals(dataRes.status, 200);
    const dataJson = await dataRes.json();
    assertEquals(dataJson.workflow.workflow.name, "SSR Test Pipeline");
    assertEquals(dataJson.workflow.nodes.length, 2);

    // 7. Expired Ticket test (set expiration to past)
    await kv.set(["view_tickets", ticket.ticketId], {
      ...ticket,
      expiresAt: Date.now() - 1000,
    });

    const expiredReq = new Request(
      `http://localhost:8000/visualize/${workflowId}?ticket=${ticket.ticketId}`,
      {
        method: "GET",
      },
    );
    const expiredRes = await handleHttpRequest(expiredReq);
    assertEquals(expiredRes.status, 403);
    const expiredHtml = await expiredRes.text();
    assert(expiredHtml.includes("Share Link Expired"));
  } finally {
    kv.close();
  }
});

Deno.test("HTTP Server - Task Kanban Web UI and REST API Lifecycle", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    const userId = "user_http_tasks";
    const tokenInfo = await createApiToken(userId, "Tasks Token");
    const authHeaders = {
      "Authorization": `Bearer ${tokenInfo.token}`,
      "Content-Type": "application/json",
    };

    // 1. GET /tasks renders Kanban Web UI
    const uiReq = new Request("http://localhost:8000/tasks", { method: "GET" });
    const uiRes = await handleHttpRequest(uiReq);
    assertEquals(uiRes.status, 200);
    assertEquals(uiRes.headers.get("content-type"), "text/html; charset=utf-8");
    const uiHtml = await uiRes.text();
    assert(uiHtml.includes("Tasks Board"));
    assert(uiHtml.includes("Open / Backlog"));
    assert(uiHtml.includes("In Progress"));
    assert(uiHtml.includes("256 chars"));
    assert(uiHtml.includes("kanbanBoard"));

    // 2. POST /api/tasks - Create new task
    const createReq = new Request("http://localhost:8000/api/tasks", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        title: "Integrate Kanban Board",
        description: "Add tasks web UI with Deno built-ins",
        priority: "high",
        role: "frontend",
      }),
    });
    const createRes = await handleHttpRequest(createReq);
    assertEquals(createRes.status, 201);
    const createData = await createRes.json();
    const taskId = createData.task.id;
    assert(taskId.startsWith("tk-"));
    assertEquals(createData.task.title, "Integrate Kanban Board");
    assertEquals(Array.isArray(createData.task.comments), true);
    assertEquals(createData.task.comments.length, 0);

    // 3. GET /api/tasks - List tasks
    const listReq = new Request("http://localhost:8000/api/tasks", {
      method: "GET",
      headers: authHeaders,
    });
    const listRes = await handleHttpRequest(listReq);
    assertEquals(listRes.status, 200);
    const listData = await listRes.json();
    assertEquals(listData.count, 1);
    assertEquals(listData.tasks[0].id, taskId);

    // 4. GET /api/tasks/ready - Ready frontier
    const readyReq = new Request("http://localhost:8000/api/tasks/ready", {
      method: "GET",
      headers: authHeaders,
    });
    const readyRes = await handleHttpRequest(readyReq);
    assertEquals(readyRes.status, 200);
    const readyData = await readyRes.json();
    assertEquals(readyData.count, 1);
    assertEquals(readyData.tasks[0].id, taskId);

    // 5. POST /api/tasks/:id/comments - Add short comment (<= 256 chars)
    const commentReq1 = new Request(`http://localhost:8000/api/tasks/${taskId}/comments`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        author: "alice",
        content: "UI design looks great and responsive!",
      }),
    });
    const commentRes1 = await handleHttpRequest(commentReq1);
    assertEquals(commentRes1.status, 201);
    const commentData1 = await commentRes1.json();
    assertEquals(commentData1.comment.author, "alice");
    assertEquals(commentData1.comment.content, "UI design looks great and responsive!");

    // 6. POST /api/tasks/:id/comments - Reject comment > 256 chars
    const commentReqTooLong = new Request(`http://localhost:8000/api/tasks/${taskId}/comments`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        author: "alice",
        content: "c".repeat(257),
      }),
    });
    const commentResTooLong = await handleHttpRequest(commentReqTooLong);
    assertEquals(commentResTooLong.status, 400);
    const errData = await commentResTooLong.json();
    assert(errData.error.includes("exceeds maximum length of 256 characters"));

    // 7. GET /api/tasks/:id/comments - List comments
    const getCommentsReq = new Request(`http://localhost:8000/api/tasks/${taskId}/comments`, {
      method: "GET",
      headers: authHeaders,
    });
    const getCommentsRes = await handleHttpRequest(getCommentsReq);
    assertEquals(getCommentsRes.status, 200);
    const getCommentsData = await getCommentsRes.json();
    assertEquals(getCommentsData.count, 1);
    assertEquals(getCommentsData.comments[0].content, "UI design looks great and responsive!");

    // 8. PATCH /api/tasks/:id - Update task status and assignee
    const patchReq = new Request(`http://localhost:8000/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: authHeaders,
      body: JSON.stringify({
        status: "in_progress",
        assignee: "alice",
      }),
    });
    const patchRes = await handleHttpRequest(patchReq);
    assertEquals(patchRes.status, 200);
    const patchData = await patchRes.json();
    assertEquals(patchData.task.status, "in_progress");
    assertEquals(patchData.task.assignee, "alice");

    // 9. GET /api/tasks/:id - Get task with details
    const getTaskReq = new Request(`http://localhost:8000/api/tasks/${taskId}`, {
      method: "GET",
      headers: authHeaders,
    });
    const getTaskRes = await handleHttpRequest(getTaskReq);
    assertEquals(getTaskRes.status, 200);
    const getTaskData = await getTaskRes.json();
    assertEquals(getTaskData.task.id, taskId);
    assertEquals(getTaskData.task.comments.length, 1);

    // 10. DELETE /api/tasks/:id - Delete task
    const delReq = new Request(`http://localhost:8000/api/tasks/${taskId}`, {
      method: "DELETE",
      headers: authHeaders,
    });
    const delRes = await handleHttpRequest(delReq);
    assertEquals(delRes.status, 200);

    const getAfterDelReq = new Request(`http://localhost:8000/api/tasks/${taskId}`, {
      method: "GET",
      headers: authHeaders,
    });
    const getAfterDelRes = await handleHttpRequest(getAfterDelReq);
    assertEquals(getAfterDelRes.status, 404);
  } finally {
    kv.close();
  }
});

Deno.test("HTTP Server - Memory and Role Journal REST API Lifecycle", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    const userId = "user_http_memories";
    const tokenInfo = await createApiToken(userId, "Memory Test Token");
    const authHeaders = {
      "Authorization": `Bearer ${tokenInfo.token}`,
      "Content-Type": "application/json",
    };

    // 1. POST /api/memories - Create workflow-scoped memory
    const createMemRes1 = await handleHttpRequest(
      new Request("http://localhost:8000/api/memories", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          key: "auth-strategy",
          summary: "OAuth2 with PKCE",
          content: "Use RFC 7636 PKCE for public clients",
          scope: "workflow",
          workflowId: "wf-main",
          tags: ["auth", "security"],
        }),
      }),
    );
    assertEquals(createMemRes1.status, 201);
    const createMemData1 = await createMemRes1.json();
    assertEquals(createMemData1.created, true);
    const mem1 = createMemData1.memory;
    assert(mem1.id.startsWith("mem-"));
    assertEquals(mem1.key, "auth-strategy");
    assertEquals(mem1.summary, "OAuth2 with PKCE");
    assertEquals(mem1.accessCount, 0);

    // 2. POST /api/memories - Upsert existing memory
    const updateMemRes = await handleHttpRequest(
      new Request("http://localhost:8000/api/memories", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          key: "auth-strategy",
          summary: "OAuth2 with PKCE & WebAuthn",
          content: "Use RFC 7636 PKCE and Passkeys",
          scope: "workflow",
          workflowId: "wf-main",
          tags: ["auth", "security", "passkey"],
        }),
      }),
    );
    assertEquals(updateMemRes.status, 200);
    const updateMemData = await updateMemRes.json();
    assertEquals(updateMemData.created, false);
    assertEquals(updateMemData.memory.id, mem1.id);
    assertEquals(updateMemData.memory.summary, "OAuth2 with PKCE & WebAuthn");

    // 3. POST /api/memories - Create role-scoped memory
    const createMemRes2 = await handleHttpRequest(
      new Request("http://localhost:8000/api/memories", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          key: "guidelines",
          summary: "Architecture best practices",
          content: "Always separate domain logic from routing",
          scope: "role",
          roleId: "architect",
          tags: ["architecture"],
        }),
      }),
    );
    assertEquals(createMemRes2.status, 201);
    const mem2 = (await createMemRes2.json()).memory;

    // 4. GET /api/memories - List all memories
    const listRes1 = await handleHttpRequest(
      new Request("http://localhost:8000/api/memories", {
        method: "GET",
        headers: authHeaders,
      }),
    );
    assertEquals(listRes1.status, 200);
    const listData1 = await listRes1.json();
    assertEquals(listData1.count, 2);

    // 5. GET /api/memories with filters (scope, workflowId, tags)
    const listRes2 = await handleHttpRequest(
      new Request("http://localhost:8000/api/memories?scope=workflow&workflowId=wf-main&tags=passkey", {
        method: "GET",
        headers: authHeaders,
      }),
    );
    assertEquals(listRes2.status, 200);
    const listData2 = await listRes2.json();
    assertEquals(listData2.count, 1);
    assertEquals(listData2.memories[0].id, mem1.id);

    // 6. GET /api/memories/:id - Recall memory (access log recorded)
    const recallRes = await handleHttpRequest(
      new Request(`http://localhost:8000/api/memories/${mem1.id}?taskId=tk-123&executionId=ex-456`, {
        method: "GET",
        headers: authHeaders,
      }),
    );
    assertEquals(recallRes.status, 200);
    const recallData = await recallRes.json();
    assertEquals(recallData.memory.id, mem1.id);
    assertEquals(recallData.memory.accessCount, 1);
    assert(recallData.memory.lastAccessed);

    // 7. GET /api/memories/:id/access-log - Retrieve access logs
    const accessLogRes = await handleHttpRequest(
      new Request(`http://localhost:8000/api/memories/${mem1.id}/access-log`, {
        method: "GET",
        headers: authHeaders,
      }),
    );
    assertEquals(accessLogRes.status, 200);
    const accessLogData = await accessLogRes.json();
    assertEquals(accessLogData.count, 1);
    assertEquals(accessLogData.records[0].memoryId, mem1.id);
    assertEquals(accessLogData.records[0].taskId, "tk-123");
    assertEquals(accessLogData.records[0].executionId, "ex-456");

    // 8. GET /api/memories/invalid-id - 404
    const notFoundMemRes = await handleHttpRequest(
      new Request("http://localhost:8000/api/memories/mem-nonexistent", {
        method: "GET",
        headers: authHeaders,
      }),
    );
    assertEquals(notFoundMemRes.status, 404);

    // 9. DELETE /api/memories/:id - Delete memory
    const delMemRes = await handleHttpRequest(
      new Request(`http://localhost:8000/api/memories/${mem1.id}`, {
        method: "DELETE",
        headers: authHeaders,
      }),
    );
    assertEquals(delMemRes.status, 200);
    const delMemData = await delMemRes.json();
    assertEquals(delMemData.success, true);
    assertEquals(delMemData.deleted, true);
    assertEquals(delMemData.accessCount, 1);

    // Verify deleted memory is gone
    const getDeletedRes = await handleHttpRequest(
      new Request(`http://localhost:8000/api/memories/${mem1.id}`, {
        method: "GET",
        headers: authHeaders,
      }),
    );
    assertEquals(getDeletedRes.status, 404);

    // 10. POST /api/roles - Create role
    const createRoleRes = await handleHttpRequest(
      new Request("http://localhost:8000/api/roles", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          name: "developer",
          description: "Fullstack TypeScript developer",
        }),
      }),
    );
    assertEquals(createRoleRes.status, 201);
    const createRoleData = await createRoleRes.json();
    assertEquals(createRoleData.role.name, "developer");
    assertEquals(createRoleData.role.description, "Fullstack TypeScript developer");

    // 11. POST /api/journals/:role - Write journal entry
    const writeJournalRes = await handleHttpRequest(
      new Request("http://localhost:8000/api/journals/developer", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          entry: "Implemented Memory & Role Journal REST API routes",
          writtenBy: "developer-agent-1",
        }),
      }),
    );
    assertEquals(writeJournalRes.status, 200);
    const writeJournalData = await writeJournalRes.json();
    assertEquals(writeJournalData.journal.roleId, "developer");
    assertEquals(writeJournalData.journal.entry, "Implemented Memory & Role Journal REST API routes");
    assertEquals(writeJournalData.journal.writtenBy, "developer-agent-1");

    // 12. GET /api/journals/:role - Read latest journal
    const readJournalRes = await handleHttpRequest(
      new Request("http://localhost:8000/api/journals/developer", {
        method: "GET",
        headers: authHeaders,
      }),
    );
    assertEquals(readJournalRes.status, 200);
    const readJournalData = await readJournalRes.json();
    assertEquals(readJournalData.journal.roleId, "developer");
    assertEquals(readJournalData.journal.entry, "Implemented Memory & Role Journal REST API routes");

    // 13. GET /api/roles - List roles enriched with latest journal
    const listRolesRes = await handleHttpRequest(
      new Request("http://localhost:8000/api/roles", {
        method: "GET",
        headers: authHeaders,
      }),
    );
    assertEquals(listRolesRes.status, 200);
    const listRolesData = await listRolesRes.json();
    assert(listRolesData.count >= 1);
    const devRole = listRolesData.roles.find((r: { name: string }) => r.name === "developer");
    assert(devRole);
    assertEquals(devRole.journal.entry, "Implemented Memory & Role Journal REST API routes");

    // 14. Multi-tenant isolation test: User B cannot see User A's memories, roles, or journals
    const userBToken = await createApiToken("user_other_tenant", "User B Token");
    const userBHeaders = {
      "Authorization": `Bearer ${userBToken.token}`,
      "Content-Type": "application/json",
    };

    const userBMemList = await handleHttpRequest(
      new Request("http://localhost:8000/api/memories", {
        method: "GET",
        headers: userBHeaders,
      }),
    );
    assertEquals(userBMemList.status, 200);
    assertEquals((await userBMemList.json()).count, 0);

    const userBRecall = await handleHttpRequest(
      new Request(`http://localhost:8000/api/memories/${mem2.id}`, {
        method: "GET",
        headers: userBHeaders,
      }),
    );
    assertEquals(userBRecall.status, 404);

    const userBRolesList = await handleHttpRequest(
      new Request("http://localhost:8000/api/roles", {
        method: "GET",
        headers: userBHeaders,
      }),
    );
    assertEquals(userBRolesList.status, 200);
    assertEquals((await userBRolesList.json()).count, 0);

    const userBJournal = await handleHttpRequest(
      new Request("http://localhost:8000/api/journals/developer", {
        method: "GET",
        headers: userBHeaders,
      }),
    );
    assertEquals(userBJournal.status, 200);
    assertEquals((await userBJournal.json()).journal, null);
  } finally {
    kv.close();
  }
});

Deno.test("HTTP Server - Web UI Routes: /tasks, /memories, /journals and Dashboard Navigation", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    // 1. GET /tasks UI
    const tasksRes = await handleHttpRequest(
      new Request("http://localhost:8000/tasks", { method: "GET" }),
    );
    assertEquals(tasksRes.status, 200);
    assertEquals(tasksRes.headers.get("content-type"), "text/html; charset=utf-8");
    const tasksHtml = await tasksRes.text();
    assert(tasksHtml.includes("Workflow MCP"));
    assert(tasksHtml.includes('id="tasksView"'));
    assert(tasksHtml.includes('id="memoriesView"'));
    assert(tasksHtml.includes('id="journalsView"'));
    assert(tasksHtml.includes('id="tab-btn-tasks"'));
    assert(tasksHtml.includes('class="nav-tab active" id="tab-btn-tasks"'));
    assert(tasksHtml.includes('switchMainTab'));

    // 2. GET /memories UI
    const memRes = await handleHttpRequest(
      new Request("http://localhost:8000/memories", { method: "GET" }),
    );
    assertEquals(memRes.status, 200);
    assertEquals(memRes.headers.get("content-type"), "text/html; charset=utf-8");
    const memHtml = await memRes.text();
    assert(memHtml.includes('class="nav-tab active" id="tab-btn-memories"'));
    assert(memHtml.includes('id="memoriesGrid"'));
    assert(memHtml.includes('id="memStatTotal"'));
    assert(memHtml.includes('id="memoryDetailModal"'));

    // 3. GET /journals UI
    const journalRes = await handleHttpRequest(
      new Request("http://localhost:8000/journals", { method: "GET" }),
    );
    assertEquals(journalRes.status, 200);
    assertEquals(journalRes.headers.get("content-type"), "text/html; charset=utf-8");
    const journalHtml = await journalRes.text();
    assert(journalHtml.includes('class="nav-tab active" id="tab-btn-journals"'));
    assert(journalHtml.includes('id="rolesGrid"'));
    assert(journalHtml.includes('id="editJournalModal"'));

    // 4. GET / Dashboard Navigation & Endpoints List
    const dashRes = await handleHttpRequest(
      new Request("http://localhost:8000/", { method: "GET" }),
    );
    assertEquals(dashRes.status, 200);
    const dashHtml = await dashRes.text();
    assert(dashHtml.includes('href="/tasks"'));
    assert(dashHtml.includes('href="/memories"'));
    assert(dashHtml.includes('href="/journals"'));
    assert(dashHtml.includes("Memory Vault & Explorer UI"));
    assert(dashHtml.includes("Role Journals Web UI"));
  } finally {
    kv.close();
  }
});


