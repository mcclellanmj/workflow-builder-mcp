import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { createTask, setKv } from "../../store/kv.ts";
import { pipelineTemplateCreateTool } from "./pipeline_template_create.ts";
import { pipelineTemplateListTool } from "./pipeline_template_list.ts";
import { pipelineTemplateGetTool } from "./pipeline_template_get.ts";
import { taskPipelineAttachTool } from "./task_pipeline_attach.ts";
import { taskPipelineOverrideTool } from "./task_pipeline_override.ts";
import { taskPipelineStatusTool } from "./task_pipeline_status.ts";

const parseJsonContent = (res: {
  content: Array<{ type: string; text: string; annotations?: { audience?: string[] } }>;
}) => {
  const jsonItem = res.content.find((c) => c.annotations?.audience?.includes("assistant")) ??
    res.content.find((c) => c.type === "text" && c.text.startsWith("{")) ??
    res.content[0];
  return JSON.parse(jsonItem.text);
};

Deno.test("Pipeline MCP Tools - FlowTemplate CRUD (create, list, get)", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    // 1. Create a custom template
    const createRes = await pipelineTemplateCreateTool.execute({
      id: "game-asset-pipeline",
      name: "3D Asset Production Pipeline",
      description: "Concept -> Model -> Texture -> Rig -> Unity Integration",
      version: "1.0.0",
      tags: ["art", "3d", "gamedev"],
      recommendedRoles: ["concept-artist", "3d-artist", "tech-artist"],
      defaultRejectionPolicy: "rollback_to_stage",
      defaultMaxRejections: 3,
      stages: [
        {
          id: "concept",
          name: "Concept Art",
          role: "concept-artist",
          allowedTransitions: [
            { targetStageId: "model", action: "advance" },
          ],
        },
        {
          id: "model",
          name: "3D Modeling",
          role: "3d-artist",
          allowedTransitions: [
            { targetStageId: "texture", action: "advance" },
            { targetStageId: "concept", action: "reject" },
          ],
        },
        {
          id: "texture",
          name: "Texturing & Shading",
          role: "3d-artist",
          allowedTransitions: [
            { targetStageId: "rig", action: "advance" },
            { targetStageId: "model", action: "reject" },
          ],
        },
        {
          id: "rig",
          name: "Rigging & Integration",
          role: "tech-artist",
          allowedTransitions: [
            { targetStageId: "texture", action: "reject" },
          ],
        },
      ],
    });

    assert(!createRes.isError);
    const createdData = parseJsonContent(createRes);
    assertEquals(createdData.template.id, "game-asset-pipeline");
    assertEquals(createdData.template.stages.length, 4);

    // 2. List templates (default built-in + created)
    const listRes = await pipelineTemplateListTool.execute({ format: "json" });
    assert(!listRes.isError);
    const listData = parseJsonContent(listRes);
    assert(listData.count >= 5);
    const templateIds = listData.templates.map((t: { id: string }) => t.id);
    assert(templateIds.includes("game-asset-pipeline"));
    assert(templateIds.includes("unity-dev-playtest-qa"));

    // 3. List templates with tag filter
    const tagFilteredRes = await pipelineTemplateListTool.execute({ tag: "art", format: "json" });
    const tagFilteredData = parseJsonContent(tagFilteredRes);
    assertEquals(tagFilteredData.count, 1);
    assertEquals(tagFilteredData.templates[0].id, "game-asset-pipeline");

    // 4. List templates with role filter
    const roleFilteredRes = await pipelineTemplateListTool.execute({
      role: "tech-artist",
      format: "json",
    });
    const roleFilteredData = parseJsonContent(roleFilteredRes);
    assertEquals(roleFilteredData.count, 1);
    assertEquals(roleFilteredData.templates[0].id, "game-asset-pipeline");

    // 5. Get template by ID
    const getRes = await pipelineTemplateGetTool.execute({ templateId: "game-asset-pipeline" });
    assert(!getRes.isError);
    const getData = parseJsonContent(getRes);
    assertEquals(getData.template.id, "game-asset-pipeline");
    assertEquals(getData.template.name, "3D Asset Production Pipeline");

    // 6. Get built-in template
    const getBuiltIn = await pipelineTemplateGetTool.execute({ id: "unity-dev-playtest-qa" });
    assert(!getBuiltIn.isError);
    const builtInData = parseJsonContent(getBuiltIn);
    assertEquals(builtInData.template.id, "unity-dev-playtest-qa");
  } finally {
    kv.close();
  }
});

Deno.test("Pipeline MCP Tools - task_pipeline_attach and task_pipeline_status", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    // 1. Create unpipelined task
    const task = await createTask({
      title: "Build Character Model",
      description: "Main hero character model and textures",
    });

    // Check status before attaching pipeline
    const preStatusRes = await taskPipelineStatusTool.execute({ task: task.id, format: "json" });
    assert(!preStatusRes.isError);
    const preStatus = parseJsonContent(preStatusRes);
    assertEquals(preStatus.isPipelined, false);
    assertEquals(preStatus.pipeline, null);

    // 2. Attach built-in template
    const attachRes = await taskPipelineAttachTool.execute({
      task: task.id,
      templateId: "unity-dev-playtest-qa",
      justification: "Standard gameplay pipeline attached",
    });
    assert(!attachRes.isError);
    const attachData = parseJsonContent(attachRes);
    assertEquals(attachData.task.pipeline.templateId, "unity-dev-playtest-qa");
    assertEquals(attachData.task.pipeline.currentStageId, "dev");
    assertEquals(attachData.task.role, "developer");

    // 3. Inspect status after attaching
    const postStatusRes = await taskPipelineStatusTool.execute({ task: task.id, format: "both" });
    assert(!postStatusRes.isError);
    const postStatus = parseJsonContent(postStatusRes);
    assertEquals(postStatus.isPipelined, true);
    assertEquals(postStatus.pipeline.templateId, "unity-dev-playtest-qa");
    assertEquals(postStatus.pipeline.currentStageIndex, 0);
    assertEquals(postStatus.pipeline.currentStageId, "dev");
    assertEquals(postStatus.pipeline.totalStages, 3);
    assertEquals(postStatus.pipeline.completedStages, 0);
    assertEquals(postStatus.pipeline.progressPercent, 0);

    // Verify markdown rendering contains table and badges
    const mdText = postStatusRes.content.find((c) =>
      c.type === "text" && c.text.includes("## 🔄 Pipeline Status")
    )?.text;
    assert(mdText !== undefined);
    assertStringIncludes(mdText, "Build Character Model");
    assertStringIncludes(mdText, "unity-dev-playtest-qa");
    assertStringIncludes(mdText, "Unity Development");
  } finally {
    kv.close();
  }
});

Deno.test("Pipeline MCP Tools - task_pipeline_override interventions", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    // 1. Create pipelined task
    const task = await createTask({
      title: "Fast Track Feature",
      pipelineTemplateId: "unity-dev-playtest-qa",
    });

    assertEquals(task.pipeline?.currentStageIndex, 0);
    assertEquals(task.role, "developer");

    // 2. Override: skip stage (dev -> playtest)
    const skipRes = await taskPipelineOverrideTool.execute({
      task: task.id,
      action: "skip_stage",
      justification: "Dev stage completed offline, skipping directly to playtest",
      managerId: "lead-dev",
    });
    assert(!skipRes.isError);
    const skipData = parseJsonContent(skipRes);
    assertEquals(skipData.task.pipeline.currentStageIndex, 1);
    assertEquals(skipData.task.pipeline.currentStageId, "playtest");
    assertEquals(skipData.task.role, "playtester");
    assertEquals(skipData.task.pipeline.stages[0].status, "skipped");
    assertEquals(skipData.task.pipeline.stages[1].status, "active");

    // 3. Override: dynamically insert a stage (e.g. security-audit)
    const insertRes = await taskPipelineOverrideTool.execute({
      task: task.id,
      action: "insert_stage",
      insertStage: {
        id: "perf-benchmarking",
        name: "Performance Benchmarking",
        role: "performance-engineer",
        description: "Benchmark framerate on mobile target devices",
        position: "after_current",
      },
      justification: "Mobile performance requirement added mid-flight",
      managerId: "tech-director",
    });
    assert(!insertRes.isError);
    const insertData = parseJsonContent(insertRes);
    assertEquals(insertData.task.pipeline.stages.length, 4);
    const insertedStage = insertData.task.pipeline.stages[2];
    assertEquals(insertedStage.id, "perf-benchmarking");
    assertEquals(insertedStage.role, "performance-engineer");

    // 4. Override: reset rejections
    const resetRes = await taskPipelineOverrideTool.execute({
      task: task.id,
      action: "reset_rejections",
      justification: "Resetting rejection counter following architecture re-alignment",
    });
    assert(!resetRes.isError);
    const resetData = parseJsonContent(resetRes);
    assertEquals(resetData.task.pipeline.rejectionCount, 0);

    // 5. Override: force advance to inserted stage
    const forceAdvanceRes = await taskPipelineOverrideTool.execute({
      task: task.id,
      action: "force_advance",
      targetStageId: "perf-benchmarking",
      justification: "Playtest passed, advancing to perf benchmarking",
    });
    assert(!forceAdvanceRes.isError);
    const forceData = parseJsonContent(forceAdvanceRes);
    assertEquals(forceData.task.pipeline.currentStageId, "perf-benchmarking");
    assertEquals(forceData.task.role, "performance-engineer");
  } finally {
    kv.close();
  }
});
