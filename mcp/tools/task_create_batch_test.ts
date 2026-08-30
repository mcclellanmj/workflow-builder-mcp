import { assert, assertEquals, assertMatch } from "@std/assert";
import { getDependencies, getTask, setKv } from "../../store/kv.ts";
import type { ToolCallResponse } from "../registry.ts";
import { createWorkflowTool } from "./create_workflow.ts";
import { taskCreateBatchTool } from "./task_create_batch.ts";

const parseToolResponse = (res: ToolCallResponse) => {
  if (res.isError) {
    const errorText = res.content.map((c) => c.text).join("; ");
    throw new Error(`Tool returned error: ${errorText}`);
  }
  const item = res.content.find((c) => c.annotations?.audience?.includes("assistant")) ??
    res.content[res.content.length - 1];
  return JSON.parse(item.text);
};

Deno.test("Task Create Batch - 3-Phase Pipeline (Artist -> Scene Architect -> QA) in Single Call", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    // 1. Create a workflow to link the pipeline to
    const wfRes = await createWorkflowTool.execute({
      name: "3D Asset Production Pipeline",
      description: "Pipeline for 3D modeling, scene assembly, and QA inspection",
    });
    assert(!wfRes.isError);
    const wfData = parseToolResponse(wfRes);
    const workflowId = wfData.workflow.id;

    // 2. Create the 3-phase pipeline in a single batch call using tempId references
    const batchRes = await taskCreateBatchTool.execute({
      workflow: workflowId,
      executionId: "exec-asset-001",
      tasks: [
        {
          tempId: "artist",
          title: "Generate 3D Model Assets",
          description: "Create low-poly mesh and PBR textures in Blender",
          role: "3d-artist",
          priority: "high",
          inputs: { assetType: "prop", polyBudget: 5000 },
          metadata: { software: "Blender" },
        },
        {
          tempId: "architect",
          title: "Assemble Unity Scene Layout",
          description: "Place models, setup lighting and colliders in scene",
          role: "scene-architect",
          priority: "medium",
          inputs: { sceneName: "MainHall" },
        },
        {
          tempId: "qa",
          title: "QA Visual & Performance Inspection",
          description: "Verify draw calls, LODs, and visual fidelity",
          role: "qa-engineer",
          priority: "critical",
          inputs: { targetFps: 60 },
        },
      ],
      dependencies: [
        {
          fromTask: "artist",
          toTask: "architect",
          type: "blocks",
        },
        {
          fromTask: "architect",
          toTask: "qa",
          type: "blocks",
        },
      ],
      format: "json",
    });

    assert(!batchRes.isError, "Batch creation should succeed");
    const result = parseToolResponse(batchRes);

    assertEquals(result.tasks.length, 3);
    assertEquals(result.dependencies.length, 2);
    assertEquals(result.summary.totalCreated, 3);
    assertEquals(result.summary.dependenciesCreated, 2);

    const [artistTask, architectTask, qaTask] = result.tasks;

    assertMatch(artistTask.id, /^tk-[0-9a-f]{6}/);
    assertMatch(architectTask.id, /^tk-[0-9a-f]{6}/);
    assertMatch(qaTask.id, /^tk-[0-9a-f]{6}/);

    assertEquals(artistTask.title, "Generate 3D Model Assets");
    assertEquals(artistTask.role, "3d-artist");
    assertEquals(artistTask.priority, "high");
    assertEquals(artistTask.workflowId, workflowId);
    assertEquals(artistTask.executionId, "exec-asset-001");
    assertEquals(artistTask.status, "open"); // 1st stage is open

    assertEquals(architectTask.title, "Assemble Unity Scene Layout");
    assertEquals(architectTask.role, "scene-architect");
    assertEquals(architectTask.priority, "medium");
    assertEquals(architectTask.status, "blocked"); // Blocked by artist

    assertEquals(qaTask.title, "QA Visual & Performance Inspection");
    assertEquals(qaTask.role, "qa-engineer");
    assertEquals(qaTask.priority, "critical");
    assertEquals(qaTask.status, "blocked"); // Blocked by architect

    // Verify tasks are persisted in Deno KV
    const storedArtist = await getTask(artistTask.id);
    const storedArchitect = await getTask(architectTask.id);
    const storedQa = await getTask(qaTask.id);

    assert(storedArtist !== null);
    assert(storedArchitect !== null);
    assert(storedQa !== null);

    assertEquals(storedArtist?.inputs, { assetType: "prop", polyBudget: 5000 });
    assertEquals(storedArtist?.metadata, { software: "Blender" });

    // Verify dependencies in Deno KV
    const artistOutbound = await getDependencies(artistTask.id, "blocking");
    assertEquals(artistOutbound.length, 1);
    assertEquals(artistOutbound[0].toTaskId, architectTask.id);
    assertEquals(artistOutbound[0].type, "blocks");

    const architectInbound = await getDependencies(architectTask.id, "blocked-by");
    assertEquals(architectInbound.length, 1);
    assertEquals(architectInbound[0].fromTaskId, artistTask.id);

    const architectOutbound = await getDependencies(architectTask.id, "blocking");
    assertEquals(architectOutbound.length, 1);
    assertEquals(architectOutbound[0].toTaskId, qaTask.id);

    const qaInbound = await getDependencies(qaTask.id, "blocked-by");
    assertEquals(qaInbound.length, 1);
    assertEquals(qaInbound[0].fromTaskId, architectTask.id);

    // Verify ready frontier calculation - only the unblocked initial task (Artist) should be ready
    assertEquals(result.readyTasks.length, 1);
    assertEquals(result.readyTasks[0].id, artistTask.id);
    assertEquals(result.readyTasks[0].title, "Generate 3D Model Assets");
    assertEquals(result.summary.readyCount, 1);
  } finally {
    kv.close();
  }
});

Deno.test("Task Create Batch - Resolution by Title, Hierarchies, and Markdown/Rich Formats", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    // 1. Test batch with title-based dependencies and parent-child hierarchy
    const batchRes = await taskCreateBatchTool.execute({
      tasks: [
        {
          tempId: "epic-root",
          title: "Authentication Overhaul",
          type: "epic",
          role: "security-lead",
        },
        {
          title: "Implement JWT Verification",
          parentTaskId: "epic-root",
          role: "backend",
        },
        {
          title: "Add Login UI Component",
          parentTaskId: "epic-root",
          role: "frontend",
        },
      ],
      dependencies: [
        {
          fromTask: "Implement JWT Verification",
          toTask: "Add Login UI Component",
          type: "blocks",
        },
      ],
      format: "rich",
    });

    assert(!batchRes.isError);
    // Rich response returns multi-content with user markdown and assistant json
    assertEquals(batchRes.content.length, 2);
    const jsonContent = batchRes.content.find((c) =>
      c.annotations?.audience?.includes("assistant")
    );
    assert(jsonContent !== null);
    const result = JSON.parse(jsonContent!.text);

    assertEquals(result.tasks.length, 3);
    const [epicTask, backendTask, frontendTask] = result.tasks;

    assertEquals(epicTask.type, "epic");
    assertEquals(backendTask.parentTaskId, epicTask.id);
    assertEquals(frontendTask.parentTaskId, epicTask.id);

    assertEquals(backendTask.status, "open");
    assertEquals(frontendTask.status, "blocked");

    // Markdown content should contain the table and ready frontier
    const userContent = batchRes.content.find((c) => c.annotations?.audience?.includes("user"));
    assert(userContent?.text.includes("### 🚀 Batch Tasks Created"));
    assert(userContent?.text.includes("### 🔗 Dependencies Established"));
    assert(userContent?.text.includes("### Ready Frontier"));
  } finally {
    kv.close();
  }
});

Deno.test("Task Create Batch - Error on Unresolved Dependency Reference", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    const errorRes = await taskCreateBatchTool.execute({
      tasks: [
        {
          title: "Standalone Task",
        },
      ],
      dependencies: [
        {
          fromTask: "non-existent-task-id",
          toTask: "Standalone Task",
        },
      ],
    });

    assertEquals(errorRes.isError, true);
    assert(
      errorRes.content[0].text.includes(
        'Prerequisite task (fromTask) "non-existent-task-id" not found',
      ),
    );
  } finally {
    kv.close();
  }
});
