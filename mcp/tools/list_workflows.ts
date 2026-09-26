import { z } from "zod";
import { listReferencedChildWorkflowIds, listWorkflows } from "../../store/kv.ts";
import type { Workflow } from "../../store/types.ts";
import { defineTool, formatWorkflowListMarkdown, richResponse } from "../helpers.ts";

const ListWorkflowsSchema = z.object({
  query: z.string().optional().describe(
    "Optional search query to filter workflows by name or description (consolidates search_workflow).",
  ),
  filter: z.enum(["standalone", "subworkflows", "all"]).optional().describe(
    "Filter workflows: 'standalone' (default when no query) returns only top-level workflows; 'subworkflows' returns internal child workflows; 'all' (default when query is provided) returns all workflows.",
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
    "Lists workflows or searches them by query. When query is provided, searches across workflow names and descriptions (consolidating search_workflow). Supports filtering by 'standalone', 'subworkflows', or 'all'.",
  schema: ListWorkflowsSchema,
  execute: async ({ query, filter, limit, format }) => {
    const effectiveFilter = filter ?? (query ? "all" : "standalone");

    const [allWorkflows, referencedIds] = await Promise.all([
      listWorkflows(limit !== undefined && !query ? { limit } : undefined),
      listReferencedChildWorkflowIds(),
    ]);

    const isSubworkflow = (wf: Workflow) =>
      wf.intendedForIndependentRun === false ||
      (wf.intendedForIndependentRun !== true && referencedIds.has(wf.id));

    let filtered = allWorkflows.filter((wf) => {
      if (effectiveFilter === "subworkflows") {
        return isSubworkflow(wf);
      }
      if (effectiveFilter === "standalone") {
        return !isSubworkflow(wf);
      }
      return true; // "all"
    });

    if (query && query.trim()) {
      const q = query.trim().toLowerCase();
      const terms = q.split(/\s+/).filter(Boolean);
      filtered = filtered.filter((wf) => {
        const nameLower = wf.name.toLowerCase();
        const descLower = (wf.description || "").toLowerCase();
        return terms.every((t) => nameLower.includes(t) || descLower.includes(t));
      });
    }

    if (limit !== undefined && limit > 0) {
      filtered = filtered.slice(0, limit);
    }

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
