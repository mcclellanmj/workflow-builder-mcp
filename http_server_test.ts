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
