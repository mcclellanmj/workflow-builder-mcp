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
    // 1. Unauthenticated /api/me should be 401
    const unauthReq = new Request("http://localhost:8000/api/me", { method: "GET" });
    const unauthRes = await handleHttpRequest(unauthReq);
    assertEquals(unauthRes.status, 401);

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
