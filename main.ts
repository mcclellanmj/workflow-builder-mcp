/**
 * Workflow MCP — Main entrypoint.
 *
 * Supports dual-mode:
 * - When invoked in serverless / remote mode (e.g. Deno Deploy, --http flag, PORT env), starts the HTTP server.
 * - When invoked locally for IDE / desktop clients, starts the stdio transport.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { safeGetEnv } from "./env.ts";
import { handleHttpRequest } from "./http_server.ts";
import { createMcpServer } from "./server.ts";

const isHttpMode = Deno.args.includes("--http") ||
  Deno.args.includes("--serve") ||
  Boolean(safeGetEnv("DENO_DEPLOYMENT_ID"));

if (isHttpMode) {
  const port = Number(safeGetEnv("PORT") || 8000);
  console.error(`[WORKFLOW_MCP] Starting serverless HTTP MCP on port ${port}...`);
  Deno.serve({ port }, handleHttpRequest);
} else {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[WORKFLOW_MCP] Server started on stdio transport.");
}
