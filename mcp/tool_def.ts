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

/**
 * Computes the Levenshtein edit distance between two strings (case-insensitive).
 */
export function levenshteinDistance(a: string, b: string): number {
  const al = a.length;
  const bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;

  const matrix: number[][] = [];
  for (let i = 0; i <= al; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= bl; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= al; i++) {
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1].toLowerCase() === b[j - 1].toLowerCase() ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1, // deletion
        matrix[i][j - 1] + 1, // insertion
        matrix[i - 1][j - 1] + cost, // substitution
      );
    }
  }

  return matrix[al][bl];
}

/**
 * Extracts all valid parameter keys accepted by a Zod schema, including nested shapes
 * inside effects, pipelines, intersections, unions, and optional/default wrappers.
 */
export function extractSchemaKeys(schema?: z.ZodTypeAny): string[] {
  if (!schema) return [];
  const keys = new Set<string>();
  const visited = new Set<unknown>();

  function traverse(s: unknown): void {
    if (!s || typeof s !== "object" || visited.has(s)) return;
    visited.add(s);
    // deno-lint-ignore no-explicit-any
    const def = (s as any)._def;
    // deno-lint-ignore no-explicit-any
    const shape = (s as any).shape;

    if (shape && typeof shape === "object") {
      for (const k of Object.keys(shape)) {
        keys.add(k);
      }
    }

    if (!def) return;

    if (def.schema) traverse(def.schema);
    if (def.innerType) traverse(def.innerType);
    if (def.in) traverse(def.in);
    if (typeof def.getter === "function") {
      try {
        traverse(def.getter());
      } catch {
        // ignore
      }
    }
    if (def.left) traverse(def.left);
    if (def.right) traverse(def.right);
    if (Array.isArray(def.options)) {
      for (const opt of def.options) {
        traverse(opt);
      }
    }
  }

  traverse(schema);
  return Array.from(keys);
}

/**
 * Suggests valid parameter names for an unknown or misspelled property based on:
 * 1. Contextual scope aliases (e.g. 'scopeId' -> 'roleId' when scope='role')
 * 2. Snake_case <-> camelCase naming conversions (e.g. 'task_id' -> 'taskId')
 * 3. Domain alias mappings (e.g. 'id' -> 'taskId', 'desc' -> 'description')
 * 4. Fuzzy Levenshtein distance matching (distance <= 2)
 */
export function suggestPropertyNames(
  unknownKey: string,
  validKeys: string[],
  context?: { scope?: string },
): string[] {
  const suggestions = new Set<string>();
  const normalizedKey = unknownKey.trim();

  // 1. Contextual scope alias matching
  if (context?.scope) {
    const scope = context.scope.toLowerCase();
    if (
      normalizedKey === "scopeId" ||
      normalizedKey === "scope_id" ||
      normalizedKey === "targetId" ||
      normalizedKey === "target_id"
    ) {
      if (scope === "role") {
        if (validKeys.includes("roleId")) suggestions.add("roleId");
        if (validKeys.includes("role")) suggestions.add("role");
      } else if (scope === "workflow") {
        if (validKeys.includes("workflowId")) suggestions.add("workflowId");
        if (validKeys.includes("workflow")) suggestions.add("workflow");
      } else if (scope === "node") {
        if (validKeys.includes("nodeId")) suggestions.add("nodeId");
        if (validKeys.includes("node")) suggestions.add("node");
      }
    }
  }

  // 2. Snake_case <-> camelCase matching
  const camelCase = normalizedKey.replace(/_([a-z0-9])/gi, (_, char) => char.toUpperCase());
  const snakeCase = normalizedKey.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();

  for (const vk of validKeys) {
    if (vk === camelCase || vk.toLowerCase() === camelCase.toLowerCase()) {
      suggestions.add(vk);
    }
    if (vk === snakeCase || vk.toLowerCase() === snakeCase.toLowerCase()) {
      suggestions.add(vk);
    }
  }

  // 3. Common domain aliases
  const aliasMap: Record<string, string[]> = {
    task_id: ["taskId", "task"],
    taskid: ["taskId", "task"],
    task: ["taskId"],
    workflow_id: ["workflowId", "workflow"],
    workflowid: ["workflowId", "workflow"],
    wf: ["workflowId", "workflow"],
    wfid: ["workflowId", "workflow"],
    node_id: ["nodeId", "node"],
    nodeid: ["nodeId", "node"],
    role_id: ["roleId", "role"],
    roleid: ["roleId", "role"],
    scope_id: ["scopeId", "roleId", "workflowId", "nodeId"],
    scopeid: ["scopeId", "roleId", "workflowId", "nodeId"],
    id: ["taskId", "workflowId", "nodeId", "roleId"],
    name: ["title"],
    title: ["name"],
    desc: ["description"],
    description: ["summary", "context"],
    summary: ["description", "content"],
    body: ["content"],
    doc: ["content", "context"],
    assignee: ["toAssignee"],
    to_assignee: ["toAssignee"],
    to_role: ["toRole"],
    depends_on: ["dependsOn", "dependsOnTaskId"],
    depends_on_task_id: ["dependsOnTaskId", "dependsOn"],
    context_summary: ["contextSummary"],
    rejected_approaches: ["rejectedApproaches"],
  };

  const directAliases = aliasMap[normalizedKey.toLowerCase()] ?? [];
  for (const alias of directAliases) {
    if (validKeys.includes(alias)) {
      suggestions.add(alias);
    }
  }

  // 4. Fuzzy distance matching (Levenshtein distance <= 2)
  const distanceMatches: Array<{ key: string; dist: number }> = [];
  for (const vk of validKeys) {
    if (suggestions.has(vk)) continue;
    const dist = levenshteinDistance(normalizedKey, vk);
    if (dist <= 2) {
      distanceMatches.push({ key: vk, dist });
    }
  }

  // Sort by lowest edit distance
  distanceMatches.sort((a, b) => a.dist - b.dist);
  for (const m of distanceMatches) {
    suggestions.add(m.key);
  }

  return Array.from(suggestions);
}

/**
 * Formats a structured, prescriptive validation error message containing:
 * - Clear problem statement (failed fields and validation reasons)
 * - Unknown parameters with "Did you mean ...?" contextual suggestions
 * - Scope-specific hints for missing required scope properties
 * - Comprehensive list of accepted parameters
 */
export function formatValidationError(options: {
  toolName: string;
  schema?: z.ZodTypeAny;
  rawArgs: unknown;
  zodIssues?: z.ZodIssue[];
}): string {
  const { toolName, schema, rawArgs, zodIssues } = options;
  const lines: string[] = [];
  lines.push(`Invalid arguments for tool "${toolName}":`);

  const validKeys = schema ? extractSchemaKeys(schema) : [];
  const rawObj = rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)
    ? (rawArgs as Record<string, unknown>)
    : null;
  const scope = typeof rawObj?.scope === "string" ? rawObj.scope : undefined;

  // 1. Zod Issues / Failed fields
  if (zodIssues && zodIssues.length > 0) {
    lines.push("• Failed fields:");
    for (const issue of zodIssues) {
      const pathStr = issue.path.length > 0 ? issue.path.join(".") : "root";
      lines.push(`  - ${pathStr}: ${issue.message}`);
    }
  } else if (!rawObj && rawArgs !== undefined && rawArgs !== null) {
    lines.push(`• Expected an arguments object, received ${typeof rawArgs}.`);
  }

  // 2. Unknown properties & Suggestions
  if (rawObj && validKeys.length > 0) {
    const passedKeys = Object.keys(rawObj);
    const validKeySet = new Set(validKeys);
    const unknownKeys = passedKeys.filter((k) => !validKeySet.has(k));

    if (unknownKeys.length > 0) {
      lines.push("• Unknown parameters:");
      for (const uk of unknownKeys) {
        const suggestions = suggestPropertyNames(uk, validKeys, { scope });
        if (suggestions.length > 0) {
          lines.push(`  - Passed '${uk}' -> Did you mean '${suggestions.join("' or '")}'?`);
        } else {
          lines.push(`  - Passed unknown parameter '${uk}'`);
        }
      }
    }
  }

  // 3. Scope-specific hints
  if (scope) {
    const lowerScope = scope.toLowerCase();
    if (lowerScope === "role") {
      const hasRole = Boolean(
        rawObj?.roleId || rawObj?.role || (validKeys.includes("scopeId") && rawObj?.scopeId),
      );
      if (
        !hasRole ||
        (zodIssues && zodIssues.some((i) => i.path.includes("roleId") || i.path.includes("role")))
      ) {
        lines.push(
          "• Scope hint: When scope is 'role', you must provide 'roleId' (e.g. 'unity-gameplay-engineer', 'developer', 'qa-engineer') or 'role'.",
        );
      }
    } else if (lowerScope === "workflow") {
      const hasWf = Boolean(
        rawObj?.workflowId || rawObj?.workflow ||
          (validKeys.includes("scopeId") && rawObj?.scopeId),
      );
      if (
        !hasWf ||
        (zodIssues &&
          zodIssues.some((i) => i.path.includes("workflowId") || i.path.includes("workflow")))
      ) {
        lines.push(
          "• Scope hint: When scope is 'workflow', you must provide 'workflowId' (or 'workflow').",
        );
      }
    } else if (lowerScope === "node") {
      const hasNode = Boolean(
        rawObj?.nodeId || rawObj?.node || (validKeys.includes("scopeId") && rawObj?.scopeId),
      );
      const hasWf = Boolean(rawObj?.workflowId || rawObj?.workflow);
      if (
        !hasNode ||
        !hasWf ||
        (zodIssues &&
          zodIssues.some((i) => i.path.includes("nodeId") || i.path.includes("workflowId")))
      ) {
        lines.push(
          "• Scope hint: When scope is 'node', you must provide both 'workflowId' (or 'workflow') and 'nodeId' (or 'node').",
        );
      }
    }
  }

  // 4. Accepted parameters
  if (validKeys.length > 0) {
    lines.push(`• Accepted parameters for "${toolName}": ${validKeys.join(", ")}`);
  }

  return lines.join("\n");
}

/**
 * Unwraps Zod schemas that are wrapped in effects (.refine, .transform, .superRefine),
 * pipelines, or lazy wrappers to reveal the underlying base schema. This ensures MCP servers
 * can properly inspect property shapes and register full parameter definitions for tools/list,
 * while preserving top-level optional/default handling for parameter-less executions.
 */
export function unwrapZodObject(schema: z.ZodTypeAny): z.ZodTypeAny {
  // deno-lint-ignore no-explicit-any
  let current: any = schema;
  // deno-lint-ignore no-explicit-any
  const visited = new Set<any>();

  while (current && typeof current === "object" && !visited.has(current)) {
    visited.add(current);
    if (!current._def) break;

    const typeName = current._def.typeName;
    if (typeName === "ZodEffects" || current._def.schema) {
      current = current._def.schema;
    } else if (typeName === "ZodPipeline" || current._def.in) {
      current = current._def.in;
    } else if (typeName === "ZodLazy" || typeof current._def.getter === "function") {
      current = current._def.getter();
    } else {
      break;
    }
  }

  return current;
}

export function defineTool<TSchema extends z.ZodTypeAny = z.ZodTypeAny>(
  opts: DefineToolOptions<TSchema>,
): McpTool<z.input<TSchema>> {
  const validKeys = opts.schema ? extractSchemaKeys(opts.schema) : [];
  const validKeySet = new Set(validKeys);

  const executeHandler = async (rawArgs: unknown): Promise<ToolCallResponse> => {
    let parsedArgs: z.output<TSchema>;
    if (opts.schema) {
      const argsObj = rawArgs ?? {};
      const parsed = opts.schema.safeParse(argsObj);

      // Check for unknown properties passed in rawArgs
      let hasUnknownKeys = false;
      if (
        argsObj &&
        typeof argsObj === "object" &&
        !Array.isArray(argsObj) &&
        validKeys.length > 0
      ) {
        for (const k of Object.keys(argsObj)) {
          if (!validKeySet.has(k)) {
            hasUnknownKeys = true;
            break;
          }
        }
      }

      if (!parsed.success || hasUnknownKeys) {
        const errorMsg = formatValidationError({
          toolName: opts.name,
          schema: opts.schema,
          rawArgs,
          zodIssues: parsed.success ? undefined : parsed.error.issues,
        });
        return createErrorResponse(errorMsg);
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
      const registeredSchema = opts.schema ? unwrapZodObject(opts.schema) : undefined;
      server.registerTool(
        opts.name,
        {
          description: opts.description,
          // deno-lint-ignore no-explicit-any
          ...(registeredSchema ? { inputSchema: registeredSchema as any } : {}),
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
