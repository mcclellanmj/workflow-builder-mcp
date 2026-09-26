import { assertEquals } from "@std/assert";
import { setKv } from "./client.ts";
import { createExecution } from "./executions.ts";
import { listMessages, postMessage } from "./messages.ts";

Deno.test("Execution Messages - post and filter messages", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    const parentExecId = `exec-parent-${crypto.randomUUID().slice(0, 6)}`;
    const childExecId = `exec-child-${crypto.randomUUID().slice(0, 6)}`;
    const workflowId = "wf-main";

    // Create executions
    await createExecution({
      id: parentExecId,
      workflowId,
    });

    await createExecution({
      id: childExecId,
      workflowId: "wf-sub",
      parentExecutionId: parentExecId,
    });

    // Post messages to parent
    await postMessage({
      id: "msg-1",
      executionId: parentExecId,
      workflowId,
      author: "architect",
      role: "architect",
      topic: "architecture",
      content: "Designed system interfaces",
      createdAt: "2026-09-25T10:00:00.000Z",
    });

    await postMessage({
      id: "msg-2",
      executionId: parentExecId,
      workflowId,
      author: "dev-lead",
      role: "developer",
      topic: "status",
      content: "Starting fan-out tasks",
      createdAt: "2026-09-25T10:05:00.000Z",
    });

    // Post message to child execution
    await postMessage({
      id: "msg-3",
      executionId: childExecId,
      workflowId: "wf-sub",
      taskId: "tk-sub1",
      author: "sub-dev",
      role: "developer",
      topic: "review_feedback",
      content: "Subtask 1 PR ready for review",
      createdAt: "2026-09-25T10:03:00.000Z",
    });

    // 1. List parent messages without subworkflows
    const parentOnly = await listMessages(parentExecId);
    assertEquals(parentOnly.length, 2);
    assertEquals(parentOnly[0].id, "msg-1");
    assertEquals(parentOnly[1].id, "msg-2");

    // 2. Filter by role
    const devMessages = await listMessages(parentExecId, { role: "developer" });
    assertEquals(devMessages.length, 1);
    assertEquals(devMessages[0].id, "msg-2");

    // 3. List with includeSubworkflows: true (should merge chronologically msg-1, msg-3, msg-2)
    const allMerged = await listMessages(parentExecId, { includeSubworkflows: true });
    assertEquals(allMerged.length, 3);
    assertEquals(allMerged[0].id, "msg-1");
    assertEquals(allMerged[1].id, "msg-3");
    assertEquals(allMerged[2].id, "msg-2");

    // 4. Filter by taskId across subworkflows
    const taskFiltered = await listMessages(parentExecId, {
      includeSubworkflows: true,
      taskId: "tk-sub1",
    });
    assertEquals(taskFiltered.length, 1);
    assertEquals(taskFiltered[0].id, "msg-3");
  } finally {
    await kv.close();
  }
});
