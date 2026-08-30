import { assert, assertEquals } from "@std/assert";
import { deleteWorkflow, saveWorkflow, setKv } from "./kv.ts";
import { invalidateWorkflowCache, resolveNode, resolveWorkflow, toSlug } from "./resolvers.ts";
import type { Workflow, WorkflowNode } from "./types.ts";

Deno.test("Store Resolvers - Workflow List caching and invalidation", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    invalidateWorkflowCache();

    const wf1: Workflow = {
      id: "wf-1",
      name: "Alpha Pipeline",
      description: "First pipeline",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await saveWorkflow(wf1, "user-1");

    // 1. First resolution should load and cache
    const resolvedFirst = await resolveWorkflow("alpha-pipeline", "user-1");
    assert(resolvedFirst !== null);
    assertEquals(resolvedFirst.id, "wf-1");

    // 2. Add second workflow directly to KV without triggering saveWorkflow invalidation to test caching
    const wf2: Workflow = {
      id: "wf-2",
      name: "Beta Pipeline",
      description: "Second pipeline",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await kv.set(["users", "user-1", "workflows", wf2.id], wf2);

    // Resolving wf2 by slug fails because workflow list was cached before wf2 was added
    const resolvedCachedMiss = await resolveWorkflow("beta-pipeline", "user-1");
    assertEquals(resolvedCachedMiss, null);

    // Direct ID lookup still succeeds via direct KV lookup
    const resolvedDirectId = await resolveWorkflow("wf-2", "user-1");
    assert(resolvedDirectId !== null);
    assertEquals(resolvedDirectId.id, "wf-2");

    // 3. Invalidate cache for user-1
    invalidateWorkflowCache("user-1");

    // Now resolving wf2 by slug succeeds because cache was refreshed
    const resolvedAfterInvalidate = await resolveWorkflow("beta-pipeline", "user-1");
    assert(resolvedAfterInvalidate !== null);
    assertEquals(resolvedAfterInvalidate.id, "wf-2");

    // 4. Test saveWorkflow auto-invalidates cache
    const wf3: Workflow = {
      id: "wf-3",
      name: "Gamma Pipeline",
      description: "Third pipeline",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await saveWorkflow(wf3, "user-1");

    const resolvedGamma = await resolveWorkflow("gamma-pipeline", "user-1");
    assert(resolvedGamma !== null);
    assertEquals(resolvedGamma.id, "wf-3");

    // 5. Test deleteWorkflow auto-invalidates cache
    await deleteWorkflow("wf-3", "user-1");
    const resolvedDeletedGamma = await resolveWorkflow("gamma-pipeline", "user-1");
    assertEquals(resolvedDeletedGamma, null);

    // 6. User tenant isolation in cache
    const wfUser2: Workflow = {
      id: "wf-user2",
      name: "Tenant 2 Workflow",
      description: "User 2 workflow",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await saveWorkflow(wfUser2, "user-2");

    const resolvedUser2 = await resolveWorkflow("tenant-2-workflow", "user-2");
    assert(resolvedUser2 !== null);
    assertEquals(resolvedUser2.id, "wf-user2");

    // User-1 cannot resolve User-2's workflow
    const resolvedCrossUser = await resolveWorkflow("tenant-2-workflow", "user-1");
    assertEquals(resolvedCrossUser, null);
  } finally {
    invalidateWorkflowCache();
    kv.close();
  }
});

Deno.test("Store Resolvers - slug and node resolution", () => {
  assertEquals(toSlug("Review Workflow / Security"), "review-workflow-security");
  assertEquals(toSlug("Step 5-web"), "step-5-web");
  assertEquals(toSlug("  'Special' \"Quotes\" & Symbols!  "), "special-quotes-symbols");

  const nodes: WorkflowNode[] = [
    {
      id: "node-1",
      workflowId: "wf-1",
      name: "Start Node",
      type: "start",
      description: "",
      runInSubAgent: false,
      config: {},
      status: "pending",
      error: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: "node-2",
      workflowId: "wf-1",
      name: "Process Data",
      type: "step",
      description: "Process the data",
      runInSubAgent: false,
      config: {},
      status: "pending",
      error: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];

  assertEquals(resolveNode("node-1", nodes)?.id, "node-1");
  assertEquals(resolveNode("process-data", nodes)?.id, "node-2");
  assertEquals(resolveNode("non-existent", nodes), null);
});
