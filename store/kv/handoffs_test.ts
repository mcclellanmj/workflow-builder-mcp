import { assertEquals, assertRejects } from "@std/assert";
import { withUserContext } from "../../auth/context.ts";
import { setKv } from "./client.ts";
import { getHandoffsForTask, recordHandoff } from "./handoffs.ts";

Deno.test("Handoffs - Record and retrieve handoffs", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    const userId = "user_handoff_test";

    await withUserContext(userId, async () => {
      const taskId = "tk-1001";

      // 1. Initial list empty
      const initial = await getHandoffsForTask(taskId);
      assertEquals(initial.length, 0);

      // 2. Record first handoff
      const h1 = await recordHandoff({
        taskId,
        fromAssignee: "agent-alice",
        toAssignee: "agent-bob",
        reason: "Shift ended",
        contextSummary: "Completed initial scaffolding",
        rejectedApproaches: ["Tried regex parsing, failed on edge cases"],
        timestamp: "2026-08-28T01:00:00.000Z",
      });
      assertEquals(h1.taskId, taskId);
      assertEquals(h1.fromAssignee, "agent-alice");
      assertEquals(h1.toAssignee, "agent-bob");
      assertEquals(h1.rejectedApproaches.length, 1);

      // 3. Record second handoff to a role
      const h2 = await recordHandoff({
        taskId,
        fromAssignee: "agent-bob",
        toRole: "security-reviewer",
        reason: "Needs security review before merge",
        contextSummary: "Implemented JWT auth, need review",
        rejectedApproaches: ["Tried symmetric tokens, switching to asymmetric"],
        timestamp: "2026-08-28T02:00:00.000Z",
      });
      assertEquals(h2.toRole, "security-reviewer");

      // 4. Retrieve handoffs for task — verify order
      const records = await getHandoffsForTask(taskId);
      assertEquals(records.length, 2);
      assertEquals(records[0].id, h1.id);
      assertEquals(records[1].id, h2.id);

      // 5. Another task has its own handoffs
      const otherTaskId = "tk-2002";
      const hOther = await recordHandoff({
        taskId: otherTaskId,
        fromAssignee: "agent-charlie",
        reason: "Blocker encountered",
      });
      const otherRecords = await getHandoffsForTask(otherTaskId);
      assertEquals(otherRecords.length, 1);
      assertEquals(otherRecords[0].id, hOther.id);

      // Still 2 for original task
      const origRecords = await getHandoffsForTask(taskId);
      assertEquals(origRecords.length, 2);
    });
  } finally {
    kv.close();
  }
});

Deno.test("Handoffs - User Tenant Isolation", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    const userAlice = "user_alice_handoffs";
    const userBob = "user_bob_handoffs";
    const sharedTaskId = "tk-shared-handoff";

    await withUserContext(userAlice, async () => {
      await recordHandoff({
        taskId: sharedTaskId,
        fromAssignee: "alice",
        reason: "Alice reason",
      });
    });

    await withUserContext(userBob, async () => {
      const bobRecords = await getHandoffsForTask(sharedTaskId);
      assertEquals(bobRecords.length, 0);

      await recordHandoff({
        taskId: sharedTaskId,
        fromAssignee: "bob",
        reason: "Bob reason",
      });
      const bobUpdated = await getHandoffsForTask(sharedTaskId);
      assertEquals(bobUpdated.length, 1);
      assertEquals(bobUpdated[0].fromAssignee, "bob");
    });

    await withUserContext(userAlice, async () => {
      const aliceRecords = await getHandoffsForTask(sharedTaskId);
      assertEquals(aliceRecords.length, 1);
      assertEquals(aliceRecords[0].fromAssignee, "alice");
    });
  } finally {
    kv.close();
  }
});

Deno.test("Handoffs - Validation errors", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    await withUserContext("user_test", async () => {
      await assertRejects(
        () => recordHandoff({ taskId: "", fromAssignee: "alice", reason: "reason" }),
        Error,
        "Task ID cannot be empty",
      );

      await assertRejects(
        () => recordHandoff({ taskId: "tk-1", fromAssignee: "", reason: "reason" }),
        Error,
        "fromAssignee cannot be empty",
      );

      await assertRejects(
        () => recordHandoff({ taskId: "tk-1", fromAssignee: "alice", reason: "" }),
        Error,
        "Handoff reason cannot be empty",
      );
    });
  } finally {
    kv.close();
  }
});
