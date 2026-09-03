import { assert, assertEquals, assertRejects } from "@std/assert";
import { setKv } from "./client.ts";
import {
  createFlowTemplate,
  DEFAULT_FLOW_TEMPLATES,
  deleteFlowTemplate,
  getFlowTemplate,
  instantiatePipelineFromTemplate,
  listFlowTemplates,
  updateFlowTemplate,
} from "./pipeline_templates.ts";

Deno.test("FlowTemplate - Built-in default templates registry", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);
  try {
    const templates = await listFlowTemplates();
    assert(templates.length >= 4);

    const defaultIds = [
      "unity-dev-playtest-qa",
      "code-review-audit",
      "hotfix-fast-track",
      "research-spec-impl",
    ];

    for (const id of defaultIds) {
      const tpl = await getFlowTemplate(id);
      assert(tpl !== null, `Default template ${id} should exist`);
      assertEquals(tpl.id, id);
      assert(tpl.stages.length >= 2, `${id} should have at least 2 stages`);
    }
  } finally {
    await kv.close();
  }
});

Deno.test("FlowTemplate - User custom template CRUD", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);
  try {
    const userId = `tenant_${crypto.randomUUID().slice(0, 8)}`;
    const templateId = "custom-etl-pipeline";

    const created = await createFlowTemplate({
      id: templateId,
      name: "Custom ETL Pipeline",
      description: "Extract, Transform, Load pipeline",
      version: "1.0.0",
      tags: ["etl", "data"],
      recommendedRoles: ["data-engineer", "qa"],
      defaultRejectionPolicy: "rollback_to_stage",
      defaultMaxRejections: 3,
      stages: [
        {
          id: "extract",
          name: "Data Extraction",
          role: "data-engineer",
          allowedTransitions: [{ targetStageId: "transform", action: "advance" }],
        },
        {
          id: "transform",
          name: "Data Transformation",
          role: "data-engineer",
          allowedTransitions: [
            { targetStageId: "load", action: "advance" },
            { targetStageId: "extract", action: "reject" },
          ],
        },
        {
          id: "load",
          name: "Data Loading",
          role: "qa",
          allowedTransitions: [
            { targetStageId: "transform", action: "reject" },
          ],
        },
      ],
    }, userId);

    assertEquals(created.id, templateId);
    assertEquals(created.name, "Custom ETL Pipeline");

    // Retrieve
    const fetched = await getFlowTemplate(templateId, userId);
    assert(fetched !== null);
    assertEquals(fetched.name, "Custom ETL Pipeline");
    assertEquals(fetched.stages.length, 3);

    // Update
    const updated = await updateFlowTemplate(
      templateId,
      { description: "Updated ETL description" },
      userId,
    );
    assertEquals(updated.description, "Updated ETL description");

    // Delete
    await deleteFlowTemplate(templateId, userId);
    const afterDelete = await getFlowTemplate(templateId, userId);
    assertEquals(afterDelete, null);
  } finally {
    await kv.close();
  }
});

Deno.test("FlowTemplate - Validation errors", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);
  try {
    const userId = `tenant_${crypto.randomUUID().slice(0, 8)}`;

    await assertRejects(
      () =>
        createFlowTemplate(
          { id: "", name: "Test", stages: [] } as unknown as Parameters<
            typeof createFlowTemplate
          >[0],
          userId,
        ),
      Error,
      "Template ID cannot be empty",
    );

    await assertRejects(
      () =>
        createFlowTemplate(
          { id: "valid-id", name: "", stages: [] } as unknown as Parameters<
            typeof createFlowTemplate
          >[0],
          userId,
        ),
      Error,
      "Template name cannot be empty",
    );

    await assertRejects(
      () =>
        createFlowTemplate(
          { id: "valid-id", name: "Valid", stages: [] } as unknown as Parameters<
            typeof createFlowTemplate
          >[0],
          userId,
        ),
      Error,
      "Template must define at least one stage",
    );
  } finally {
    await kv.close();
  }
});

Deno.test("FlowTemplate - instantiatePipelineFromTemplate initializes stage state", () => {
  const tpl = DEFAULT_FLOW_TEMPLATES["code-review-audit"];
  const pipeline = instantiatePipelineFromTemplate(tpl);

  assertEquals(pipeline.templateId, "code-review-audit");
  assertEquals(pipeline.currentStageIndex, 0);
  assertEquals(pipeline.currentStageId, "dev");
  assertEquals(pipeline.rejectionCount, 0);
  assertEquals(pipeline.stages.length, 3);
  assertEquals(pipeline.stages[0].status, "active");
  assert(pipeline.stages[0].startedAt !== undefined);
  assertEquals(pipeline.stages[1].status, "pending");
  assertEquals(pipeline.stages[2].status, "pending");
});
