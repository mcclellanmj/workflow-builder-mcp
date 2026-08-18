import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { z } from "zod";

export interface ToolContentItem {
  type: "text";
  text: string;
  annotations?: {
    audience?: ("user" | "assistant")[];
    priority?: number;
  };
}

export interface ToolCallResponse {
  content: ToolContentItem[];
  isError?: boolean;
}

export function createSuccessResponse(
  text: string,
  annotations?: { audience?: ("user" | "assistant")[]; priority?: number },
): ToolCallResponse {
  return {
    content: [{ type: "text", text, ...(annotations ? { annotations } : {}) }],
  };
}

export function createMultiContentResponse(
  items: ToolContentItem[],
  isError = false,
): ToolCallResponse {
  return {
    content: items,
    ...(isError ? { isError: true } : {}),
  };
}

export function createErrorResponse(text: string): ToolCallResponse {
  return {
    content: [{ type: "text", text }],
    isError: true,
  };
}

// deno-lint-ignore no-explicit-any
export interface McpTool<TArgs = any> {
  name: string;
  description: string;
  schema?: z.ZodTypeAny;
  execute: (args: TArgs) => Promise<ToolCallResponse>;
  register: (server: McpServer) => void;
}

/**
 * Registry for managing and dispatching Model Context Protocol (MCP) tools.
 */
export class McpToolRegistry {
  // deno-lint-ignore no-explicit-any
  private tools = new Map<string, McpTool<any>>();

  /** Registers a new MCP tool definition and handler. */
  registerTool<TArgs>(tool: McpTool<TArgs>): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered.`);
    }
    this.tools.set(tool.name, tool);
  }

  /** Returns a list of all registered tools. */
  // deno-lint-ignore no-explicit-any
  getTools(): McpTool<any>[] {
    return Array.from(this.tools.values());
  }

  /** Retrieves a registered tool by name. */
  // deno-lint-ignore no-explicit-any
  getTool(name: string): McpTool<any> | undefined {
    return this.tools.get(name);
  }

  /** Executes a registered tool by name with arguments. */
  async executeTool(name: string, args: unknown): Promise<ToolCallResponse> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Unknown tool: ${name}`);
    }
    return await tool.execute(args);
  }

  /** Registers all tools onto the specified McpServer instance. */
  registerAll(server: McpServer): void {
    for (const tool of this.tools.values()) {
      tool.register(server);
    }
  }
}

/** Default global tool registry instance. */
export const defaultRegistry: McpToolRegistry = new McpToolRegistry();
