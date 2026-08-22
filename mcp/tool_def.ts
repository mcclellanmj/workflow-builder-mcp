/**
 * Tool definition and response shaping primitives for MCP tools.
 */

import type { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpTool, ToolCallResponse, ToolContentItem } from "./registry.ts";
import {
  createErrorResponse,
  createMultiContentResponse,
  createSuccessResponse,
} from "./registry.ts";

export type OutputFormat = "markdown" | "json" | "both";

export interface DefineToolOptions<TSchema extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  description: string;
  schema?: TSchema;
  execute: (args: z.output<TSchema>) => Promise<ToolCallResponse>;
}

export function defineTool<TSchema extends z.ZodTypeAny = z.ZodTypeAny>(
  opts: DefineToolOptions<TSchema>,
): McpTool<z.input<TSchema>> {
  const executeHandler = async (rawArgs: unknown): Promise<ToolCallResponse> => {
    let parsedArgs: z.output<TSchema>;
    if (opts.schema) {
      const parsed = opts.schema.safeParse(rawArgs ?? {});
      if (!parsed.success) {
        const errorMsg = parsed.error.errors
          .map((e) => `${e.path.join(".") || "root"}: ${e.message}`)
          .join("; ");
        return createErrorResponse(`Invalid arguments: ${errorMsg}`);
      }
      parsedArgs = parsed.data;
    } else {
      parsedArgs = (rawArgs ?? {}) as z.output<TSchema>;
    }

    try {
      return await opts.execute(parsedArgs);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return createErrorResponse(`Error executing tool "${opts.name}": ${message}`);
    }
  };

  return {
    name: opts.name,
    description: opts.description,
    schema: opts.schema,
    execute: executeHandler,
    register: (server: McpServer): void => {
      server.registerTool(
        opts.name,
        {
          description: opts.description,
          ...(opts.schema ? { inputSchema: opts.schema } : {}),
        },
        async (args: unknown) => {
          console.error(
            `[WORKFLOW_MCP] Executing tool '${opts.name}' with args:`,
            JSON.stringify(args || {}),
          );
          const startTime = Date.now();
          try {
            const response = await executeHandler(args);
            const duration = Date.now() - startTime;
            console.error(`[WORKFLOW_MCP] Tool '${opts.name}' completed in ${duration}ms.`);
            return response;
          } catch (err) {
            const duration = Date.now() - startTime;
            console.error(`[WORKFLOW_MCP] Tool '${opts.name}' failed after ${duration}ms:`, err);
            throw err;
          }
        },
      );
    },
  };
}

export function jsonResponse(data: unknown): ToolCallResponse {
  return createSuccessResponse(JSON.stringify(data, null, 2));
}

export interface RichResponseOptions {
  data: unknown;
  markdown: string;
  mermaidDiagram?: string;
  format?: OutputFormat;
}

export function richResponse(opts: RichResponseOptions): ToolCallResponse {
  const format = opts.format ?? "both";
  if (format === "json") {
    return createSuccessResponse(JSON.stringify(opts.data, null, 2));
  }
  if (format === "markdown") {
    let text = opts.markdown;
    if (opts.mermaidDiagram) {
      text += `\n\n\`\`\`mermaid\n${opts.mermaidDiagram}\n\`\`\``;
    }
    return createSuccessResponse(text);
  }
  const items: ToolContentItem[] = [
    {
      type: "text",
      text: opts.markdown,
      annotations: { audience: ["user"], priority: 1.0 },
    },
  ];
  if (opts.mermaidDiagram) {
    items.push({
      type: "text",
      text: `\`\`\`mermaid\n${opts.mermaidDiagram}\n\`\`\``,
      annotations: { audience: ["user"], priority: 0.9 },
    });
  }
  items.push({
    type: "text",
    text: JSON.stringify(opts.data, null, 2),
    annotations: { audience: ["assistant"], priority: 0.8 },
  });
  return createMultiContentResponse(items);
}
