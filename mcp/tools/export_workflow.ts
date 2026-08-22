import { z } from "zod";
import { exportWorkflowBundle } from "../../store/kv.ts";
import { createErrorResponse, defineTool, requireWorkflow, richResponse } from "../helpers.ts";

const ExportWorkflowSchema = z.object({
  workflow: z.string().min(1).optional().describe(
    "The unique identifier, name, or slug of the workflow to export.",
  ),
  workflowId: z.string().min(1).optional().describe(
    "Alias for 'workflow'. The unique identifier, name, or slug of the workflow to export.",
  ),
  includeSubworkflows: z.boolean().optional().default(true).describe(
    "Optional. If true (default), recursively finds and bundles any child subworkflows referenced by subworkflow nodes.",
  ),
  includeExecutions: z.boolean().optional().default(false).describe(
    "Optional. If true, includes historical execution runs in the export bundle.",
  ),
  filePath: z.string().optional().describe(
    "Optional absolute or relative file path. When provided, saves the exported JSON bundle directly to this file on disk.",
  ),
  format: z.enum(["markdown", "json", "both"]).optional().default("both").describe(
    "Optional output format. 'markdown' returns a summary, 'json' returns the export bundle JSON, 'both' (default) returns multi-block content for user and assistant.",
  ),
}).refine((data) => data.workflow || data.workflowId, {
  message: "Workflow ('workflow' or 'workflowId') must be provided.",
});

export const exportWorkflowTool = defineTool({
  name: "workflow_export",
  description:
    "Exports a complete workflow graph as a portable JSON bundle. Supports workflow UUIDs, exact names, or slugs. Supports recursive bundling of referenced child subworkflows, optional execution history, and direct export to a file path on disk. The exported bundle can be imported using workflow_import.",
  schema: ExportWorkflowSchema,
  execute: async ({
    workflow,
    workflowId,
    includeSubworkflows,
    includeExecutions,
    filePath,
    format,
  }) => {
    const targetWorkflow = workflow ?? workflowId!;
    const wfCheck = await requireWorkflow(targetWorkflow);
    if ("error" in wfCheck) return wfCheck.error;

    const actualWfId = wfCheck.workflow.id;
    const bundle = await exportWorkflowBundle(actualWfId, {
      includeSubworkflows,
      includeExecutions,
    });

    if (!bundle) {
      return createErrorResponse(`Workflow "${actualWfId}" was not found.`);
    }

    if (filePath) {
      try {
        await Deno.writeTextFile(filePath, JSON.stringify(bundle, null, 2));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return createErrorResponse(`Failed to write export bundle to file "${filePath}": ${msg}`);
      }
    }

    const { workflow: primary, subworkflows = [] } = bundle;
    const totalWfs = 1 + subworkflows.length;
    const totalNodes = primary.nodes.length +
      subworkflows.reduce((acc, sw) => acc + sw.nodes.length, 0);
    const totalEdges = primary.edges.length +
      subworkflows.reduce((acc, sw) => acc + sw.edges.length, 0);
    const totalExecs = (primary.executions?.length ?? 0) +
      subworkflows.reduce((acc, sw) => acc + (sw.executions?.length ?? 0), 0);

    let md = `### 📦 Workflow Export: **${primary.workflow.name}**\n\n`;
    md += `> **Primary Workflow ID**: \`${primary.workflow.id}\`\n`;
    md += `> **Total Workflows Bundled**: ${totalWfs}\n`;
    md += `> **Total Nodes**: ${totalNodes} | **Total Edges**: ${totalEdges}\n`;
    if (includeExecutions) {
      md += `> **Total Execution Runs**: ${totalExecs}\n`;
    }
    if (filePath) {
      md += `> **Saved to File**: \`${filePath}\`\n`;
    }
    md += `> **Exported At**: ${bundle.exportedAt}\n\n`;

    md += `#### Primary Workflow\n`;
    md += `- **Name**: ${primary.workflow.name}\n`;
    md += `- **Nodes**: ${primary.nodes.length}\n`;
    md += `- **Edges**: ${primary.edges.length}\n`;
    if (primary.workflow.description) {
      md += `- **Description**: ${primary.workflow.description}\n`;
    }

    if (subworkflows.length > 0) {
      md += `\n#### Bundled Subworkflows (${subworkflows.length})\n\n`;
      md += `| Subworkflow Name | ID | Nodes | Edges |\n`;
      md += `| :--- | :--- | :--- | :--- |\n`;
      for (const sw of subworkflows) {
        md +=
          `| **${sw.workflow.name}** | \`${sw.workflow.id}\` | ${sw.nodes.length} | ${sw.edges.length} |\n`;
      }
    }

    md +=
      `\n💡 *To import or clone this bundle, pass the JSON payload to \`workflow_import\` (use \`remapIds: true\` to clone with fresh IDs).*\n`;

    return richResponse({
      data: bundle,
      markdown: md,
      format,
    });
  },
});
