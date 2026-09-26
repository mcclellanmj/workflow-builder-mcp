import { z } from "zod";
import { createRole } from "../../store/kv.ts";
import { defineTool, jsonResponse, resolveWorkflow } from "../helpers.ts";

const RoleCreateSchema = z.object({
  workflowId: z.string().min(1).describe(
    "The workflow ID, name, or slug to associate this role with (required).",
  ),
  name: z.string().min(1).describe(
    "The name of the role (e.g. 'frontend', 'security-reviewer', 'qa', 'architect').",
  ),
  description: z.string().max(500, "Job description must be 500 characters or less").optional()
    .describe(
      "Optional job description (<500 characters) of what this role is responsible for.",
    ),
});

export const roleCreateTool = defineTool({
  name: "role_create",
  description:
    "Creates a new user-defined role or updates an existing role scoped to a workflow.",
  schema: RoleCreateSchema,
  execute: async ({ workflowId: workflowIdArg, name, description }) => {
    let workflowId = workflowIdArg;
    const resolved = await resolveWorkflow(workflowId);
    if (resolved) {
      workflowId = resolved.id;
    }

    const role = await createRole({ workflowId, name, description });
    return jsonResponse({ role });
  },
});
