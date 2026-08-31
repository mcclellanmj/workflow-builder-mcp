import { z } from "zod";
import { listFlowTemplates } from "../../store/kv.ts";
import type { FlowTemplate } from "../../store/types.ts";
import { defineTool, jsonResponse } from "../helpers.ts";

const PipelineTemplateListSchema = z.object({
  tag: z.string().optional().describe("Optional single tag to filter templates by."),
  tags: z.array(z.string()).optional().describe(
    "Optional multiple tags to filter templates by (matches any).",
  ),
  role: z.string().optional().describe(
    "Optional role to filter templates (matches recommendedRoles or stage roles).",
  ),
  format: z.enum(["json", "markdown", "both"]).optional().default("both").describe(
    "Output format ('json', 'markdown', or 'both'). Defaults to 'both'.",
  ),
});

export function formatTemplateListMarkdown(templates: FlowTemplate[]): string {
  if (templates.length === 0) {
    return "No flow templates found matching the specified criteria.";
  }

  const lines: string[] = [
    `### Pipeline Flow Templates (${templates.length} available)`,
    "",
    "| Template ID | Name | Stages | Recommended Roles | Tags |",
    "|:---|:---|:---|:---|:---|",
  ];

  for (const t of templates) {
    const stageSummary = t.stages.map((s) => `\`${s.id}\` (${s.role})`).join(" ➔ ");
    const roles = t.recommendedRoles && t.recommendedRoles.length > 0
      ? t.recommendedRoles.join(", ")
      : "-";
    const tags = t.tags && t.tags.length > 0 ? t.tags.join(", ") : "-";
    lines.push(`| \`${t.id}\` | **${t.name}** | ${stageSummary} | ${roles} | ${tags} |`);
  }

  return lines.join("\n");
}

export const pipelineTemplateListTool = defineTool({
  name: "pipeline_template_list",
  description:
    "Lists available workflow pipeline templates (built-in and custom), with optional filtering by tags or roles.",
  schema: PipelineTemplateListSchema,
  execute: async ({ tag, tags, role, format }) => {
    let templates = await listFlowTemplates();

    const queryTags: string[] = [];
    if (tag && tag.trim()) {
      queryTags.push(tag.trim().toLowerCase());
    }
    if (tags && tags.length > 0) {
      queryTags.push(...tags.map((t) => t.trim().toLowerCase()).filter(Boolean));
    }

    if (queryTags.length > 0) {
      templates = templates.filter((tpl) => {
        const tplTags = (tpl.tags ?? []).map((t) => t.toLowerCase());
        return queryTags.some((q) => tplTags.includes(q));
      });
    }

    if (role && role.trim()) {
      const qRole = role.trim().toLowerCase();
      templates = templates.filter((tpl) => {
        const matchesRecRole = (tpl.recommendedRoles ?? []).some((r) => r.toLowerCase() === qRole);
        const matchesStageRole = tpl.stages.some((s) => s.role.toLowerCase() === qRole);
        return matchesRecRole || matchesStageRole;
      });
    }

    const count = templates.length;
    const markdown = formatTemplateListMarkdown(templates);

    if (format === "json") {
      return jsonResponse({ templates, count });
    }

    if (format === "markdown") {
      return {
        content: [{ type: "text", text: markdown }],
      };
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ templates, count }, null, 2),
        },
        {
          type: "text",
          text: markdown,
        },
      ],
    };
  },
});
