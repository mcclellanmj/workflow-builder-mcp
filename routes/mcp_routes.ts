/**
 * Stateless JSON-RPC MCP protocol route handlers.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { type RequestContext, withRequestContext } from "../auth/context.ts";
import type { AuthResult } from "../auth/oauth.ts";
import { defaultRegistry } from "../mcp/registry.ts";
import { createMcpServer } from "../server.ts";
import { CORS_HEADERS, jsonResponse } from "./common.ts";

let _cachedTools: Array<Record<string, unknown>> | null = null;
let _cachedToolsPromise: Promise<Array<Record<string, unknown>>> | null = null;

export function getCachedToolDefinitions(): Promise<Array<Record<string, unknown>>> {
  if (_cachedTools) return Promise.resolve(_cachedTools);
  if (!_cachedToolsPromise) {
    _cachedToolsPromise = (async () => {
      const server = createMcpServer();
      const client = new Client({ name: "introspect", version: "1.0.0" }, { capabilities: {} });
      const [cT, sT] = InMemoryTransport.createLinkedPair();

      await Promise.all([server.connect(sT), client.connect(cT)]);
      const toolList = await client.listTools();
      _cachedTools = toolList.tools as Array<Record<string, unknown>>;

      await client.close();
      await server.close();

      return _cachedTools;
    })();
  }
  return _cachedToolsPromise;
}

export function clearToolDefinitionCache(): void {
  _cachedTools = null;
  _cachedToolsPromise = null;
}

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export async function processJsonRpcMessage(
  msg: JsonRpcRequest,
  userId: string,
  requestContext?: Partial<RequestContext>,
): Promise<
  { jsonrpc: "2.0"; id?: string | number | null; result?: unknown; error?: unknown } | null
> {
  if (!msg || typeof msg !== "object" || typeof msg.method !== "string") {
    return {
      jsonrpc: "2.0",
      id: (msg && typeof msg === "object" && "id" in msg)
        ? (msg.id as string | number | null)
        : null,
      error: { code: -32600, message: "Invalid Request: 'method' string is required." },
    };
  }

  const isNotification = msg.id === undefined || msg.id === null;

  if (msg.method.startsWith("notifications/")) {
    return null;
  }

  if (msg.method === "initialize") {
    return {
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: {
          tools: {
            listChanged: true,
          },
        },
        serverInfo: {
          name: "workflow-mcp",
          version: "1.0.0",
        },
      },
    };
  }

  if (msg.method === "ping") {
    return {
      jsonrpc: "2.0",
      id: msg.id,
      result: {},
    };
  }

  if (msg.method === "tools/list") {
    const tools = await getCachedToolDefinitions();
    return {
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        tools,
      },
    };
  }

  if (msg.method === "tools/call") {
    const toolName = msg.params?.name as string;
    const toolArgs = (msg.params?.arguments as Record<string, unknown>) ?? {};

    if (!toolName) {
      return {
        jsonrpc: "2.0",
        id: msg.id,
        error: { code: -32602, message: "Missing tool 'name' in parameters." },
      };
    }

    try {
      const toolResult = await withRequestContext({
        userId,
        serverOrigin: requestContext?.serverOrigin,
        token: requestContext?.token,
      }, async () => {
        return await defaultRegistry.executeTool(toolName, toolArgs);
      });

      return {
        jsonrpc: "2.0",
        id: msg.id,
        result: toolResult,
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return {
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          content: [{ type: "text", text: `Tool error: ${errMsg}` }],
          isError: true,
        },
      };
    }
  }

  if (isNotification) {
    return null;
  }

  return {
    jsonrpc: "2.0",
    id: msg.id,
    error: { code: -32601, message: `Method not found: ${msg.method}` },
  };
}

export async function handleMcpRoutes(
  req: Request,
  url: URL,
  auth: AuthResult | null,
): Promise<Response | null> {
  const path = url.pathname;
  const method = req.method.toUpperCase();

  // Stateless HTTP JSON-RPC MCP Endpoint
  if ((path === "/mcp" || path === "/api/mcp" || path === "/") && method === "POST") {
    if (!auth) {
      return jsonResponse(
        {
          jsonrpc: "2.0",
          id: null,
          error: {
            code: -32000,
            message:
              "Unauthorized: Missing or invalid authentication. Provide Authorization: Bearer <token> or connect via standard OAuth 2.1 flow.",
          },
        },
        401,
        {
          "WWW-Authenticate":
            `Bearer realm="workflow-mcp", resource_metadata="${url.origin}/.well-known/oauth-protected-resource"`,
        },
      );
    }

    try {
      const rawBody = await req.json();
      const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
        url.searchParams.get("token") || undefined;
      const reqContext: Partial<RequestContext> = {
        serverOrigin: url.origin,
        token,
      };

      if (Array.isArray(rawBody)) {
        const results = await Promise.all(
          rawBody.map((item) =>
            processJsonRpcMessage(item as JsonRpcRequest, auth.userId, reqContext)
          ),
        );
        const filtered = results.filter(Boolean);
        return jsonResponse(filtered);
      }

      const result = await processJsonRpcMessage(
        rawBody as JsonRpcRequest,
        auth.userId,
        reqContext,
      );
      if (!result) {
        return new Response(null, { status: 204, headers: CORS_HEADERS });
      }
      return jsonResponse(result);
    } catch (err) {
      return jsonResponse({
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32700,
          message: `Parse error: ${err instanceof Error ? err.message : String(err)}`,
        },
      }, 400);
    }
  }

  return null;
}
