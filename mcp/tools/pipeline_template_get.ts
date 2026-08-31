import { z } from "zod";
import { getFlowTemplate, listFlowTemplates } from "../../store/kv.ts";
import { createErrorResponse, defineTool, jsonResponse } from "../helpers.ts";

const PipelineTemplateGetSchema = z.object({
  templateId: z.string().min(1).optional().describe(
    "Unique identifier of the FlowTemplate to retrieve (e.g. 'unity-dev-playtest-qa', 'code-review-audit').",
  ),
  id: z.string().min(1).optional().describe("Alias for 'templateId'."),
}).refine((data) => data.templateId || data.id, {
  message: "Either 'templateId' or 'id' must be provided.",
});

export const pipelineTemplateGetTool = defineTool({
  name: "pipeline_template_get",
  description:
    "Fetches the full definition of a pipeline FlowTemplate including stages, role specifications, allowed transitions, and validation guards.",
  schema: PipelineTemplateGetSchema,
  execute: async ({ templateId, id }) => {
    const identifier = (templateId ?? id)!.trim();
    let template = await getFlowTemplate(identifier);

    if (!template) {
      const allTemplates = await listFlowTemplates();
      template = allTemplates.find(
        (t) =>
          t.id.toLowerCase() === identifier.toLowerCase() ||
          t.name.toLowerCase() === identifier.toLowerCase(),
      ) ?? null;
    }

    if (!template) {
      return createErrorResponse(
        `Flow template not found: "${identifier}". Use 'pipeline_template_list' to discover available templates.`,
      );
    }

    return jsonResponse({ template });
  },
});
