/**
 * Stateless JSON-RPC and Streamable SSE MCP protocol route handlers.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { withUserContext } from "../auth/context.ts";
import type { AuthResult } from "../auth/oauth.ts";
import { defaultRegistry } from "../mcp/registry.ts";
import { createMcpServer } from "../server.ts";
import { CORS_HEADERS, errorResponse, jsonResponse } from "./common.ts";

let _cachedTools: Array<Record<string, unknown>> | null = null;

export async function getCachedToolDefinitions(): Promise<Array<Record<string, unknown>>> {
  if (_cachedTools) return _cachedTools;

  const server = createMcpServer();
  const client = new Client({ name: "introspect", version: "1.0.0" }, { capabilities: {} });
  const [cT, sT] = InMemoryTransport.createLinkedPair();

  await Promise.all([server.connect(sT), client.connect(cT)]);
  const toolList = await client.listTools();
  _cachedTools = toolList.tools as Array<Record<string, unknown>>;

  await client.close();
  await server.close();

  return _cachedTools;
}

export function clearToolDefinitionCache(): void {
  _cachedTools = null;
}

interface SseSession {
  sessionId: string;
  userId: string;
  writer: WritableStreamDefaultWriter<Uint8Array>;
  createdAt: number;
}

const sseSessions = new Map<string, SseSession>();

async function sendSseEvent(
  writer: WritableStreamDefaultWriter<Uint8Array>,
  event: string,
  data: string,
): Promise<void> {
  const encoder = new TextEncoder();
  const payload = `event: ${event}\ndata: ${data}\n\n`;
  try {
    await writer.write(encoder.encode(payload));
  } catch (err) {
    console.error("[WORKFLOW_MCP] Error writing SSE event:", err);
  }
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
): Promise<
  { jsonrpc: "2.0"; id?: string | number | null; result?: unknown; error?: unknown } | null
> {
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
      const toolResult = await withUserContext(userId, async () => {
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
      return jsonResponse({
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32000,
          message:
            "Unauthorized: Missing or invalid authentication. Provide Authorization: Bearer <token> or X-User-Id header.",
        },
      }, 401);
    }

    try {
      const rawBody = await req.json();

      if (Array.isArray(rawBody)) {
        const results = await Promise.all(
          rawBody.map((item) => processJsonRpcMessage(item as JsonRpcRequest, auth.userId)),
        );
        const filtered = results.filter(Boolean);
        return jsonResponse(filtered);
      }

      const result = await processJsonRpcMessage(rawBody as JsonRpcRequest, auth.userId);
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

  // Streamable SSE MCP Endpoint
  if (path === "/sse" && method === "GET") {
    if (!auth) {
      return errorResponse("Unauthorized: Missing or invalid authentication.", 401);
    }

    const sessionId = crypto.randomUUID();
    const stream = new TransformStream<Uint8Array, Uint8Array>();
    const writer = stream.writable.getWriter();

    const session: SseSession = {
      sessionId,
      userId: auth.userId,
      writer,
      createdAt: Date.now(),
    };
    sseSessions.set(sessionId, session);

    const endpointUrl = `/message?sessionId=${sessionId}`;
    sendSseEvent(writer, "endpoint", endpointUrl).catch((err) => {
      console.error("[WORKFLOW_MCP] Initial SSE event failed:", err);
    });

    req.signal.addEventListener("abort", () => {
      sseSessions.delete(sessionId);
      writer.close().catch((err) => {
        console.error("[WORKFLOW_MCP] Closing aborted SSE writer failed:", err);
      });
    });

    return new Response(stream.readable, {
      status: 200,
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        "connection": "keep-alive",
        ...CORS_HEADERS,
      },
    });
  }

  if (path === "/message" && method === "POST") {
    const sessionId = url.searchParams.get("sessionId");
    if (!sessionId || !sseSessions.has(sessionId)) {
      return errorResponse("Invalid or expired sessionId.", 400);
    }

    const session = sseSessions.get(sessionId)!;
    try {
      const rawBody = await req.json();
      const response = await processJsonRpcMessage(rawBody as JsonRpcRequest, session.userId);

      if (response) {
        await sendSseEvent(session.writer, "message", JSON.stringify(response));
      }
      return new Response(null, { status: 202, headers: CORS_HEADERS });
    } catch (err) {
      return errorResponse(
        `Error processing message: ${err instanceof Error ? err.message : String(err)}`,
        400,
      );
    }
  }

  return null;
}
