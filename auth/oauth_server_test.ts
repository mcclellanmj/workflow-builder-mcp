import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import { getOAuthClient, registerOAuthClient, verifyCodeChallenge } from "./oauth_server.ts";
import { handleHttpRequest } from "../http_server.ts";
import {
  apiTokenCache,
  authenticateRequest,
  createApiToken,
  createSession,
  deleteApiToken,
  revokeApiToken,
  sessionCache,
  signOut,
  validateApiToken,
} from "./oauth.ts";

Deno.test("OAuth Server - PKCE Challenge Verification (S256 Mandatory)", async () => {
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  // SHA-256 base64url of verifier:
  const encoder = new TextEncoder();
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(verifier));
  let binary = "";
  const bytes = new Uint8Array(hash);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const challenge = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  // S256 matching
  const valid = await verifyCodeChallenge(verifier, challenge, "S256");
  assertEquals(valid, true);

  // S256 wrong verifier
  const invalid = await verifyCodeChallenge("wrong_verifier_string", challenge, "S256");
  assertEquals(invalid, false);

  // Plain method must be rejected under OAuth 2.1
  const plainRejected = await verifyCodeChallenge("my_secret_code", "my_secret_code", "plain");
  assertEquals(plainRejected, false);
});

Deno.test("OAuth Server - RFC 7591 Dynamic Client Registration", async () => {
  const client = await registerOAuthClient({
    client_name: "Test Claude Desktop Client",
    redirect_uris: ["http://127.0.0.1:52345/callback"],
    grant_types: ["authorization_code", "refresh_token"],
  });

  assertExists(client.clientId);
  assertStringIncludes(client.clientId, "client_");
  assertEquals(client.clientName, "Test Claude Desktop Client");
  assertEquals(client.redirectUris, ["http://127.0.0.1:52345/callback"]);

  const fetched = await getOAuthClient(client.clientId);
  assertExists(fetched);
  assertEquals(fetched?.clientId, client.clientId);
});

Deno.test("OAuth Server - HTTP Discovery Endpoints (RFC 9728 & RFC 8414)", async () => {
  // 1. RFC 9728: Protected Resource Metadata
  const prmReq = new Request("http://localhost:8000/.well-known/oauth-protected-resource");
  const prmRes = await handleHttpRequest(prmReq);
  assertEquals(prmRes.status, 200);
  const prmData = await prmRes.json();
  assertEquals(prmData.resource, "http://localhost:8000");
  assertEquals(prmData.authorization_servers, ["http://localhost:8000"]);
  assertEquals(prmData.scopes_supported, ["workflow", "read", "write"]);
  assertEquals(prmData.bearer_methods_supported, ["header"]);

  // 2. RFC 8414: OAuth Authorization Server Metadata
  const asReq = new Request("http://localhost:8000/.well-known/oauth-authorization-server");
  const asRes = await handleHttpRequest(asReq);
  assertEquals(asRes.status, 200);
  const asData = await asRes.json();
  assertEquals(asData.issuer, "http://localhost:8000");
  assertEquals(asData.authorization_endpoint, "http://localhost:8000/oauth/authorize");
  assertEquals(asData.token_endpoint, "http://localhost:8000/oauth/token");
  assertEquals(asData.registration_endpoint, "http://localhost:8000/oauth/register");
  assertEquals(asData.revocation_endpoint, "http://localhost:8000/oauth/revoke");
  assertEquals(asData.response_types_supported, ["code"]);
  assertEquals(asData.grant_types_supported, ["authorization_code", "refresh_token"]);
  assertEquals(asData.code_challenge_methods_supported, ["S256"]);

  // 3. OpenID Configuration alias
  const oidcReq = new Request("http://localhost:8000/.well-known/openid-configuration");
  const oidcRes = await handleHttpRequest(oidcReq);
  assertEquals(oidcRes.status, 200);
  const oidcData = await oidcRes.json();
  assertEquals(oidcData.issuer, "http://localhost:8000");
});

Deno.test("OAuth Server - Dynamic Client Registration HTTP Endpoint", async () => {
  const regReq = new Request("http://localhost:8000/oauth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "Cursor AI MCP Client",
      redirect_uris: ["http://localhost:4567/oauth/callback"],
    }),
  });

  const regRes = await handleHttpRequest(regReq);
  assertEquals(regRes.status, 201);
  const regData = await regRes.json();
  assertExists(regData.client_id);
  assertEquals(regData.client_name, "Cursor AI MCP Client");
  assertEquals(regData.redirect_uris, ["http://localhost:4567/oauth/callback"]);
});

Deno.test("OAuth Server - Full Authorization Code Flow with PKCE & XSS Escaping", async () => {
  const userId = "user_oauth_test_" + crypto.randomUUID().slice(0, 6);
  const { sessionId } = await createSession(
    userId,
    "OAuth Tester <script>alert(1)</script>",
    undefined,
    "passkey",
  );
  const cookieVal = `site-session=${sessionId}`;

  // Client creates PKCE code verifier and challenge
  const codeVerifier = "n0-Z-g_7~Xk24.8!FvQ6~9pL_42mZ1A8bK3jF9eR";
  const encoder = new TextEncoder();
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(codeVerifier));
  let binary = "";
  const bytes = new Uint8Array(hash);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const codeChallenge = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const redirectUri = "http://localhost:52345/callback";
  const state = "xyz_state_123";

  // 1. GET /oauth/authorize without code_challenge fails under OAuth 2.1
  const noPkceReq = new Request(
    `http://localhost:8000/oauth/authorize?response_type=code&client_id=claude-desktop&redirect_uri=${
      encodeURIComponent(redirectUri)
    }&state=${state}`,
    {
      headers: { Cookie: cookieVal },
    },
  );
  const noPkceRes = await handleHttpRequest(noPkceReq);
  assertEquals(noPkceRes.status, 400);

  // 2. GET /oauth/authorize with invalid javascript: URI is rejected
  const badUriReq = new Request(
    `http://localhost:8000/oauth/authorize?response_type=code&client_id=claude-desktop&redirect_uri=javascript:alert(1)&state=${state}&code_challenge=${codeChallenge}`,
    {
      headers: { Cookie: cookieVal },
    },
  );
  const badUriRes = await handleHttpRequest(badUriReq);
  assertEquals(badUriRes.status, 400);

  // 3. GET /oauth/authorize (Authenticated) with XSS escaping
  const authGetReq = new Request(
    `http://localhost:8000/oauth/authorize?response_type=code&client_id=claude-desktop&redirect_uri=${
      encodeURIComponent(redirectUri)
    }&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`,
    {
      headers: { Cookie: cookieVal },
    },
  );
  const authGetRes = await handleHttpRequest(authGetReq);
  assertEquals(authGetRes.status, 200);
  const authHtml = await authGetRes.text();
  assertStringIncludes(authHtml, "Authorize Claude Desktop");
  // Check XSS escaping for user name
  assertStringIncludes(authHtml, "&lt;script&gt;alert(1)&lt;/script&gt;");

  // 4. POST /oauth/authorize (User approves)
  const approveReq = new Request("http://localhost:8000/oauth/authorize", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "accept": "application/json",
      Cookie: cookieVal,
    },
    body: JSON.stringify({
      approve: true,
      client_id: "claude-desktop",
      redirect_uri: redirectUri,
      scope: "workflow",
      state: state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    }),
  });

  const approveRes = await handleHttpRequest(approveReq);
  assertEquals(approveRes.status, 200);
  const approveData = await approveRes.json();
  assertExists(approveData.code);
  assertExists(approveData.redirect);
  assertStringIncludes(approveData.redirect, redirectUri);
  assertStringIncludes(approveData.redirect, `code=${approveData.code}`);
  assertStringIncludes(approveData.redirect, `state=${state}`);

  const authCode = approveData.code;

  // 5. POST /oauth/token - Fails with invalid PKCE verifier
  const badTokenReq = new Request("http://localhost:8000/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: authCode,
      client_id: "claude-desktop",
      redirect_uri: redirectUri,
      code_verifier: "wrong_verifier",
    }).toString(),
  });
  const badTokenRes = await handleHttpRequest(badTokenReq);
  assertEquals(badTokenRes.status, 400);
  const badTokenData = await badTokenRes.json();
  assertEquals(badTokenData.error, "invalid_grant");

  // 6. POST /oauth/token - Succeeds with correct PKCE verifier
  const tokenReq = new Request("http://localhost:8000/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: authCode,
      client_id: "claude-desktop",
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }).toString(),
  });

  const tokenRes = await handleHttpRequest(tokenReq);
  assertEquals(tokenRes.status, 200);
  const tokenData = await tokenRes.json();
  assertExists(tokenData.access_token);
  assertStringIncludes(tokenData.access_token, "wf_");
  assertEquals(tokenData.token_type, "Bearer");
  assertExists(tokenData.refresh_token);
  assertStringIncludes(tokenData.refresh_token, "re_");

  const accessToken = tokenData.access_token;
  const refreshToken = tokenData.refresh_token;

  // 7. Code Replay Protection - Cannot exchange the same code again
  const replayReq = new Request("http://localhost:8000/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code: authCode,
      client_id: "claude-desktop",
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }),
  });
  const replayRes = await handleHttpRequest(replayReq);
  assertEquals(replayRes.status, 400);

  // 8. Execute MCP tool using the OAuth Access Token
  const mcpReq = new Request("http://localhost:8000/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "workflow_create",
        arguments: {
          name: "OAuth Created Workflow",
          description: "Created via OAuth 2.1 Access Token",
        },
      },
    }),
  });

  const mcpRes = await handleHttpRequest(mcpReq);
  assertEquals(mcpRes.status, 200);
  const mcpData = await mcpRes.json();
  assertEquals(mcpData.jsonrpc, "2.0");
  assertEquals(mcpData.id, 1);
  assertExists(mcpData.result);

  // 9. Refresh Token Grant
  const refreshReq = new Request("http://localhost:8000/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: "claude-desktop",
    }),
  });

  const refreshRes = await handleHttpRequest(refreshReq);
  assertEquals(refreshRes.status, 200);
  const refreshData = await refreshRes.json();
  assertExists(refreshData.access_token);
  assertExists(refreshData.refresh_token);
  assertEquals(refreshData.token_type, "Bearer");

  // 10. Token Revocation
  const revokeReq = new Request("http://localhost:8000/oauth/revoke", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: refreshData.access_token }),
  });
  const revokeRes = await handleHttpRequest(revokeReq);
  assertEquals(revokeRes.status, 200);
});

Deno.test("OAuth Server - Unauthenticated MCP Request Returns WWW-Authenticate Challenge", async () => {
  // 1. POST /mcp without Auth
  const unauthReq = new Request("http://localhost:8000/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    }),
  });

  const unauthRes = await handleHttpRequest(unauthReq);
  assertEquals(unauthRes.status, 401);
  const wwwAuth = unauthRes.headers.get("www-authenticate");
  assertExists(wwwAuth);
  assertStringIncludes(wwwAuth, 'Bearer realm="workflow-mcp"');
  assertStringIncludes(
    wwwAuth,
    'resource_metadata="http://localhost:8000/.well-known/oauth-protected-resource"',
  );
});

Deno.test("OAuth & Auth Cache - API Token caching, validation, and invalidation", async () => {
  apiTokenCache.clear();
  const userId = "test_user_cache_" + crypto.randomUUID().slice(0, 8);

  // 1. Create API token -> should be populated in apiTokenCache
  const tokenInfo = await createApiToken(userId, "Cache Test Token");
  assertExists(tokenInfo.token);
  assertEquals(apiTokenCache.get(tokenInfo.token)?.id, tokenInfo.id);

  // 2. Validate token (cache hit)
  const validatedCached = await validateApiToken(tokenInfo.token);
  assertExists(validatedCached);
  assertEquals(validatedCached.userId, userId);

  // 3. Clear cache and validate (cache miss -> KV lookup -> re-caches)
  apiTokenCache.clear();
  assertEquals(apiTokenCache.get(tokenInfo.token), undefined);

  const validatedFromKv = await validateApiToken(tokenInfo.token);
  assertExists(validatedFromKv);
  assertEquals(validatedFromKv.userId, userId);
  assertEquals(apiTokenCache.get(tokenInfo.token)?.id, tokenInfo.id);

  // 4. Revoke token via revokeApiToken / deleteApiToken -> invalidates cache
  const revoked = await revokeApiToken(userId, tokenInfo.id);
  assertEquals(revoked, true);
  assertEquals(apiTokenCache.get(tokenInfo.token), undefined);

  const validatedAfterRevoke = await validateApiToken(tokenInfo.token);
  assertEquals(validatedAfterRevoke, null);
});

Deno.test("OAuth & Auth Cache - User Session caching, authentication, and signout", async () => {
  sessionCache.clear();
  const userId = "test_user_sess_" + crypto.randomUUID().slice(0, 8);

  // 1. Create session -> populated in sessionCache
  const { sessionId, cookieHeader } = await createSession(userId, "Session Tester");
  assertExists(sessionId);
  assertExists(cookieHeader);
  assertEquals(sessionCache.get(sessionId)?.userId, userId);

  // 2. Authenticate request via session cookie (cache hit)
  const req1 = new Request("http://localhost:8000/api/profile", {
    headers: {
      cookie: `site-session=${sessionId}`,
    },
  });
  const authRes1 = await authenticateRequest(req1);
  assertExists(authRes1);
  assertEquals(authRes1.userId, userId);
  assertEquals(authRes1.authMethod, "session");

  // 3. Clear session cache -> Authenticate request (cache miss -> KV lookup -> re-caches)
  sessionCache.clear();
  assertEquals(sessionCache.get(sessionId), undefined);

  const authRes2 = await authenticateRequest(req1);
  assertExists(authRes2);
  assertEquals(authRes2.userId, userId);
  assertEquals(sessionCache.get(sessionId)?.userId, userId);

  // 4. Sign out -> deletes from sessionCache and KV
  const signoutReq = new Request("http://localhost:8000/oauth/signout", {
    headers: {
      cookie: `site-session=${sessionId}`,
    },
  });
  await signOut(signoutReq);
  assertEquals(sessionCache.get(sessionId), undefined);

  // Subsequent request should fail
  const authRes3 = await authenticateRequest(req1);
  assertEquals(authRes3, null);
});

Deno.test("OAuth & Auth Cache - Bearer Request authentication with cached API token", async () => {
  apiTokenCache.clear();
  const userId = "test_user_bearer_" + crypto.randomUUID().slice(0, 8);
  const tokenInfo = await createApiToken(userId, "Bearer Test Token");

  const req = new Request("http://localhost:8000/mcp", {
    headers: {
      Authorization: `Bearer ${tokenInfo.token}`,
    },
  });

  const authRes = await authenticateRequest(req);
  assertExists(authRes);
  assertEquals(authRes.userId, userId);
  assertEquals(authRes.authMethod, "bearer");
  assertEquals(apiTokenCache.get(tokenInfo.token)?.id, tokenInfo.id);

  // Invalidate via deleteApiToken alias
  await deleteApiToken(userId, tokenInfo.id);
  assertEquals(apiTokenCache.get(tokenInfo.token), undefined);

  const authResAfterRevoke = await authenticateRequest(req);
  assertEquals(authResAfterRevoke, null);
});
