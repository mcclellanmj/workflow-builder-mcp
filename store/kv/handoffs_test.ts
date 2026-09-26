import { assert, assertEquals, assertRejects } from "@std/assert";
import { withUserContext } from "../../auth/context.ts";
import { setKv } from "./client.ts";
import { getHandoffsForTask, recordHandoff } from "./handoffs.ts";
import { createTask, getTask } from "./tasks.ts";

Deno.test("Handoffs - Record handoff with advance, reject, and rejectionCount", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    const userId = "user_handoff_test";

    await withUserContext(userId, async () => {
      // 1. Create a task
      const task = await createTask({
        title: "Build auth module",
        role: "developer",
        assignee: "dev-1",
      });

      // 2. Advance handoff to reviewer
      const h1 = await recordHandoff({
        taskId: task.id,
        action: "advance",
        fromAssignee: "dev-1",
        toAssignee: "rev-1",
        toRole: "reviewer",
        reason: "Implementation ready for review",
        contextSummary: "All tests pass",
      });
      assertEquals(h1.action, "advance");

      const taskAfterAdvance = await getTask(task.id);
      assert(taskAfterAdvance !== null);
      assertEquals(taskAfterAdvance.assignee, "rev-1");
      assertEquals(taskAfterAdvance.role, "reviewer");

      // 3. Reject handoff back to developer
      const h2 = await recordHandoff({
        taskId: task.id,
        action: "reject",
        fromAssignee: "rev-1",
        toAssignee: "dev-1",
        toRole: "developer",
        reason: "Missing edge case tests",
        feedback: ["Add test for null token", "Check token expiry clock skew"],
      });
      assertEquals(h2.action, "reject");

      const taskAfterReject = await getTask(task.id);
      assert(taskAfterReject !== null);
      assertEquals(taskAfterReject.rejectionCount, 1);
      assertEquals(taskAfterReject.status, "open");
      assertEquals(taskAfterReject.role, "developer");
      assert(taskAfterReject.comments.length > 0);
      assert(taskAfterReject.comments.some((c) => c.content.includes("null token")));

      // 4. Retrieve all handoffs
      const allHandoffs = await getHandoffsForTask(task.id);
      assertEquals(allHandoffs.length, 2);
    });
  } finally {
    kv.close();
  }
});

Deno.test("Handoffs - Validation", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    // Missing task ID
    await assertRejects(
      () =>
        recordHandoff({
          taskId: "",
          action: "advance",
          fromAssignee: "dev",
          reason: "done",
        }),
      Error,
      "Task ID cannot be empty",
    );

    // Missing reason
    await assertRejects(
      () =>
        recordHandoff({
          taskId: "tk-123",
          action: "advance",
          fromAssignee: "dev",
          reason: "",
        }),
      Error,
      "Handoff reason cannot be empty",
    );
  } finally {
    kv.close();
  }
});
