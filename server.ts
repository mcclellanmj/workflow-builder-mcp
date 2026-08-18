/**
 * Creates and configures the MCP server instance with all workflow tools registered.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { defaultRegistry, type McpTool, McpToolRegistry } from "./mcp/registry.ts";
import { allTools } from "./mcp/tools/index.ts";

// Register all tools with the default registry
try {
  for (const tool of allTools) {
    defaultRegistry.registerTool(tool);
  }
} catch {
  // Ignored if already registered (e.g. during tests)
}

/**
 * Creates an McpServer instance with workflow tools registered.
 */
export function createMcpServer(
  toolsOrRegistry: McpTool[] | McpToolRegistry = allTools,
): McpServer {
  const mcpServer = new McpServer({
    name: "workflow-mcp",
    version: "1.0.0",
  });

  const tools = toolsOrRegistry instanceof McpToolRegistry
    ? toolsOrRegistry.getTools()
    : toolsOrRegistry;

  for (const tool of tools) {
    tool.register(mcpServer);
  }

  return mcpServer;
}
