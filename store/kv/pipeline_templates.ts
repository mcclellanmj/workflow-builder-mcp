/**
 * Deno KV persistence for multi-stage FlowTemplates and default pipeline template registry.
 */

import type { FlowTemplate, RejectionPolicy, TaskPipeline, TaskPipelineStage } from "../types.ts";
import { getKv, resolveUserId } from "./client.ts";

/**
 * Built-in default pipeline templates.
 */
export const DEFAULT_FLOW_TEMPLATES: Record<string, FlowTemplate> = {
  "unity-dev-playtest-qa": {
    id: "unity-dev-playtest-qa",
    name: "Unity Dev, Playtest & QA Pipeline",
    description:
      "Multi-stage pipeline for Unity gameplay feature development, playtesting balance verification, and QA signoff.",
    version: "1.0.0",
    tags: ["unity", "gamedev", "playtest", "qa"],
    recommendedRoles: ["developer", "playtester", "qa"],
    defaultRejectionPolicy: "rollback_to_stage",
    defaultMaxRejections: 3,
    stages: [
      {
        id: "dev",
        name: "Unity Development",
        role: "developer",
        description: "Implement Unity gameplay mechanics, shaders, animations, and unit tests.",
        allowedTransitions: [
          { targetStageId: "playtest", action: "advance" },
        ],
        validationRules: {
          requireStructuredHandoff: true,
        },
      },
      {
        id: "playtest",
        name: "Playtesting & Balance",
        role: "playtester",
        description:
          "Perform gameplay playtest sessions, analyze feel, mechanics, difficulty curve, and performance.",
        allowedTransitions: [
          { targetStageId: "qa", action: "advance" },
          { targetStageId: "dev", action: "reject" },
        ],
        validationRules: {
          requireRejectedApproachesOnReject: true,
        },
      },
      {
        id: "qa",
        name: "QA Verification & Release",
        role: "qa",
        description:
          "Execute regression test matrix, cross-platform build validation, and final acceptance verification.",
        allowedTransitions: [
          { targetStageId: "dev", action: "reject" },
          { targetStageId: "playtest", action: "reject" },
        ],
        validationRules: {
          requireRejectedApproachesOnReject: true,
        },
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },

  "code-review-audit": {
    id: "code-review-audit",
    name: "Code Review & Security Audit Pipeline",
    description:
      "Standard engineering flow with author implementation, peer code review, and security audit signoff.",
    version: "1.0.0",
    tags: ["engineering", "code-review", "security", "audit"],
    recommendedRoles: ["developer", "reviewer", "security-auditor"],
    defaultRejectionPolicy: "rollback_to_stage",
    defaultMaxRejections: 3,
    stages: [
      {
        id: "dev",
        name: "Implementation",
        role: "developer",
        description: "Author code, write automated tests, and ensure CI passes.",
        allowedTransitions: [
          { targetStageId: "review", action: "advance" },
        ],
        validationRules: {
          requireStructuredHandoff: true,
        },
      },
      {
        id: "review",
        name: "Peer Code Review",
        role: "reviewer",
        description:
          "Review logic correctness, architecture consistency, test coverage, and documentation.",
        allowedTransitions: [
          { targetStageId: "audit", action: "advance" },
          { targetStageId: "dev", action: "reject" },
        ],
        validationRules: {
          requireRejectedApproachesOnReject: true,
        },
      },
      {
        id: "audit",
        name: "Security & Compliance Audit",
        role: "security-auditor",
        description:
          "Verify security boundaries, auth handling, dependency vulnerabilities, and regulatory compliance.",
        allowedTransitions: [
          { targetStageId: "dev", action: "reject" },
          { targetStageId: "review", action: "reject" },
        ],
        validationRules: {
          requireRejectedApproachesOnReject: true,
        },
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },

  "hotfix-fast-track": {
    id: "hotfix-fast-track",
    name: "Hotfix Fast Track Pipeline",
    description: "Accelerated two-stage hotfix pipeline for critical production bugs.",
    version: "1.0.0",
    tags: ["hotfix", "production", "fast-track"],
    recommendedRoles: ["developer", "release-lead"],
    defaultRejectionPolicy: "restart_stage",
    defaultMaxRejections: 2,
    stages: [
      {
        id: "fix",
        name: "Hotfix Implementation",
        role: "developer",
        description: "Apply emergency bug fix, verify reproduction steps, and run targeted tests.",
        allowedTransitions: [
          { targetStageId: "verify-deploy", action: "advance" },
        ],
        validationRules: {
          requireStructuredHandoff: true,
        },
      },
      {
        id: "verify-deploy",
        name: "Verification & Deployment",
        role: "release-lead",
        description:
          "Smoke test fix in staging, approve hotfix release, and monitor production deployment.",
        allowedTransitions: [
          { targetStageId: "fix", action: "reject" },
        ],
        validationRules: {
          requireRejectedApproachesOnReject: true,
        },
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },

  "research-spec-impl": {
    id: "research-spec-impl",
    name: "Research, Spec & Implementation Pipeline",
    description:
      "Exploratory research through technical specification to production implementation.",
    version: "1.0.0",
    tags: ["research", "spec", "architecture", "implementation"],
    recommendedRoles: ["researcher", "architect", "developer"],
    defaultRejectionPolicy: "rollback_to_stage",
    defaultMaxRejections: 3,
    stages: [
      {
        id: "research",
        name: "Domain Research & Exploration",
        role: "researcher",
        description:
          "Investigate problem domain, explore benchmarks, prototype solutions, and summarize findings.",
        allowedTransitions: [
          { targetStageId: "spec", action: "advance" },
        ],
        validationRules: {
          requireStructuredHandoff: true,
        },
      },
      {
        id: "spec",
        name: "Technical Specification",
        role: "architect",
        description:
          "Draft architecture design, schema contracts, API specifications, and test plan.",
        allowedTransitions: [
          { targetStageId: "impl", action: "advance" },
          { targetStageId: "research", action: "reject" },
        ],
        validationRules: {
          requireRejectedApproachesOnReject: true,
        },
      },
      {
        id: "impl",
        name: "Production Implementation",
        role: "developer",
        description:
          "Implement spec, build unit and integration test suite, and verify against criteria.",
        allowedTransitions: [
          { targetStageId: "spec", action: "reject" },
        ],
        validationRules: {
          requireRejectedApproachesOnReject: true,
        },
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
};

/**
 * Creates an instantiated TaskPipeline from a FlowTemplate definition.
 */
export function instantiatePipelineFromTemplate(
  template: FlowTemplate,
  customConfig?: {
    strictMode?: boolean;
    rejectionLoopPolicy?: RejectionPolicy;
    maxRejectionCycles?: number;
  },
): TaskPipeline {
  const now = new Date().toISOString();
  const stages: TaskPipelineStage[] = template.stages.map((st, idx) => ({
    ...st,
    status: idx === 0 ? "active" : "pending",
    startedAt: idx === 0 ? now : undefined,
    completedAt: undefined,
    assignee: undefined,
  }));

  return {
    templateId: template.id,
    templateVersion: template.version,
    strictMode: customConfig?.strictMode ?? true,
    currentStageId: stages[0]?.id ?? "",
    currentStageIndex: 0,
    stages,
    rejectionLoopPolicy: customConfig?.rejectionLoopPolicy ?? template.defaultRejectionPolicy,
    maxRejectionCycles: customConfig?.maxRejectionCycles ?? template.defaultMaxRejections,
    rejectionCount: 0,
    history: [],
  };
}

/**
 * Retrieves a FlowTemplate by ID. Checks user-custom templates in KV first, falling back to default templates.
 */
export async function getFlowTemplate(
  templateId: string,
  userId?: string,
): Promise<FlowTemplate | null> {
  const id = templateId?.trim();
  if (!id) return null;

  const uid = resolveUserId(userId);
  const kv = await getKv();

  const entry = await kv.get<FlowTemplate>(["users", uid, "flow_templates", id]);
  if (entry.value) {
    return entry.value;
  }

  return DEFAULT_FLOW_TEMPLATES[id] ?? null;
}

/**
 * Lists all FlowTemplates available to the user (built-in default templates merged with user-defined custom templates).
 */
export async function listFlowTemplates(userId?: string): Promise<FlowTemplate[]> {
  const uid = resolveUserId(userId);
  const kv = await getKv();

  const templatesMap = new Map<string, FlowTemplate>();

  // 1. Seed with default templates
  for (const [id, tpl] of Object.entries(DEFAULT_FLOW_TEMPLATES)) {
    templatesMap.set(id, tpl);
  }

  // 2. Overlay user custom templates
  for await (
    const entry of kv.list<FlowTemplate>({ prefix: ["users", uid, "flow_templates"] })
  ) {
    if (entry.value) {
      templatesMap.set(entry.value.id, entry.value);
    }
  }

  return Array.from(templatesMap.values());
}

/**
 * Persists a new user custom FlowTemplate.
 */
export async function createFlowTemplate(
  templateInput: Omit<FlowTemplate, "createdAt" | "updatedAt"> & {
    createdAt?: string;
    updatedAt?: string;
  },
  userId?: string,
): Promise<FlowTemplate> {
  const id = templateInput.id?.trim();
  if (!id) {
    throw new Error("Template ID cannot be empty");
  }
  const name = templateInput.name?.trim();
  if (!name) {
    throw new Error("Template name cannot be empty");
  }
  if (!templateInput.stages || templateInput.stages.length === 0) {
    throw new Error("Template must define at least one stage");
  }

  const uid = resolveUserId(userId);
  const kv = await getKv();

  const now = new Date().toISOString();
  const template: FlowTemplate = {
    ...templateInput,
    id,
    name,
    description: templateInput.description ?? "",
    version: templateInput.version ?? "1.0.0",
    tags: templateInput.tags ?? [],
    recommendedRoles: templateInput.recommendedRoles ?? [],
    defaultRejectionPolicy: templateInput.defaultRejectionPolicy ?? "rollback_to_stage",
    defaultMaxRejections: templateInput.defaultMaxRejections ?? 3,
    stages: templateInput.stages,
    createdAt: templateInput.createdAt || now,
    updatedAt: templateInput.updatedAt || now,
  };

  await kv.set(["users", uid, "flow_templates", id], template);
  return template;
}

/**
 * Updates an existing user custom FlowTemplate.
 */
export async function updateFlowTemplate(
  templateId: string,
  updates: Partial<FlowTemplate>,
  userId?: string,
): Promise<FlowTemplate> {
  const id = templateId.trim();
  const existing = await getFlowTemplate(id, userId);
  if (!existing) {
    throw new Error(`Flow template not found: ${templateId}`);
  }

  const uid = resolveUserId(userId);
  const kv = await getKv();

  const now = new Date().toISOString();
  const updated: FlowTemplate = {
    ...existing,
    ...updates,
    id,
    updatedAt: now,
  };

  await kv.set(["users", uid, "flow_templates", id], updated);
  return updated;
}

/**
 * Deletes a user custom FlowTemplate.
 */
export async function deleteFlowTemplate(templateId: string, userId?: string): Promise<void> {
  const uid = resolveUserId(userId);
  const kv = await getKv();
  await kv.delete(["users", uid, "flow_templates", templateId.trim()]);
}
