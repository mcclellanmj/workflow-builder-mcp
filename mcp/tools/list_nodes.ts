import { z } from "zod";
import { getExecution } from "../../store/kv.ts";
import {
  createErrorResponse,
  defineTool,
  formatNodeListMarkdown,
  hydrateNodesWithExecution,
  indexEdges,
  requireWorkflowGraph,
  richResponse,
} from "../helpers.ts";

const ListNodesSchema = z.object({
  workflow: z.string().min(1).optional().describe(
    "The unique ID, name, or slug of the workflow to list nodes for.",
  ),
  workflowId: z.string().min(1).optional().describe(
    "Alias for 'workflow'. The unique ID, name, or slug of the workflow to list nodes for.",
  ),
  executionId: z.string().min(1).optional().describe(
    "Optional execution ID. When provided, node status indicators reflect that specific concurrent run's state.",
  ),
  format: z.enum(["markdown", "json", "both"]).optional().default("both").describe(
    "Optional output format. 'markdown' returns a formatted table, 'json' returns raw data, 'both' (default) returns multi-block content for user and assistant.",
  ),
}).refine((data) => data.workflow || data.workflowId, {
  message: "Workflow ('workflow' or 'workflowId') must be provided.",
});

export const listNodesTool = defineTool({
  name: "node_list",
  description:
    "Lists all nodes in a workflow along with their runtime status and connected inbound and outbound edges. Supports workflow UUIDs, exact names, or slugs. When an executionId is provided, node statuses reflect that specific concurrent run's state.",
  schema: ListNodesSchema,
  execute: async ({ workflow, workflowId, executionId, format }) => {
    const targetWorkflow = workflow ?? workflowId!;
    const graphCheck = await requireWorkflowGraph(targetWorkflow);
    if ("error" in graphCheck) return graphCheck.error;

    let { workflow: wf, nodes, edges } = graphCheck;

    if (executionId) {
      const execution = await getExecution(executionId);
      if (!execution) {
        return createErrorResponse(`Execution with ID "${executionId}" not found.`);
      }
      nodes = hydrateNodesWithExecution(nodes, execution);
    }

    const { inboundMap, outboundMap } = indexEdges(edges);

    const nodesWithConnections = nodes.map((node) => ({
      ...node,
      inboundEdges: inboundMap.get(node.id) ?? [],
      outboundEdges: outboundMap.get(node.id) ?? [],
    }));

    const markdown = formatNodeListMarkdown(wf, nodes, edges);

    return richResponse({
      data: nodesWithConnections,
      markdown,
      format,
    });
  },
});
