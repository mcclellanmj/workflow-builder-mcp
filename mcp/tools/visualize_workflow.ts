import { z } from "zod";
import { exportWorkflowBundle } from "../../store/kv.ts";
import type { WorkflowExecution } from "../../store/types.ts";
import { generateInteractiveHtml } from "../html_visualizer.ts";
import {
  createErrorResponse,
  createSuccessResponse,
  defineTool,
  hydrateNodesWithExecution,
  renderMermaidFlowchart,
  requireExecution,
  requireWorkflowGraph,
} from "../helpers.ts";

const VisualizeWorkflowInputSchema = z.object({
  workflowId: z.string().min(1).optional().describe(
    "The unique identifier of the workflow to visualize. Required if executionId is not provided.",
  ),
  executionId: z.string().min(1).optional().describe(
    "Optional execution ID. When provided, the diagram/visualizer reflects node statuses for that specific concurrent run.",
  ),
  format: z.enum(["mermaid", "html"]).optional().default("mermaid").describe(
    "The output diagram format. 'mermaid' (default) returns a Mermaid flowchart string. 'html' exports a standalone interactive HTML visualizer to disk with node prompt inspection and subworkflow drill-down.",
  ),
  filePath: z.string().optional().describe(
    "Optional file path on disk where the interactive HTML visualizer should be saved. When provided, automatically enables HTML output format.",
  ),
}).refine((data) => data.workflowId || data.executionId, {
  message: "At least one of 'workflowId' or 'executionId' must be provided.",
});

export const visualizeWorkflowTool = defineTool({
  name: "workflow_visualize",
  description:
    "Visualizes a workflow graph. Supports static Mermaid flowcharts ('mermaid') or rich interactive HTML files ('html' or 'filePath') that allow clicking into nodes to view prompts, configs, iteration history, and drilling down into subworkflows with breadcrumb navigation. When an executionId is provided, node status indicators reflect that specific concurrent execution's state.",
  schema: VisualizeWorkflowInputSchema,
  execute: async ({ workflowId, executionId, format, filePath }) => {
    const isHtml = format === "html" || Boolean(filePath);

    if (isHtml) {
      let targetWorkflowId = workflowId;
      let activeExecution: WorkflowExecution | undefined;

      if (executionId) {
        const execCheck = await requireExecution(executionId);
        if ("error" in execCheck) return execCheck.error;
        activeExecution = execCheck.execution;
        targetWorkflowId = execCheck.workflow.id;
      }

      const bundle = await exportWorkflowBundle(targetWorkflowId!, {
        includeSubworkflows: true,
        includeExecutions: true,
      });

      if (!bundle) {
        return createErrorResponse(`Workflow "${targetWorkflowId}" was not found.`);
      }

      if (activeExecution) {
        bundle.workflow.nodes = hydrateNodesWithExecution(
          bundle.workflow.nodes,
          activeExecution,
        );
      }

      const htmlContent = generateInteractiveHtml({
        bundle,
        activeExecutionId: executionId,
      });

      const resolvedPath = filePath || `./workflow_${targetWorkflowId}_visualizer.html`;

      try {
        await Deno.writeTextFile(resolvedPath, htmlContent);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return createErrorResponse(
          `Failed to write HTML visualizer to file "${resolvedPath}": ${msg}`,
        );
      }

      const totalSubworkflows = bundle.subworkflows?.length ?? 0;
      const totalNodes = bundle.workflow.nodes.length +
        (bundle.subworkflows?.reduce((acc, s) => acc + s.nodes.length, 0) ?? 0);

      const fileUrl = resolvedPath.startsWith("/")
        ? `file://${resolvedPath}`
        : `file://${Deno.cwd()}/${resolvedPath.replace(/^\.\//, "")}`;

      let md = `### 📊 Interactive Workflow Visualizer Generated\n\n`;
      md += `> **Workflow**: **${bundle.workflow.workflow.name}** (\`${targetWorkflowId}\`)\n`;
      if (executionId) {
        md += `> **Execution Run**: \`${executionId}\`\n`;
      }
      md += `> **Saved File**: [${resolvedPath}](${fileUrl})\n`;
      md += `> **Total Nodes**: ${totalNodes} | **Subworkflows Bundled**: ${totalSubworkflows}\n\n`;
      md += `💡 **Interactive Features Available in Browser**:\n`;
      md +=
        `- 🔍 **Click any node** to inspect full prompts, agent instructions, configs, and loop iteration history.\n`;
      md +=
        `- 📦 **Double-click subworkflows** or click "Drill Down" to inspect child graphs with breadcrumbs.\n`;
      md +=
        `- 🔄 **Pan & Zoom** the graph canvas, switch orientation (TB / LR), or filter by execution status.\n\n`;
      md += `To view, open the file in your browser: \`open "${resolvedPath}"\``;

      return createSuccessResponse(md);
    }

    if (executionId) {
      const execCheck = await requireExecution(executionId);
      if ("error" in execCheck) return execCheck.error;

      const { execution, nodes, edges } = execCheck;
      const hydratedNodes = hydrateNodesWithExecution(nodes, execution);
      const mermaid = renderMermaidFlowchart(hydratedNodes, edges);
      return createSuccessResponse(mermaid);
    }

    const graphCheck = await requireWorkflowGraph(workflowId!);
    if ("error" in graphCheck) return graphCheck.error;

    const mermaid = renderMermaidFlowchart(graphCheck.nodes, graphCheck.edges);
    return createSuccessResponse(mermaid);
  },
});
