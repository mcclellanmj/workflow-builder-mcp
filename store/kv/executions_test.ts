import { assert, assertEquals, assertRejects } from "@std/assert";
import { setKv } from "./client.ts";
import { saveWorkflow } from "./workflows.ts";
import { saveNodes } from "./nodes.ts";
import { saveEdges } from "./edges.ts";
import { createTask, getTask } from "./tasks.ts";
import {
  completeExecution,
  createExecution,
  getExecution,
  patchExecutionContext,
  transitionNodeState,
} from "./executions.ts";
import { listMessages } from "./messages.ts";

Deno.test("Executions - createExecution and atomic patchExecutionContext", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    const workflowId = `wf-${crypto.randomUUID().slice(0, 6)}`;
    const exec = await createExecution({
      workflowId,
      initialContext: { count: 0, items: ["initial"], config: { env: "test" } },
    });

    assertEquals(exec.status, "in_progress");
    assertEquals(exec.context.count, 0);

    // 1. Test $set and $push
    const patched = await patchExecutionContext(exec.id, {
      $set: { "config.env": "production", "nested.deep.flag": true },
      $push: { items: "second" },
      count: 1,
    });

    // deno-lint-ignore no-explicit-any
    const ctx = patched.context as any;
    assertEquals(ctx.config.env, "production");
    assertEquals(ctx.nested.deep.flag, true);
    assertEquals(ctx.items, ["initial", "second"]);
    assertEquals(ctx.count, 1);

    // 2. Test concurrent patches
    const parallelOps = Array.from({ length: 5 }, (_, i) =>
      patchExecutionContext(exec.id, {
        $push: { items: `item-${i}` },
      }));

    await Promise.all(parallelOps);

    const finalExec = await getExecution(exec.id);
    assert(finalExec !== null);
    // deno-lint-ignore no-explicit-any
    const finalItems = (finalExec.context as any).items as string[];
    assertEquals(finalItems.length, 7); // initial, second, item-0..4
  } finally {
    await kv.close();
  }
});

Deno.test("Executions - barrier joinPolicy 'all' prevents premature transition", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    const workflowId = `wf-barrier-${crypto.randomUUID().slice(0, 6)}`;
    await saveWorkflow({
      id: workflowId,
      name: "Barrier Test",
      description: "Testing barrier join",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const now = new Date().toISOString();
    await saveNodes([
      {
        id: "node-a",
        workflowId,
        name: "Node A",
        description: "Dev 1",
        type: "step",
        runInSubAgent: true,
        config: {},
        status: "pending",
        error: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "node-b",
        workflowId,
        name: "Node B",
        description: "Dev 2",
        type: "step",
        runInSubAgent: true,
        config: {},
        status: "pending",
        error: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "node-barrier",
        workflowId,
        name: "Join Barrier",
        description: "Triage / Join",
        type: "step",
        joinPolicy: "all",
        runInSubAgent: false,
        config: {},
        status: "pending",
        error: null,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    await saveEdges([
      {
        id: "edge-1",
        workflowId,
        fromNodeId: "node-a",
        toNodeId: "node-barrier",
      },
      {
        id: "edge-2",
        workflowId,
        fromNodeId: "node-b",
        toNodeId: "node-barrier",
      },
    ]);

    const exec = await createExecution({
      workflowId,
    });

    // Attempting to transition node-barrier to running should FAIL because node-a and node-b are pending
    await assertRejects(
      async () => {
        await transitionNodeState({
          executionId: exec.id,
          nodeId: "node-barrier",
          status: "running",
        });
      },
      Error,
      "Barrier policy is 'all'",
    );

    // Complete node-a only -> should still fail
    await transitionNodeState({
      executionId: exec.id,
      nodeId: "node-a",
      status: "completed",
    });

    await assertRejects(
      async () => {
        await transitionNodeState({
          executionId: exec.id,
          nodeId: "node-barrier",
          status: "running",
        });
      },
      Error,
      "Barrier policy is 'all'",
    );

    // Complete node-b -> now node-barrier can transition to running
    await transitionNodeState({
      executionId: exec.id,
      nodeId: "node-b",
      status: "completed",
    });

    const transitioned = await transitionNodeState({
      executionId: exec.id,
      nodeId: "node-barrier",
      status: "running",
    });

    assertEquals(transitioned.nodeStates["node-barrier"].status, "running");
  } finally {
    await kv.close();
  }
});

Deno.test("Executions - completeExecution bubbles status, posts message, and unblocks parent node", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    const parentWfId = `wf-parent-${crypto.randomUUID().slice(0, 6)}`;
    const subWfId = `wf-sub-${crypto.randomUUID().slice(0, 6)}`;

    // Create parent execution
    const parentExec = await createExecution({
      workflowId: parentWfId,
      nodeStates: {
        "dispatch-node": {
          nodeId: "dispatch-node",
          status: "waiting_for_children",
          error: null,
          iteration: 1,
          updatedAt: new Date().toISOString(),
        },
      },
    });

    // Create task spawned from dispatch-node
    const task = await createTask({
      title: "Implement feature in subworkflow",
      originWorkflowId: parentWfId,
      originExecutionId: parentExec.id,
      originNodeId: "dispatch-node",
      assignedWorkflowId: subWfId,
    });

    // Create subworkflow execution linked to task and parent execution
    const childExec = await createExecution({
      workflowId: subWfId,
      parentExecutionId: parentExec.id,
      originTaskId: task.id,
      originNodeId: "dispatch-node",
    });

    // Complete child execution
    await completeExecution(childExec.id, "completed", "Feature implemented successfully with tests");

    // 1. Task should now be closed
    const updatedTask = await getTask(task.id);
    assert(updatedTask !== null);
    assertEquals(updatedTask.status, "closed");
    assertEquals(updatedTask.closedReason, "Feature implemented successfully with tests");
    assert(updatedTask.comments.length > 0);

    // 2. Parent execution message board should have a child_completion message
    const messages = await listMessages(parentExec.id, { topic: "child_completion" });
    assertEquals(messages.length, 1);
    assert(messages[0].content.includes("Feature implemented successfully"));

    // 3. Parent node "dispatch-node" should have transitioned from waiting_for_children to completed!
    const updatedParentExec = await getExecution(parentExec.id);
    assert(updatedParentExec !== null);
    assertEquals(updatedParentExec.nodeStates["dispatch-node"].status, "completed");
  } finally {
    await kv.close();
  }
});
