/**
 * Serverless HTTP & MCP Server Entrypoint with Passkey / WebAuthn & Bearer Token Authentication.
 *
 * Exposes:
 * - Passkey / WebAuthn Biometric Auth (/auth/passkey/*)
 * - Stateless HTTP JSON-RPC MCP at POST /mcp and POST /
 * - API Token management (/api/token, /api/tokens, /api/tokens/:id)
 * - User and Health Discovery (/api/me, /health, /)
 *
 * Deployable with 0 config to Deno Deploy, Cloudflare Workers, or standard Deno runtimes.
 */

import { authenticateRequest, type AuthResult } from "./auth/oauth.ts";
import { safeGetEnv } from "./env.ts";
import { defaultRegistry } from "./mcp/registry.ts";
import { allTools } from "./mcp/tools/index.ts";
import { handleAuthRoutes } from "./routes/auth_routes.ts";
import { CORS_HEADERS, errorResponse, jsonResponse } from "./routes/common.ts";
import {
  getCachedToolDefinitions,
  handleMcpRoutes,
  processJsonRpcMessage,
} from "./routes/mcp_routes.ts";
import { handleMemoryRoutes } from "./routes/memory_routes.ts";
import { handleOAuthServerRoutes } from "./routes/oauth_server_routes.ts";
import { handlePasskeyManagementRoutes } from "./routes/passkey_routes.ts";
import { handleStaticRoutes } from "./routes/static_routes.ts";
import { handleTaskRoutes } from "./routes/task_routes.ts";
import { handleTokenRoutes } from "./routes/token_routes.ts";
import { handleVisualizeRoutes } from "./routes/visualize_routes.ts";

export { getCachedToolDefinitions, processJsonRpcMessage };

// Explicit idempotent registration of all tools
for (const tool of allTools) {
  try {
    defaultRegistry.registerTool(tool);
  } catch (err) {
    // Only log if not already registered error
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("already registered")) {
      console.error(`[WORKFLOW_MCP] Error registering tool "${tool.name}":`, err);
    }
  }
}

/**
 * Main HTTP request router dispatching to dedicated sub-routers.
 */
export async function handleHttpRequest(req: Request): Promise<Response> {
  const start = performance.now();
  const url = new URL(req.url);
  const method = req.method.toUpperCase();
  const clientIp = req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip") ||
    "local";
  const userAgent = req.headers.get("user-agent") || "-";

  let res: Response | null = null;

  // 1. CORS Preflight
  if (method === "OPTIONS") {
    res = new Response(null, {
      status: 204,
      headers: CORS_HEADERS,
    });
  }

  // 2. Fast Health Check (0 KV / 0 Auth overhead)
  if (!res && url.pathname === "/health" && method === "GET") {
    res = jsonResponse({
      status: "ok",
      server: "workflow-mcp",
      version: "1.0.0",
      uptime: performance.now(),
      timestamp: new Date().toISOString(),
      passkeysEnabled: true,
      oauthConfigured: false,
    });
  }

  // 3. Auth Routes (Passkey WebAuthn & OAuth Provider Signin)
  if (!res) {
    res = await handleAuthRoutes(req, url);
  }

  // 4. Resolve Authentication (Bearer Token, Session Cookie, or Header Auth)
  let auth: AuthResult | null = null;
  if (!res) {
    auth = await authenticateRequest(req);
  }

  // 5. OAuth 2.1 Server Routes (RFC 9728 Discovery, RFC 8414 Metadata, Authorize, Token, Register)
  if (!res) {
    res = await handleOAuthServerRoutes(req, url, auth);
  }

  // 6. Passkey Management Routes (/api/passkeys/*)
  if (!res) {
    res = await handlePasskeyManagementRoutes(req, url, auth);
  }

  // 7. Token Routes (/api/token, /api/tokens/*)
  if (!res) {
    res = await handleTokenRoutes(req, url, auth);
  }

  // 8. MCP Routes (Stateless JSON-RPC)
  if (!res) {
    res = await handleMcpRoutes(req, url, auth);
  }

  // 9. Visualization & Share Ticket Routes (/visualize/*, /api/visualize/*)
  if (!res) {
    res = await handleVisualizeRoutes(req, url, auth);
  }

  // 10. Task Management, Kanban Web UI & REST API Routes (/tasks, /api/tasks/*)
  if (!res) {
    res = await handleTaskRoutes(req, url, auth);
  }

  // 11. Memory & Role Journal REST API Routes (/api/memories/*, /api/roles, /api/journals/*)
  if (!res) {
    res = await handleMemoryRoutes(req, url, auth);
  }

  // 12. Static / Discovery / Health / Profile Routes
  if (!res) {
    res = await handleStaticRoutes(req, url, auth);
  }

  if (!res) {
    res = errorResponse(`Not Found: ${method} ${url.pathname}`, 404);
  }

  const duration = Math.round((performance.now() - start) * 100) / 100;
  const userTag = auth?.userId ? `user=${auth.userId}` : "anon";
  console.log(
    `[HTTP] ${method} ${url.pathname}${url.search} -> ${res.status} (${duration}ms, ${userTag}, ip=${clientIp}, ua="${
      userAgent.slice(0, 40)
    }")`,
  );

  return res;
}

// Direct Execution Entrypoint
if (import.meta.main) {
  const port = Number(safeGetEnv("PORT") || 8000);
  console.log(`[WORKFLOW_MCP] Starting HTTP serverless instance on port ${port}...`);
  Deno.serve({ port }, handleHttpRequest);
}
