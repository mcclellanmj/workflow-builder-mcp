import { z } from "zod";
import { listRoles } from "../../store/kv.ts";
import type { Role } from "../../store/types.ts";
import { defineTool, richResponse } from "../helpers.ts";

const RoleListSchema = z.object({
  format: z.enum(["markdown", "json", "both"]).optional().default("both").describe(
    "Optional output format. 'markdown' returns a formatted table, 'json' returns raw data, 'both' (default) returns multi-block content for user and assistant.",
  ),
}).optional().default({});

function formatRoleListMarkdown(roles: Role[]): string {
  if (roles.length === 0) {
    return "## 👥 Roles\n\n*No roles found.*";
  }
  let md = `## 👥 Roles (${roles.length})\n\n`;
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
  description: "Lists all available user-defined roles with their descriptions and identifiers.",
  schema: RoleListSchema,
  execute: async ({ format }) => {
    const roles = await listRoles();
    const markdown = formatRoleListMarkdown(roles);
    return richResponse({
      data: { roles },
      markdown,
      format,
    });
  },
});
