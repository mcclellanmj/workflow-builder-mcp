/**
 * Workflow MCP — Main entrypoint.
 *
 * Starts the MCP server using stdio transport for agent/IDE consumption.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./server.ts";

const server = createMcpServer();
const transport = new StdioServerTransport();

await server.connect(transport);
console.error("[WORKFLOW_MCP] Server started on stdio transport.");
