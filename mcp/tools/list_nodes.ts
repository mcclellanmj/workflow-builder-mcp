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
  workflowId: z.string().min(1).describe("The unique ID of the workflow to list nodes for."),
  executionId: z.string().min(1).optional().describe(
    "Optional execution ID. When provided, node status indicators reflect that specific concurrent run's state.",
  ),
  format: z.enum(["markdown", "json", "both"]).optional().default("both").describe(
    "Optional output format. 'markdown' returns a formatted table, 'json' returns raw data, 'both' (default) returns multi-block content for user and assistant.",
  ),
});

export const listNodesTool = defineTool({
  name: "node_list",
  description:
    "Lists all nodes in a workflow along with their runtime status and connected inbound and outbound edges. When an executionId is provided, node statuses reflect that specific concurrent run's state.",
  schema: ListNodesSchema,
  execute: async ({ workflowId, executionId, format }) => {
    const graphCheck = await requireWorkflowGraph(workflowId);
    if ("error" in graphCheck) return graphCheck.error;

    let { workflow, nodes, edges } = graphCheck;

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

    const markdown = formatNodeListMarkdown(workflow, nodes, edges);

    return richResponse({
      data: nodesWithConnections,
      markdown,
      format,
    });
  },
});
