import { z } from "zod";
import { listReferencedChildWorkflowIds, listWorkflows } from "../../store/kv.ts";
import type { Workflow } from "../../store/types.ts";
import { defineTool, formatWorkflowListMarkdown, richResponse } from "../helpers.ts";

const ListWorkflowsSchema = z.object({
  filter: z.enum(["standalone", "subworkflows", "all"]).optional().default("standalone").describe(
    "Filter workflows: 'standalone' (default) returns only top-level workflows intended for independent execution; 'subworkflows' returns internal child workflows; 'all' returns all workflows.",
  ),
  limit: z.number().int().positive().optional().describe(
    "Optional maximum number of workflows to return.",
  ),
  format: z.enum(["markdown", "json", "both"]).optional().default("both").describe(
    "Optional output format. 'markdown' returns a formatted table, 'json' returns raw data, 'both' (default) returns multi-block content for user and assistant.",
  ),
}).optional().default({});

export const listWorkflowsTool = defineTool({
  name: "workflow_list",
  description:
    "Lists workflows with summary information including ID, name, description, type (standalone vs sub-workflow), createdAt, and updatedAt timestamps. Defaults to showing standalone top-level workflows (intended for independent run). Use filter: 'all' or 'subworkflows' to view internal sub-workflows.",
  schema: ListWorkflowsSchema,
  execute: async ({ filter, limit, format }) => {
    const [allWorkflows, referencedIds] = await Promise.all([
      listWorkflows(limit !== undefined ? { limit } : undefined),
      listReferencedChildWorkflowIds(),
    ]);

    const isSubworkflow = (wf: Workflow) =>
      wf.intendedForIndependentRun === false ||
      (wf.intendedForIndependentRun !== true && referencedIds.has(wf.id));

    const filtered = allWorkflows.filter((wf) => {
      if (filter === "subworkflows") {
        return isSubworkflow(wf);
      }
      if (filter === "standalone") {
        return !isSubworkflow(wf);
      }
      return true; // "all"
    });

    const summary = filtered.map((workflow) => ({
      id: workflow.id,
      name: workflow.name,
      type: isSubworkflow(workflow) ? "subworkflow" : "standalone",
      intendedForIndependentRun: !isSubworkflow(workflow),
      description: workflow.description,
      createdAt: workflow.createdAt,
      updatedAt: workflow.updatedAt,
    }));
    const markdown = formatWorkflowListMarkdown(filtered, referencedIds);

    return richResponse({
      data: summary,
      markdown,
      format,
    });
  },
});
