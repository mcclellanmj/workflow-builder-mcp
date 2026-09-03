import { assert, assertEquals } from "@std/assert";
import { setKv } from "./client.ts";
import { getTask } from "./tasks.ts";
import { saveNode } from "./nodes.ts";
import { saveEdge } from "./edges.ts";
import { saveWorkflow } from "./workflows.ts";
import { hydrateWorkflowToEpic } from "./hydration.ts";

Deno.test("Hydration - Nodes with config.pipelineTemplateId attach pipelines and resolve initial stage role", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    const userId = "user_pipeline_hydration";
    const now = new Date().toISOString();

    // 1. Create a workflow
    const wfId = "wf-pipeline-test";
    await saveWorkflow({
      id: wfId,
      name: "Feature Delivery Workflow",
      description: "Workflow with nodes pre-configured with pipelines",
      createdAt: now,
      updatedAt: now,
    }, userId);

    // 2. Add nodes: Start -> DevNode (with unity-dev-playtest-qa pipeline) -> HotfixNode (with hotfix-fast-track) -> End
    await saveNode({
      id: "node-start",
      workflowId: wfId,
      type: "start",
      name: "Start",
      description: "Start node",
      runInSubAgent: false,
      status: "pending",
      error: null,
      config: {},
      createdAt: now,
      updatedAt: now,
    }, userId);

    await saveNode({
      id: "node-dev",
      workflowId: wfId,
      type: "step",
      name: "Build Inventory UI",
      description: "Implement the inventory UI in Unity",
      runInSubAgent: false,
      status: "pending",
      error: null,
      config: {
        pipelineTemplateId: "unity-dev-playtest-qa",
      },
      createdAt: now,
      updatedAt: now,
    }, userId);

    await saveNode({
      id: "node-hotfix",
      workflowId: wfId,
      type: "step",
      name: "Critical Glitch Fix",
      description: "Address emergency inventory corruption bug",
      runInSubAgent: false,
      status: "pending",
      error: null,
      config: {
        pipelineTemplateId: "hotfix-fast-track",
        role: "senior-engineer", // Explicit role override
      },
      createdAt: now,
      updatedAt: now,
    }, userId);

    await saveNode({
      id: "node-end",
      workflowId: wfId,
      type: "end",
      name: "End",
      description: "End node",
      runInSubAgent: false,
      status: "pending",
      error: null,
      config: {},
      createdAt: now,
      updatedAt: now,
    }, userId);

    // 3. Connect nodes
    await saveEdge({
      id: "edge-1",
      workflowId: wfId,
      fromNodeId: "node-start",
      toNodeId: "node-dev",
    }, userId);

    await saveEdge({
      id: "edge-2",
      workflowId: wfId,
      fromNodeId: "node-dev",
      toNodeId: "node-hotfix",
    }, userId);

    await saveEdge({
      id: "edge-3",
      workflowId: wfId,
      fromNodeId: "node-hotfix",
      toNodeId: "node-end",
    }, userId);

    // 4. Hydrate workflow to Epic
    const result = await hydrateWorkflowToEpic({
      workflow: wfId,
      userId,
    });

    assertEquals(result.summary.totalTasks, 2);
    assertEquals(result.summary.totalEpics, 1);

    const devTask = result.tasks.find((t) => t.title === "Build Inventory UI");
    const hotfixTask = result.tasks.find((t) => t.title === "Critical Glitch Fix");

    assert(devTask !== undefined);
    assert(hotfixTask !== undefined);

    // Verify devTask pipeline and auto-resolved initial stage role ("developer")
    assertEquals(devTask?.role, "developer");
    assert(devTask?.pipeline !== undefined);
    assertEquals(devTask?.pipeline?.templateId, "unity-dev-playtest-qa");
    assertEquals(devTask?.pipeline?.currentStageId, "dev");
    assertEquals(devTask?.pipeline?.stages.length, 3);

    // Verify hotfixTask pipeline and preserved custom role ("senior-engineer")
    assertEquals(hotfixTask?.role, "senior-engineer");
    assert(hotfixTask?.pipeline !== undefined);
    assertEquals(hotfixTask?.pipeline?.templateId, "hotfix-fast-track");
    assertEquals(hotfixTask?.pipeline?.currentStageId, "fix");

    // Verify in KV store
    const storedDev = await getTask(devTask.id, userId);
    const storedHotfix = await getTask(hotfixTask.id, userId);

    assert(storedDev?.pipeline !== undefined);
    assertEquals(storedDev?.pipeline?.templateId, "unity-dev-playtest-qa");
    assertEquals(storedDev?.role, "developer");

    assert(storedHotfix?.pipeline !== undefined);
    assertEquals(storedHotfix?.pipeline?.templateId, "hotfix-fast-track");
    assertEquals(storedHotfix?.role, "senior-engineer");
  } finally {
    kv.close();
  }
});
