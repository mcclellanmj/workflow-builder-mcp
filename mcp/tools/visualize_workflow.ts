import { z } from "zod";
import { getCurrentServerOrigin } from "../../auth/context.ts";
import { createViewTicket, exportWorkflowBundle } from "../../store/kv.ts";
import type { WorkflowExecution } from "../../store/types.ts";
import { generateSsrVisualizerHtml } from "../ssr_visualizer.ts";
import {
  createErrorResponse,
  createSuccessResponse,
  defineTool,
  hydrateNodesWithExecution,
  renderMermaidFlowchart,
  requireExecution,
  requireWorkflow,
} from "../helpers.ts";

const VisualizeWorkflowInputSchema = z.object({
  workflow: z.string().min(1).optional().describe(
    "The unique identifier, name, or slug of the workflow to visualize. Required if executionId is not provided.",
  ),
  workflowId: z.string().min(1).optional().describe(
    "Alias for 'workflow'. The unique identifier, name, or slug of the workflow to visualize.",
  ),
  executionId: z.string().min(1).optional().describe(
    "Optional execution ID. When provided, the diagram/visualizer reflects node statuses for that specific concurrent run.",
  ),
  format: z.enum(["mermaid", "html", "url"]).optional().default("mermaid").describe(
    "The output format. 'mermaid' (default) returns Mermaid flowchart and share link. 'html' exports standalone interactive HTML with SSR SVG. 'url' returns live shareable web URL.",
  ),
  filePath: z.string().optional().describe(
    "Optional file path on disk where the interactive HTML visualizer should be saved. When provided, automatically saves HTML to disk.",
  ),
  expiresInDays: z.number().min(0.01).max(365).optional().default(7).describe(
    "Expiration duration for the shareable link in days (e.g. 7 for 1 week, 30 for 1 month, 365 for 1 year). Defaults to 7 days (1 week). Maximum is 365 days (1 year).",
  ),
  expiresInMinutes: z.number().int().min(1).max(525600).optional().describe(
    "Optional duration in minutes (max: 525600 for 1 year). If provided, overrides expiresInDays.",
  ),
}).refine((data) => data.workflow || data.workflowId || data.executionId, {
  message: "At least one of 'workflow', 'workflowId', or 'executionId' must be provided.",
});

export const visualizeWorkflowTool = defineTool({
  name: "workflow_visualize",
  description:
    "Visualizes a workflow graph using Deno Server-Side Rendering (SSR) and generates a secure shareable view link (1 week default, up to 1 year). Supports workflow UUIDs, exact names, or slugs. Supports static Mermaid flowcharts ('mermaid'), rich interactive HTML files ('html' or 'filePath'), or direct live web links ('url').",
  schema: VisualizeWorkflowInputSchema,
  execute: async ({
    workflow,
    workflowId,
    executionId,
    format,
    filePath,
    expiresInDays = 7,
    expiresInMinutes,
  }) => {
    let targetWorkflowId = workflow ?? workflowId;
    let activeExecution: WorkflowExecution | undefined;

    if (executionId) {
      const execCheck = await requireExecution(executionId);
      if ("error" in execCheck) return execCheck.error;
      activeExecution = execCheck.execution;
      targetWorkflowId = execCheck.workflow.id;
    } else if (targetWorkflowId) {
      const wfCheck = await requireWorkflow(targetWorkflowId);
      if ("error" in wfCheck) return wfCheck.error;
      targetWorkflowId = wfCheck.workflow.id;
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

    // 1. Calculate expiration duration (1 week default, configurable up to 1 year)
    let durationMinutes = 7 * 24 * 60;
    let durationLabel = "1 week";

    if (expiresInMinutes !== undefined) {
      durationMinutes = expiresInMinutes;
      const d = Math.floor(expiresInMinutes / (24 * 60));
      const h = Math.floor((expiresInMinutes % (24 * 60)) / 60);
      const m = expiresInMinutes % 60;
      if (d > 0 && h === 0 && m === 0) {
        durationLabel = d === 7 ? "1 week" : d === 365 ? "1 year" : `${d} days`;
      } else if (d > 0) {
        durationLabel = `${d}d ${h}h`;
      } else if (h > 0) {
        durationLabel = `${h}h ${m}m`;
      } else {
        durationLabel = `${m} mins`;
      }
    } else if (expiresInDays !== undefined) {
      durationMinutes = Math.round(expiresInDays * 24 * 60);
      durationLabel = expiresInDays === 7
        ? "1 week"
        : expiresInDays === 365
        ? "1 year"
        : expiresInDays === 1
        ? "1 day"
        : `${expiresInDays} days`;
    }

    // 2. Generate Secure View Ticket
    const ticket = await createViewTicket(
      targetWorkflowId!,
      executionId,
      durationMinutes,
    );

    const serverOrigin = getCurrentServerOrigin() || "http://localhost:8000";
    const shareUrl = `${serverOrigin}/visualize/${targetWorkflowId}?ticket=${ticket.ticketId}${
      executionId ? `&executionId=${executionId}` : ""
    }`;

    const isHtml = format === "html" || Boolean(filePath);
    const totalSubworkflows = bundle.subworkflows?.length ?? 0;
    const totalNodes = bundle.workflow.nodes.length +
      (bundle.subworkflows?.reduce((acc, s) => acc + s.nodes.length, 0) ?? 0);

    // 3. Handle Standalone HTML File Export if requested
    let savedFileMd = "";
    if (isHtml) {
      const resolvedPath = filePath || `./workflow_${targetWorkflowId}_visualizer.html`;
      const htmlContent = generateSsrVisualizerHtml({
        bundle,
        activeExecutionId: executionId,
        viewTicket: ticket,
        serverOrigin,
        isStandaloneFile: true,
      });

      try {
        await Deno.writeTextFile(resolvedPath, htmlContent);
        const fileUrl = resolvedPath.startsWith("/")
          ? `file://${resolvedPath}`
          : `file://${Deno.cwd()}/${resolvedPath.replace(/^\.\//, "")}`;
        savedFileMd = `> **Saved File**: [${resolvedPath}](${fileUrl})\n`;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        savedFileMd = `> ⚠️ **Disk Save Skipped**: ${msg} (view via Live Web Link below)\n`;
      }
    }

    // 4. If Mermaid format requested, render Mermaid alongside the share link
    if (format === "mermaid") {
      const mermaid = renderMermaidFlowchart(bundle.workflow.nodes, bundle.workflow.edges);
      let md = `### 📊 Workflow Visualization\n\n`;
      md +=
        `🔗 **Live Shareable Link (Valid for ${durationLabel})**: [${shareUrl}](${shareUrl})\n\n`;
      md += `\`\`\`mermaid\n${mermaid}\n\`\`\`\n\n`;
      md +=
        `> **Workflow**: **${bundle.workflow.workflow.name}** (\`${targetWorkflowId}\`) | **Nodes**: ${totalNodes} | **Subworkflows**: ${totalSubworkflows}\n`;
      if (executionId) {
        md += `> **Execution Run**: \`${executionId}\`\n`;
      }
      return createSuccessResponse(md);
    }

    // 5. Return Rich Markdown with Live Share Link & Feature Highlights
    let md = `### 📊 Interactive Workflow Visualizer Generated\n\n`;
    md += `🔗 **Live Shareable Link (Valid for ${durationLabel})**: [${shareUrl}](${shareUrl})\n\n`;
    md += `> **Workflow**: **${bundle.workflow.workflow.name}** (\`${targetWorkflowId}\`)\n`;
    if (executionId) {
      md += `> **Execution Run**: \`${executionId}\`\n`;
    }
    if (savedFileMd) {
      md += savedFileMd;
    }
    md += `> **Total Nodes**: ${totalNodes} | **Subworkflows Bundled**: ${totalSubworkflows}\n\n`;
    md += `💡 **Interactive Features Available in Browser**:\n`;
    md +=
      `- 🌐 **Zero CDN Dependencies**: Fast, deterministic Server-Side Rendered SVG vector graphics.\n`;
    md +=
      `- 🔍 **Click any node** to inspect full prompts, agent instructions, configs, and loop iteration history.\n`;
    md +=
      `- 📦 **Double-click subworkflows** or click "Drill Down" to inspect child graphs with breadcrumbs.\n`;
    md += `- 🔄 **Live Auto-Refresh**: Execution status updates in real-time as steps progress.\n`;
    md += `- 🔒 **Secure Share Link**: Valid for ${durationLabel} (configurable up to 1 year).\n\n`;
    md += `Click the link above to view in your browser.`;

    return createSuccessResponse(md);
  },
});
