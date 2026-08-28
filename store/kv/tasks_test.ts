import { assertEquals, assertMatch, assertNotEquals, assertRejects } from "@std/assert";
import { withUserContext } from "../../auth/context.ts";
import { setKv } from "./client.ts";
import { getRole } from "./roles.ts";
import {
  addDependency,
  addTaskComment,
  claimTask,
  closeTask,
  computeReadyFrontier,
  createTask,
  deleteTask,
  getDependencies,
  getTask,
  getTaskComments,
  listTasks,
  removeDependency,
  updateTask,
} from "./tasks.ts";

Deno.test("Tasks - Creation, Auto-ID, Auto-Role, and Retrieval", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    const userId = "user_task_crud";

    await withUserContext(userId, async () => {
      // 1. Create task with auto-generated ID
      const t1 = await createTask({
        title: "Build auth module",
        description: "Implement OAuth2 and passkeys",
        role: "security-engineer",
        workflowId: "wf-1",
        executionId: "exec-1",
        nodeId: "node-auth",
        priority: "high",
      });

      assertMatch(t1.id, /^tk-[0-9a-f]{6}/);
      assertEquals(t1.title, "Build auth module");
      assertEquals(t1.status, "open");
      assertEquals(t1.userId, userId);

      // Verify auto-created role
      const role = await getRole("security-engineer");
      assertEquals(role?.name, "security-engineer");

      // 2. Get task
      const fetched = await getTask(t1.id);
      assertEquals(fetched?.id, t1.id);
      assertEquals(fetched?.title, t1.title);

      // 3. Create subtask with parentTaskId and custom ID
      const t2 = await createTask({
        id: "tk-custom-01",
        title: "Unit tests for auth",
        parentTaskId: t1.id,
        role: "qa-engineer",
        workflowId: "wf-1",
      });
      assertEquals(t2.id, "tk-custom-01");
      assertEquals(t2.parentTaskId, t1.id);

      // 4. Create task with assignee -> status defaults to claimed
      const t3 = await createTask({
        title: "Setup CI pipeline",
        assignee: "devops-agent",
        role: "devops",
      });
      assertEquals(t3.status, "claimed");
      assertEquals(t3.assignee, "devops-agent");
    });
  } finally {
    kv.close();
  }
});

Deno.test("Tasks - List filtering across indexes and fields", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    const userId = "user_task_list";

    await withUserContext(userId, async () => {
      const t1 = await createTask({
        title: "Task 1",
        workflowId: "wf-A",
        executionId: "exec-A1",
        nodeId: "node-1",
        role: "frontend",
      });
      const t2 = await createTask({
        title: "Task 2",
        workflowId: "wf-A",
        executionId: "exec-A1",
        nodeId: "node-2",
        role: "backend",
        assignee: "alice",
      });
      const t3 = await createTask({
        title: "Task 3",
        workflowId: "wf-B",
        executionId: "exec-B1",
        role: "frontend",
        parentTaskId: t1.id,
      });

      // Filter by workflowId
      const wfTasks = await listTasks({ workflowId: "wf-A" });
      assertEquals(wfTasks.length, 2);

      // Filter by executionId
      const execTasks = await listTasks({ executionId: "exec-B1" });
      assertEquals(execTasks.length, 1);
      assertEquals(execTasks[0].id, t3.id);

      // Filter by role
      const frontendTasks = await listTasks({ role: "frontend" });
      assertEquals(frontendTasks.length, 2);

      // Filter by assignee
      const aliceTasks = await listTasks({ assignee: "alice" });
      assertEquals(aliceTasks.length, 1);
      assertEquals(aliceTasks[0].id, t2.id);

      // Filter by parentTaskId
      const subtasks = await listTasks({ parentTaskId: t1.id });
      assertEquals(subtasks.length, 1);
      assertEquals(subtasks[0].id, t3.id);

      // Filter by status array
      const openTasks = await listTasks({ status: ["open"] });
      assertEquals(openTasks.length, 2);

      // Limit
      const limited = await listTasks({ limit: 1 });
      assertEquals(limited.length, 1);
    });
  } finally {
    kv.close();
  }
});

Deno.test("Tasks - Update and Delete with index synchronization", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    const userId = "user_task_update_del";

    await withUserContext(userId, async () => {
      const task = await createTask({
        title: "Refactor database",
        role: "backend",
        assignee: "bob",
      });

      // 1. Update assignee
      const updated = await updateTask(task.id, {
        assignee: "charlie",
        context: "Analyzed existing schema",
        rejectedApproaches: ["In-place migration with locks"],
      });
      assertEquals(updated.assignee, "charlie");
      assertEquals(updated.context, "Analyzed existing schema");

      // Verify old assignee index cleared and new index active
      const bobList = await listTasks({ assignee: "bob" });
      assertEquals(bobList.length, 0);
      const charlieList = await listTasks({ assignee: "charlie" });
      assertEquals(charlieList.length, 1);
      assertEquals(charlieList[0].id, task.id);

      // 2. Update role
      await updateTask(task.id, { role: "data-engineer" });
      const oldRoleList = await listTasks({ role: "backend" });
      assertEquals(oldRoleList.length, 0);
      const newRoleList = await listTasks({ role: "data-engineer" });
      assertEquals(newRoleList.length, 1);

      // 3. Delete task
      await deleteTask(task.id);
      const fetched = await getTask(task.id);
      assertEquals(fetched, null);

      const listAfter = await listTasks();
      assertEquals(listAfter.length, 0);
    });
  } finally {
    kv.close();
  }
});

Deno.test("Tasks - Dependencies and Automatic Status Transitions", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    const userId = "user_task_deps";

    await withUserContext(userId, async () => {
      const t1 = await createTask({ title: "Design API" });
      const t2 = await createTask({ title: "Implement API" });

      assertEquals(t1.status, "open");
      assertEquals(t2.status, "open");

      // Self-dependency rejected
      await assertRejects(
        () => addDependency(t1.id, t1.id),
        Error,
        "A task cannot depend on itself",
      );

      // Add "blocks" dependency: t1 blocks t2
      const dep = await addDependency(t1.id, t2.id, "blocks");
      assertEquals(dep.fromTaskId, t1.id);
      assertEquals(dep.toTaskId, t2.id);
      assertEquals(dep.type, "blocks");

      // t2 should automatically transition from "open" to "blocked"
      const t2Updated = await getTask(t2.id);
      assertEquals(t2Updated?.status, "blocked");

      // Verify getDependencies: blocking vs blocked-by
      const t1Blocking = await getDependencies(t1.id, "blocking");
      assertEquals(t1Blocking.length, 1);
      assertEquals(t1Blocking[0].toTaskId, t2.id);

      const t2BlockedBy = await getDependencies(t2.id, "blocked-by");
      assertEquals(t2BlockedBy.length, 1);
      assertEquals(t2BlockedBy[0].fromTaskId, t1.id);

      // Removing dependency should unblock t2 back to "open"
      await removeDependency(t1.id, t2.id);
      const t2Unblocked = await getTask(t2.id);
      assertEquals(t2Unblocked?.status, "open");

      const t2Remaining = await getDependencies(t2.id, "blocked-by");
      assertEquals(t2Remaining.length, 0);
    });
  } finally {
    kv.close();
  }
});

Deno.test("Tasks - Atomic Claim Check and Concurrency Protection", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    const userId = "user_task_claim";

    await withUserContext(userId, async () => {
      const task = await createTask({ title: "Optimize DB queries" });
      assertEquals(task.status, "open");

      // 1. Claim successfully
      const claimed = await claimTask(task.id, "agent-optim");
      assertEquals(claimed.status, "claimed");
      assertEquals(claimed.assignee, "agent-optim");
      assertNotEquals(claimed.claimedAt, undefined);

      // 2. Re-claiming an already claimed task throws error
      await assertRejects(
        () => claimTask(task.id, "agent-rival"),
        Error,
        'cannot be claimed because its current status is "claimed"',
      );

      // 3. Claiming a blocked task throws error
      const blocker = await createTask({ title: "Prerequisite setup" });
      const blockedTask = await createTask({ title: "Dependent job" });
      await addDependency(blocker.id, blockedTask.id, "blocks");

      await assertRejects(
        () => claimTask(blockedTask.id, "agent-worker"),
        Error,
        "cannot be claimed because it is blocked",
      );
    });
  } finally {
    kv.close();
  }
});

Deno.test("Tasks - Close Task and Cascading Dependency Resolution (Diamond Graph)", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    const userId = "user_task_cascade";

    await withUserContext(userId, async () => {
      // Build diamond dependency graph:
      //         A
      //       /   \
      //      B     C
      //       \   /
      //         D
      const taskA = await createTask({ title: "Task A (Root)" });
      const taskB = await createTask({ title: "Task B" });
      const taskC = await createTask({ title: "Task C" });
      const taskD = await createTask({ title: "Task D (Join)" });

      await addDependency(taskA.id, taskB.id, "blocks");
      await addDependency(taskA.id, taskC.id, "blocks");
      await addDependency(taskB.id, taskD.id, "blocks");
      await addDependency(taskC.id, taskD.id, "blocks");

      assertEquals((await getTask(taskB.id))?.status, "blocked");
      assertEquals((await getTask(taskC.id))?.status, "blocked");
      assertEquals((await getTask(taskD.id))?.status, "blocked");

      // 1. Close Task A -> should unblock B and C, but NOT D
      const resA = await closeTask(taskA.id, "Completed root work");
      assertEquals(resA.task.status, "closed");
      assertEquals(resA.task.closedReason, "Completed root work");
      assertEquals(resA.unblockedTasks.length, 2);

      const unblockedIds = resA.unblockedTasks.map((t) => t.id).sort();
      assertEquals(unblockedIds, [taskB.id, taskC.id].sort());

      // Task D is still blocked (by B and C)
      assertEquals((await getTask(taskD.id))?.status, "blocked");

      // 2. Close Task B -> D is still blocked by C
      const resB = await closeTask(taskB.id, "Completed branch B");
      assertEquals(resB.unblockedTasks.length, 0);
      assertEquals((await getTask(taskD.id))?.status, "blocked");

      // 3. Close Task C -> D now has all blockers closed, so D unblocks!
      const resC = await closeTask(taskC.id, "Completed branch C");
      assertEquals(resC.unblockedTasks.length, 1);
      assertEquals(resC.unblockedTasks[0].id, taskD.id);
      assertEquals(resC.unblockedTasks[0].status, "open");

      // Verify D in store
      assertEquals((await getTask(taskD.id))?.status, "open");
    });
  } finally {
    kv.close();
  }
});

Deno.test("Tasks - Ready Frontier Computation", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    const userId = "user_task_frontier";

    await withUserContext(userId, async () => {
      // Create independent task
      const tIndependent = await createTask({
        title: "Independent Documentation",
        role: "technical-writer",
      });

      // Create chain: Root -> Child
      const tRoot = await createTask({
        title: "Core Kernel Engine",
        role: "systems-engineer",
      });
      const tChild = await createTask({
        title: "Kernel Plugin API",
        role: "systems-engineer",
      });
      await addDependency(tRoot.id, tChild.id, "blocks");

      // 1. Initial frontier: tIndependent and tRoot are ready, tChild is NOT
      const frontierAll = await computeReadyFrontier();
      const frontierIds = frontierAll.map((t) => t.id);
      assertEquals(frontierIds.includes(tIndependent.id), true);
      assertEquals(frontierIds.includes(tRoot.id), true);
      assertEquals(frontierIds.includes(tChild.id), false);

      // 2. Frontier filtered by role
      const writerFrontier = await computeReadyFrontier({ role: "technical-writer" });
      assertEquals(writerFrontier.length, 1);
      assertEquals(writerFrontier[0].id, tIndependent.id);

      const systemsFrontier = await computeReadyFrontier({ role: "systems-engineer" });
      assertEquals(systemsFrontier.length, 1);
      assertEquals(systemsFrontier[0].id, tRoot.id);

      // 3. Close tRoot -> now tChild is ready
      await closeTask(tRoot.id, "Kernel stable");
      const systemsFrontierAfter = await computeReadyFrontier({ role: "systems-engineer" });
      assertEquals(systemsFrontierAfter.length, 1);
      assertEquals(systemsFrontierAfter[0].id, tChild.id);

      // 4. Test unclaimedOnly filter
      await claimTask(tIndependent.id, "writer-alice");
      const unclaimedFrontier = await computeReadyFrontier({ unclaimedOnly: true });
      const unclaimedIds = unclaimedFrontier.map((t) => t.id);
      assertEquals(unclaimedIds.includes(tIndependent.id), false);
      assertEquals(unclaimedIds.includes(tChild.id), true);
    });
  } finally {
    kv.close();
  }
});

Deno.test("Tasks - User Tenant Isolation", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    const userAlice = "user_alice_tasks";
    const userBob = "user_bob_tasks";

    let aliceTaskId = "";
    await withUserContext(userAlice, async () => {
      const task = await createTask({
        title: "Alice Confidential Task",
        role: "alice-role",
      });
      aliceTaskId = task.id;
    });

    await withUserContext(userBob, async () => {
      // Bob cannot see Alice's task
      const bobGet = await getTask(aliceTaskId);
      assertEquals(bobGet, null);

      const bobList = await listTasks();
      assertEquals(bobList.length, 0);

      const bobFrontier = await computeReadyFrontier();
      assertEquals(bobFrontier.length, 0);

      // Bob cannot claim Alice's task
      await assertRejects(
        () => claimTask(aliceTaskId, "bob"),
        Error,
        `Task not found: ${aliceTaskId}`,
      );

      // Bob cannot close Alice's task
      await assertRejects(
        () => closeTask(aliceTaskId),
        Error,
        `Task not found: ${aliceTaskId}`,
      );
    });
  } finally {
    kv.close();
  }
});

Deno.test("Tasks - Comments Log and 256-character limitation", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    const userId = "user_comments_test";

    await withUserContext(userId, async () => {
      // 1. Newly created task has empty comments array (never undefined)
      const task = await createTask({
        title: "Review pull request #42",
        role: "reviewer",
      });

      assertEquals(Array.isArray(task.comments), true);
      assertEquals(task.comments.length, 0);

      // 2. Add valid comments <= 256 characters
      const c1 = await addTaskComment(task.id, {
        author: "alice",
        content: "Looks good, left two minor suggestions on line 40.",
      });

      assertEquals(c1.taskId, task.id);
      assertEquals(c1.author, "alice");
      assertEquals(c1.content, "Looks good, left two minor suggestions on line 40.");
      assertMatch(c1.id, /^cm-[0-9a-f]{8}/);

      // 3. Add second comment exactly 256 characters
      const exact256 = "x".repeat(256);
      const c2 = await addTaskComment(task.id, {
        author: "bot",
        content: exact256,
      });
      assertEquals(c2.content.length, 256);

      // 4. Retrieve task and comments
      const fetchedTask = await getTask(task.id);
      assertEquals(fetchedTask?.comments.length, 2);
      assertEquals(fetchedTask?.comments[0].author, "alice");
      assertEquals(fetchedTask?.comments[1].author, "bot");

      const fetchedComments = await getTaskComments(task.id);
      assertEquals(fetchedComments.length, 2);

      // 5. Reject empty comments
      await assertRejects(
        () => addTaskComment(task.id, { content: "" }),
        Error,
        "Comment content cannot be empty",
      );

      await assertRejects(
        () => addTaskComment(task.id, { content: "   " }),
        Error,
        "Comment content cannot be empty",
      );

      // 6. Reject comment exceeding 256 characters (257 characters)
      const tooLong = "x".repeat(257);
      await assertRejects(
        () => addTaskComment(task.id, { content: tooLong }),
        Error,
        "exceeds maximum length of 256 characters",
      );
    });
  } finally {
    kv.close();
  }
});
