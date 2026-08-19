/**
 * Serverless HTTP & MCP Server Entrypoint with Passkey / WebAuthn & Bearer Token Authentication.
 *
 * Exposes:
 * - Passkey / WebAuthn Biometric Auth (/auth/passkey/*)
 * - Stateless HTTP JSON-RPC MCP at POST /mcp and POST /
 * - Streamable SSE MCP at GET /sse and POST /message
 * - API Token management (/api/token, /api/tokens, /api/tokens/:id)
 * - User and Health Discovery (/api/me, /health, /)
 *
 * Deployable with 0 config to Deno Deploy, Cloudflare Workers, or standard Deno runtimes.
 */

import { authenticateRequest } from "./auth/oauth.ts";
import { defaultRegistry } from "./mcp/registry.ts";
import { allTools } from "./mcp/tools/index.ts";
import { handleAuthRoutes } from "./routes/auth_routes.ts";
import { CORS_HEADERS, errorResponse } from "./routes/common.ts";
import {
  getCachedToolDefinitions,
  handleMcpRoutes,
  processJsonRpcMessage,
} from "./routes/mcp_routes.ts";
import { handleStaticRoutes } from "./routes/static_routes.ts";
import { handleTokenRoutes } from "./routes/token_routes.ts";

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
  const url = new URL(req.url);
  const method = req.method.toUpperCase();

  // 1. CORS Preflight
  if (method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: CORS_HEADERS,
    });
  }

  // 2. Auth Routes (Passkey WebAuthn & OAuth)
  const authRes = await handleAuthRoutes(req, url);
  if (authRes) return authRes;

  // 3. Resolve Authentication (Bearer Token, Session Cookie, or Header Auth)
  const auth = await authenticateRequest(req);

  // 4. Token Routes
  if (auth) {
    const tokenRes = await handleTokenRoutes(req, url, auth);
    if (tokenRes) return tokenRes;
  }

  // 5. MCP Routes (Stateless JSON-RPC and Streamable SSE)
  const mcpRes = await handleMcpRoutes(req, url, auth);
  if (mcpRes) return mcpRes;

  // 6. Static / Discovery / Health / Profile Routes
  const staticRes = await handleStaticRoutes(req, url, auth);
  if (staticRes) return staticRes;

  return errorResponse(`Not Found: ${method} ${url.pathname}`, 404);
}

// Direct Execution Entrypoint
if (import.meta.main) {
  const port = Number(Deno.env.get("PORT") || 8000);
  console.log(`[WORKFLOW_MCP] Starting HTTP serverless instance on port ${port}...`);
  Deno.serve({ port }, handleHttpRequest);
}
