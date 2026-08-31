import { z } from "zod";
import { createFlowTemplate } from "../../store/kv.ts";
import { defineTool, jsonResponse } from "../helpers.ts";

const StageTransitionSchema = z.object({
  targetStageId: z.string().min(1).describe("Target stage ID to transition into."),
  action: z.enum(["advance", "reject", "escalate", "delegate"]).describe(
    "Allowed transition action ('advance', 'reject', 'escalate', 'delegate').",
  ),
  allowedRoles: z.array(z.string()).optional().describe(
    "Optional list of roles permitted to trigger this transition.",
  ),
  requiresReviewApproval: z.boolean().optional().describe(
    "Whether review approval notes are required before transition.",
  ),
});

const StageValidationRulesSchema = z.object({
  minCommentLength: z.number().optional().describe("Minimum comment length required."),
  requireStructuredHandoff: z.boolean().optional().describe("Require structured handoff context."),
  requireRejectedApproachesOnReject: z.boolean().optional().describe(
    "Require rejected approaches upon rejection.",
  ),
  customGuards: z.array(z.string()).optional().describe("List of custom guard identifiers."),
});

const TemplateStageSchema = z.object({
  id: z.string().min(1).describe("Unique identifier for the stage within this pipeline."),
  name: z.string().min(1).describe("Human-readable stage name."),
  role: z.string().min(1).describe("Role assigned or required for this stage."),
  description: z.string().optional().describe(
    "Description of responsibilities and work in this stage.",
  ),
  allowedTransitions: z.array(StageTransitionSchema).default([]).describe(
    "Allowed directional transition rules from this stage.",
  ),
  requiredFields: z.array(z.string()).optional().describe(
    "Required fields before completing this stage.",
  ),
  validationRules: StageValidationRulesSchema.optional().describe(
    "Validation and guard rules for this stage.",
  ),
});

const PipelineTemplateCreateSchema = z.object({
  id: z.string().min(1).describe(
    "Unique identifier for the FlowTemplate (e.g. 'custom-qa-pipeline').",
  ),
  name: z.string().min(1).describe("Human-readable name of the template."),
  description: z.string().optional().describe("Detailed description of the pipeline workflow."),
  version: z.string().optional().default("1.0.0").describe(
    "Semantic version string (default: '1.0.0').",
  ),
  tags: z.array(z.string()).optional().default([]).describe(
    "Tags for categorizing and discovering the template.",
  ),
  recommendedRoles: z.array(z.string()).optional().default([]).describe(
    "Recommended roles involved across the pipeline.",
  ),
  defaultRejectionPolicy: z.enum(["rollback_to_stage", "restart_stage", "reset_all_subsequent"])
    .optional().default(
      "rollback_to_stage",
    ).describe("Default rejection loopback policy."),
  defaultMaxRejections: z.number().int().positive().optional().default(3).describe(
    "Max rejection cycles before circuit breaker trips.",
  ),
  stages: z.array(TemplateStageSchema).min(1).describe(
    "Ordered list of stage definitions with role requirements and transition matrices.",
  ),
});

export const pipelineTemplateCreateTool = defineTool({
  name: "pipeline_template_create",
  description:
    "Registers a new reusable FlowTemplate defining multi-stage workflow pipelines, role requirements, transition rules, and validation guards.",
  schema: PipelineTemplateCreateSchema,
  execute: async ({
    id,
    name,
    description,
    version,
    tags,
    recommendedRoles,
    defaultRejectionPolicy,
    defaultMaxRejections,
    stages,
  }) => {
    const template = await createFlowTemplate({
      id,
      name,
      description: description ?? "",
      version: version ?? "1.0.0",
      tags: tags ?? [],
      recommendedRoles: recommendedRoles ?? [],
      defaultRejectionPolicy: defaultRejectionPolicy ?? "rollback_to_stage",
      defaultMaxRejections: defaultMaxRejections ?? 3,
      stages,
    });

    return jsonResponse({ template });
  },
});
