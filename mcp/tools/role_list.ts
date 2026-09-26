import { z } from "zod";
import { listRoles } from "../../store/kv.ts";
import type { Role } from "../../store/types.ts";
import { defineTool, resolveWorkflow, richResponse } from "../helpers.ts";

const RoleListSchema = z.object({
  workflowId: z.string().min(1).describe(
    "The workflow ID, name, or slug to list roles for (required).",
  ),
  format: z.enum(["markdown", "json", "both"]).optional().default("both").describe(
    "Optional output format. 'markdown' returns a formatted table, 'json' returns raw data, 'both' (default) returns multi-block content for user and assistant.",
  ),
});

function formatRoleListMarkdown(workflowId: string, roles: Role[]): string {
  if (roles.length === 0) {
    return `## 👥 Roles for Workflow \`${workflowId}\`\n\n*No roles found.*`;
  }
  let md = `## 👥 Roles for Workflow \`${workflowId}\` (${roles.length})\n\n`;
  md += `| Role Name | Description | ID | Created |\n`;
  md += `| :--- | :--- | :--- | :--- |\n`;
  for (const r of roles) {
    const desc = r.description ? r.description.replace(/\|/g, "/") : "-";
    const created = r.createdAt ? r.createdAt.slice(0, 10) : "-";
    md += `| **${r.name}** | ${desc} | \`${r.id}\` | ${created} |\n`;
  }
  return md;
}

export const roleListTool = defineTool({
  name: "role_list",
  description: "Lists all user-defined roles associated with a specific workflow.",
  schema: RoleListSchema,
  execute: async ({ workflowId: workflowIdArg, format }) => {
    let workflowId = workflowIdArg;
    const resolved = await resolveWorkflow(workflowId);
    if (resolved) {
      workflowId = resolved.id;
    }

    const roles = await listRoles({ workflowId });
    const markdown = formatRoleListMarkdown(workflowId, roles);
    return richResponse({
      data: { workflowId, roles },
      markdown,
      format,
    });
  },
});
