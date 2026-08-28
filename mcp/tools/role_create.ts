import { z } from "zod";
import { createRole } from "../../store/kv.ts";
import { defineTool, jsonResponse } from "../helpers.ts";

const RoleCreateSchema = z.object({
  name: z.string().min(1).describe(
    "The name of the role (e.g. 'frontend', 'security-reviewer', 'qa', 'human').",
  ),
  description: z.string().optional().describe(
    "Optional description of what this role is responsible for.",
  ),
});

export const roleCreateTool = defineTool({
  name: "role_create",
  description:
    "Creates a new user-defined role or updates an existing role's description. Roles are lightweight arbitrary labels that categorize tasks and agents.",
  schema: RoleCreateSchema,
  execute: async ({ name, description }) => {
    const role = await createRole({ name, description });
    return jsonResponse({ role });
  },
});
