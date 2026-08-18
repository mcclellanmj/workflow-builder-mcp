import { z } from "zod";
import { importWorkflowBundle, listEdges, listNodes } from "../../store/kv.ts";
import type { WorkflowExportBundle } from "../../store/types.ts";
import { validateGraph } from "../../validation/graph.ts";
import { createErrorResponse, defineTool, richResponse } from "../helpers.ts";

const ImportWorkflowSchema = z.object({
  data: z.union([z.string(), z.any()]).optional().describe(
    "The workflow export bundle to import, either as a JSON string or as an object. Required if filePath is not provided.",
  ),
  filePath: z.string().optional().describe(
    "Optional file path on disk to read the workflow export bundle from. Used if data is not provided.",
  ),
  remapIds: z.boolean().optional().default(false).describe(
    "Optional. If true, generates new UUIDs for the primary workflow, all child subworkflows, nodes, and edges, rewriting all references. Use this to clone workflows without ID collisions.",
  ),
  overwrite: z.boolean().optional().default(false).describe(
    "Optional. If true and remapIds is false, overwrites any existing workflow with the same ID.",
  ),
  validate: z.boolean().optional().default(true).describe(
    "Optional. If true (default), automatically validates the primary imported workflow graph integrity.",
  ),
  format: z.enum(["markdown", "json", "both"]).optional().default("both").describe(
    "Optional output format. 'markdown' returns a summary, 'json' returns the raw result, 'both' (default) returns multi-block content.",
  ),
}).refine(
  (val) => val.data !== undefined || (typeof val.filePath === "string" && val.filePath.length > 0),
  {
    message: "Either 'data' or 'filePath' must be provided.",
  },
);

export const importWorkflowTool = defineTool({
  name: "workflow_import",
  description:
    "Imports a workflow graph bundle into the store. Supports recreating workflows exactly or cloning them with fresh IDs (remapIds: true). Can read from a bundle object, JSON string, or a file path on disk (filePath). Can overwrite existing workflows (overwrite: true) and automatically validate graph integrity.",
  schema: ImportWorkflowSchema,
  execute: async ({ data, filePath, remapIds, overwrite, validate, format }) => {
    let bundle: WorkflowExportBundle;

    if (filePath && !data) {
      try {
        const fileContent = await Deno.readTextFile(filePath);
        bundle = JSON.parse(fileContent) as WorkflowExportBundle;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return createErrorResponse(`Failed to read export bundle from file "${filePath}": ${msg}`);
      }
    } else if (typeof data === "string") {
      try {
        bundle = JSON.parse(data) as WorkflowExportBundle;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return createErrorResponse(`Failed to parse workflow import JSON data: ${msg}`);
      }
    } else {
      bundle = data as unknown as WorkflowExportBundle;
    }

    let importResult;
    try {
      importResult = await importWorkflowBundle(bundle, {
        remapIds,
        overwrite,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return createErrorResponse(`Import failed: ${msg}`);
    }

    if (validate) {
      const primaryNodes = await listNodes(importResult.primaryWorkflowId);
      const primaryEdges = await listEdges(importResult.primaryWorkflowId);
      const val = validateGraph(primaryNodes, primaryEdges);
      importResult.validation = val;
    }

    let md = `### 📥 Workflow Import Successful\n\n`;
    md += `> **Primary Workflow ID**: \`${importResult.primaryWorkflowId}\`\n`;
    md += `> **Total Workflows Imported**: ${importResult.importedWorkflowIds.length}\n`;
    md +=
      `> **Total Nodes**: ${importResult.totalNodes} | **Total Edges**: ${importResult.totalEdges}\n`;
    if (importResult.totalExecutions > 0) {
      md += `> **Total Execution Runs Restored**: ${importResult.totalExecutions}\n`;
    }
    md += `> **IDs Remapped / Cloned**: ${
      importResult.remapped ? "Yes (Fresh UUIDs)" : "No (Original IDs preserved)"
    }\n\n`;

    if (importResult.validation) {
      const v = importResult.validation;
      md += `#### Graph Validation Status\n`;
      md += `- **Valid DAG / Graph**: ${v.valid ? "✅ Yes" : "❌ No"}\n`;
      if (v.errors.length > 0) {
        md += `- **Errors**:\n`;
        for (const err of v.errors) {
          md += `  - ❌ ${err}\n`;
        }
      }
      if (v.warnings.length > 0) {
        md += `- **Warnings**:\n`;
        for (const warn of v.warnings) {
          md += `  - ⚠️ ${warn}\n`;
        }
      }
      if (v.suggestions && v.suggestions.length > 0) {
        md += `- **Modularity Suggestions**: ${v.suggestions.length} suggestion(s) available\n`;
      }
    }

    if (importResult.remapped && importResult.idMap) {
      md += `\n#### Remapped Workflow IDs\n\n`;
      md += `| Original Workflow ID | New Workflow ID |\n`;
      md += `| :--- | :--- |\n`;
      for (const [oldId, newId] of Object.entries(importResult.idMap.workflows)) {
        md += `| \`${oldId}\` | \`${newId}\` |\n`;
      }
    }

    md +=
      `\n💡 *Call \`workflow_get\` with workflowId \`${importResult.primaryWorkflowId}\` to inspect nodes or \`workflow_start\` to begin execution.*\n`;

    return richResponse({
      data: importResult,
      markdown: md,
      format,
    });
  },
});
