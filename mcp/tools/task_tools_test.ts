import { assert, assertEquals, assertMatch } from "@std/assert";
import { setKv } from "../../store/kv.ts";
import type { ToolCallResponse } from "../registry.ts";
import { createWorkflowTool } from "./create_workflow.ts";
import { createTaskTool } from "./task_create.ts";
import { listTasksTool } from "./task_list.ts";
import { getTaskTool } from "./task_get.ts";
import { updateTaskTool } from "./task_update.ts";
import { closeTaskTool } from "./task_close.ts";
import { readyTasksTool } from "./task_ready.ts";
import { claimTaskTool } from "./task_claim.ts";
import { dependTaskTool } from "./task_depend.ts";
import { commentTaskTool } from "./task_comment.ts";

const parseToolResponse = (res: ToolCallResponse) => {
  if (res.isError) {
    const errorText = res.content.map((c) => c.text).join("; ");
    throw new Error(`Tool returned error: ${errorText}`);
  }
  const item = res.content.find((c) => c.annotations?.audience?.includes("assistant")) ??
    res.content[res.content.length - 1];
  return JSON.parse(item.text);
};

Deno.test("Task Tools - Creation (standalone and linked to workflow) and Hierarchy", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    // 1. Create a workflow first
    const wfRes = await createWorkflowTool.execute({
      name: "Deployment Pipeline",
      description: "Automated deployment workflow",
    });
    assert(!wfRes.isError);
    const wfData = parseToolResponse(wfRes);
    const workflowId = wfData.workflow.id;

    // 2. Create a standalone task
    const t1Res = await createTaskTool.execute({
      title: "Write documentation",
      description: "User guide for API",
      role: "technical-writer",
      priority: "medium",
    });
    assert(!t1Res.isError);
    const t1Data = parseToolResponse(t1Res);
    const t1 = t1Data.task;

    assertMatch(t1.id, /^tk-[0-9a-f]{6}/);
    assertEquals(t1.title, "Write documentation");
    assertEquals(t1.status, "open");
    assertEquals(t1.role, "technical-writer");
    assertEquals(t1.priority, "medium");
    assertEquals(t1.workflowId, undefined);

    // 3. Create a task linked to workflow & execution
    const t2Res = await createTaskTool.execute({
      title: "Deploy database migrations",
      description: "Run flyway migrations",
      role: "devops",
      priority: "critical",
      workflow: workflowId,
      executionId: "exec-100",
      node: "step-db",
    });
    assert(!t2Res.isError);
    const t2Data = parseToolResponse(t2Res);
    const t2 = t2Data.task;

    assertEquals(t2.title, "Deploy database migrations");
    assertEquals(t2.workflowId, workflowId);
    assertEquals(t2.executionId, "exec-100");
    assertEquals(t2.nodeId, "step-db");
    assertEquals(t2.role, "devops");
    assertEquals(t2.priority, "critical");

    // 4. Create child subtask nested under t1
    const t3Res = await createTaskTool.execute({
      title: "Review documentation draft",
      parentTaskId: t1.id,
      role: "reviewer",
      priority: "low",
    });
    assert(!t3Res.isError);
    const t3Data = parseToolResponse(t3Res);
    const t3 = t3Data.task;

    assertEquals(t3.parentTaskId, t1.id);
  } finally {
    kv.close();
  }
});

Deno.test("Task Tools - Listing tasks with filters and summary counts", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    const t1Res = await createTaskTool.execute({
      title: "Task 1",
      role: "backend",
      priority: "high",
    });
    const t2Res = await createTaskTool.execute({
      title: "Task 2",
      role: "frontend",
      priority: "low",
    });
    const t3Res = await createTaskTool.execute({
      title: "Task 3",
      role: "backend",
      priority: "medium",
    });

    const t1 = parseToolResponse(t1Res).task;
    const t2 = parseToolResponse(t2Res).task;
    const t3 = parseToolResponse(t3Res).task;

    // List all
    const allRes = await listTasksTool.execute({});
    assert(!allRes.isError);
    const allData = parseToolResponse(allRes);
    assertEquals(allData.tasks.length, 3);
    assertEquals(allData.summary.total, 3);
    assertEquals(allData.summary.open, 3);

    // List by role
    const backendRes = await listTasksTool.execute({ role: "backend" });
    assert(!backendRes.isError);
    const backendData = parseToolResponse(backendRes);
    assertEquals(backendData.tasks.length, 2);
    assert(backendData.tasks.some((t: { id: string }) => t.id === t1.id));
    assert(backendData.tasks.some((t: { id: string }) => t.id === t3.id));

    // Update t2 to in_progress
    await updateTaskTool.execute({ taskId: t2.id, status: "in_progress" });

    // List by status
    const inProgRes = await listTasksTool.execute({ status: "in_progress" });
    const inProgData = parseToolResponse(inProgRes);
    assertEquals(inProgData.tasks.length, 1);
    assertEquals(inProgData.tasks[0].id, t2.id);

    // Summary counts check
    const summaryRes = await listTasksTool.execute({});
    const summaryData = parseToolResponse(summaryRes);
    assertEquals(summaryData.summary.total, 3);
    assertEquals(summaryData.summary.open, 2);
    assertEquals(summaryData.summary.in_progress, 1);
  } finally {
    kv.close();
  }
});

Deno.test("Task Tools - Dependencies, Ready Frontier, Claiming, and Cascade Unblocking", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    // 1. Create 3 tasks: A -> B -> C
    // Task A blocks Task B, Task B blocks Task C
    const tARes = await createTaskTool.execute({ title: "Task A - Prerequisite" });
    const tBRes = await createTaskTool.execute({ title: "Task B - Core Implementation" });
    const tCRes = await createTaskTool.execute({ title: "Task C - Verification" });

    const taskA = parseToolResponse(tARes).task;
    const taskB = parseToolResponse(tBRes).task;
    const taskC = parseToolResponse(tCRes).task;

    assertEquals(taskA.status, "open");
    assertEquals(taskB.status, "open");
    assertEquals(taskC.status, "open");

    // 2. Add dependency: Task A blocks Task B
    const depABRes = await dependTaskTool.execute({
      action: "add",
      fromTask: taskA.id,
      toTask: taskB.id,
      type: "blocks",
    });
    assert(!depABRes.isError);
    const depABData = parseToolResponse(depABRes);
    assertEquals(depABData.dependency.fromTaskId, taskA.id);
    assertEquals(depABData.dependency.toTaskId, taskB.id);

    // Verify taskB is now blocked
    const getB1 = await getTaskTool.execute({ taskId: taskB.id });
    assertEquals(parseToolResponse(getB1).task.status, "blocked");

    // Add dependency: Task B blocks Task C
    const depBCRes = await dependTaskTool.execute({
      action: "add",
      fromTask: taskB.id,
      toTask: taskC.id,
      type: "blocks",
    });
    assert(!depBCRes.isError);

    // Verify taskC is now blocked
    const getC1 = await getTaskTool.execute({ taskId: taskC.id });
    assertEquals(parseToolResponse(getC1).task.status, "blocked");

    // 3. Compute ready frontier: only taskA should be ready
    const ready1Res = await readyTasksTool.execute({});
    assert(!ready1Res.isError);
    const ready1Data = parseToolResponse(ready1Res);
    assertEquals(ready1Data.frontierSize, 1);
    assertEquals(ready1Data.readyTasks[0].id, taskA.id);

    // 4. Attempting to claim a blocked task (Task B) should fail
    const claimBlockedRes = await claimTaskTool.execute({
      taskId: taskB.id,
      assignee: "worker-1",
    });
    assert(claimBlockedRes.isError, "Claiming a blocked task should error");

    // 5. Claim Task A atomically
    const claimARes = await claimTaskTool.execute({
      taskId: taskA.id,
      assignee: "worker-1",
    });
    assert(!claimARes.isError);
    const claimAData = parseToolResponse(claimARes);
    assertEquals(claimAData.task.status, "claimed");
    assertEquals(claimAData.task.assignee, "worker-1");
    assertMatch(claimAData.instructions, /context_prime/);

    // Attempting to claim Task A again should fail
    const claimAAgainRes = await claimTaskTool.execute({
      taskId: taskA.id,
      assignee: "worker-2",
    });
    assert(claimAAgainRes.isError, "Re-claiming an already claimed task should error");

    // 6. Close Task A and verify Task B unblocks
    const closeARes = await closeTaskTool.execute({
      taskId: taskA.id,
      reason: "Prerequisite completed",
    });
    assert(!closeARes.isError);
    const closeAData = parseToolResponse(closeARes);
    assertEquals(closeAData.task.status, "closed");
    assertEquals(closeAData.task.closedReason, "Prerequisite completed");
    assertEquals(closeAData.unblockedTasks.length, 1);
    assertEquals(closeAData.unblockedTasks[0].id, taskB.id);

    // Check Task B status is now open
    const getB2 = await getTaskTool.execute({ taskId: taskB.id });
    assertEquals(parseToolResponse(getB2).task.status, "open");

    // Check Task C is still blocked (because Task B is open, not closed)
    const getC2 = await getTaskTool.execute({ taskId: taskC.id });
    assertEquals(parseToolResponse(getC2).task.status, "blocked");

    // Check ready frontier now has Task B
    const ready2Res = await readyTasksTool.execute({});
    const ready2Data = parseToolResponse(ready2Res);
    assertEquals(ready2Data.frontierSize, 1);
    assertEquals(ready2Data.readyTasks[0].id, taskB.id);

    // 7. Close Task B and verify Task C unblocks
    const closeBRes = await closeTaskTool.execute({
      taskId: taskB.id,
      reason: "Core completed",
    });
    assert(!closeBRes.isError);
    const closeBData = parseToolResponse(closeBRes);
    assertEquals(closeBData.unblockedTasks.length, 1);
    assertEquals(closeBData.unblockedTasks[0].id, taskC.id);

    // Check Task C is now open and in ready frontier
    const ready3Res = await readyTasksTool.execute({});
    const ready3Data = parseToolResponse(ready3Res);
    assertEquals(ready3Data.frontierSize, 1);
    assertEquals(ready3Data.readyTasks[0].id, taskC.id);
  } finally {
    kv.close();
  }
});

Deno.test("Task Tools - Get with dependencies and children, Update with context append", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    // 1. Create parent task and two child tasks
    const parentRes = await createTaskTool.execute({
      title: "Parent Epic",
      description: "Large feature epic",
      role: "lead",
    });
    const parentTask = parseToolResponse(parentRes).task;

    const child1Res = await createTaskTool.execute({
      title: "Subtask 1",
      parentTaskId: parentTask.id,
    });
    const child2Res = await createTaskTool.execute({
      title: "Subtask 2",
      parentTaskId: parentTask.id,
    });
    const child1 = parseToolResponse(child1Res).task;
    const child2 = parseToolResponse(child2Res).task;

    // Subtask 1 blocks Subtask 2
    await dependTaskTool.execute({
      action: "add",
      fromTask: child1.id,
      toTask: child2.id,
      type: "blocks",
    });

    // 2. Fetch parent task with children
    const getParentRes = await getTaskTool.execute({
      taskId: parentTask.id,
      includeChildren: true,
    });
    assert(!getParentRes.isError);
    const parentData = parseToolResponse(getParentRes);
    assertEquals(parentData.task.id, parentTask.id);
    assertEquals(parentData.children.length, 2);
    assert(parentData.children.some((c: { id: string }) => c.id === child1.id));
    assert(parentData.children.some((c: { id: string }) => c.id === child2.id));

    // 3. Fetch child 2 with dependencies
    const getChild2Res = await getTaskTool.execute({
      taskId: child2.id,
      includeDependencies: true,
    });
    assert(!getChild2Res.isError);
    const child2Data = parseToolResponse(getChild2Res);
    assertEquals(child2Data.dependencies.blockedBy.length, 1);
    assertEquals(child2Data.dependencies.blockedBy[0].fromTaskId, child1.id);
    assertEquals(child2Data.dependencies.blocking.length, 0);

    // 4. Update task details and test context appending
    const update1Res = await updateTaskTool.execute({
      taskId: child1.id,
      title: "Subtask 1 - Revised",
      priority: "high",
      context: "Initial investigation showed auth token expired.",
    });
    assert(!update1Res.isError);
    const update1 = parseToolResponse(update1Res).task;
    assertEquals(update1.title, "Subtask 1 - Revised");
    assertEquals(update1.priority, "high");
    assertEquals(update1.context, "Initial investigation showed auth token expired.");

    // Append additional context
    const update2Res = await updateTaskTool.execute({
      taskId: child1.id,
      context: "Token refreshed successfully with OAuth provider.",
    });
    assert(!update2Res.isError);
    const update2 = parseToolResponse(update2Res).task;
    assertEquals(
      update2.context,
      "Initial investigation showed auth token expired.\nToken refreshed successfully with OAuth provider.",
    );

    // 5. Remove dependency between child1 and child2
    const removeDepRes = await dependTaskTool.execute({
      action: "remove",
      fromTask: child1.id,
      toTask: child2.id,
    });
    assert(!removeDepRes.isError);

    // Child2 should now be unblocked (status "open")
    const getChild2AfterRemove = await getTaskTool.execute({ taskId: child2.id });
    assertEquals(parseToolResponse(getChild2AfterRemove).task.status, "open");
  } finally {
    kv.close();
  }
});

Deno.test("Task Tools - task_comment tool logs short comments with 256-char limit", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    const taskRes = await createTaskTool.execute({
      title: "Implement passkey biometric auth",
      role: "security",
    });
    const task = parseToolResponse(taskRes).task;

    // 1. Post short comment
    const commentRes1 = await commentTaskTool.execute({
      taskId: task.id,
      author: "security-reviewer",
      comment: "WebAuthn challenge validation approved.",
    });
    assert(!commentRes1.isError);
    const commentData1 = parseToolResponse(commentRes1);
    assertEquals(commentData1.comment.author, "security-reviewer");
    assertEquals(commentData1.comment.content, "WebAuthn challenge validation approved.");
    assertEquals(commentData1.task.comments.length, 1);

    // 2. Post exact 256-character comment
    const exact256 = "a".repeat(256);
    const commentRes2 = await commentTaskTool.execute({
      taskId: task.id,
      author: "qa-bot",
      comment: exact256,
    });
    assert(!commentRes2.isError);
    const commentData2 = parseToolResponse(commentRes2);
    assertEquals(commentData2.comment.content.length, 256);
    assertEquals(commentData2.task.comments.length, 2);

    // 3. Verify getTaskTool returns the comments array
    const getRes = await getTaskTool.execute({ taskId: task.id });
    const getData = parseToolResponse(getRes);
    assertEquals(Array.isArray(getData.task.comments), true);
    assertEquals(getData.task.comments.length, 2);

    // 4. Reject comment over 256 characters
    const commentResTooLong = await commentTaskTool.execute({
      taskId: task.id,
      comment: "b".repeat(257),
    });
    assertEquals(commentResTooLong.isError, true);

    // 5. Reject empty comment
    const commentResEmpty = await commentTaskTool.execute({
      taskId: task.id,
      comment: "   ",
    });
    assertEquals(commentResEmpty.isError, true);
  } finally {
    kv.close();
  }
});
