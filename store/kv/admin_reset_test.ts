import { assertEquals } from "@std/assert";
import { purgeWorkflowMcpData } from "./admin_reset.ts";

Deno.test({
  name: "purgeWorkflowMcpData - Safely deletes only workflow keys, strictly preserving other apps",
  async fn(): Promise<void> {
    const kv = await Deno.openKv(":memory:");

    // 1. Populate workflow data
    await kv.set(["workflows", "wf-1"], { id: "wf-1", name: "Test Workflow" });
    await kv.set(["executions", "exec-1"], { id: "exec-1" });
    await kv.set(["memories", "mem-1"], { id: "mem-1" });
    await kv.set(["roles", "role-1"], { id: "role-1" });
    await kv.set(["users", "user-1", "workflows", "wf-1"], { id: "wf-1" });
    await kv.set(["users", "user-1", "tasks", "tk-1"], { id: "tk-1" });
    await kv.set(["users", "user-1", "executions", "exec-1"], { id: "exec-1" });
    // User-scoped memory entries
    await kv.set(["users", "user-1", "memories", "mem-1"], { id: "mem-1", key: "auth.jwt" });
    await kv.set(["users", "user-1", "memory_keys", "wf-1", "auth.jwt"], "mem-1");
    await kv.set(["users", "user-1", "memories_by_workflow", "wf-1", "mem-1"], "mem-1");
    await kv.set(["users", "user-1", "memories_by_node", "wf-1", "node-1", "mem-1"], "mem-1");
    await kv.set(["users", "user-1", "memories_by_task", "tk-1", "mem-1"], "mem-1");
    await kv.set(["users", "user-1", "memory_access_log", "mem-1", "acc-1"], { id: "acc-1" });
    await kv.set(["users", "user-1", "closedTasks", "tk-closed-1"], { id: "tk-closed-1" });
    await kv.set(["users", "user-1", "role_journals", "developer"], { entry: "Journal text" });

    // 2. Populate other apps' data in the same database
    await kv.set(["other_app", "settings"], { theme: "dark" });
    await kv.set(["dempsey_app", "profile"], { name: "Dempsey" });
    await kv.set(["users", "user-1", "profile"], { name: "User 1", email: "user@example.com" });
    await kv.set(["users", "user-1", "passkeys", "cred-1"], { credentialId: "cred-1" });
    await kv.set(["users", "user-1", "other_app_notes", "note-1"], { text: "Hello" });
    await kv.set(["users", "user-1", "client_data", "c-1"], { balance: 100 });

    // 3. Perform safe purge
    const result = await purgeWorkflowMcpData(kv);

    // 4. Assert workflow data was deleted
    assertEquals((await kv.get(["workflows", "wf-1"])).value, null);
    assertEquals((await kv.get(["executions", "exec-1"])).value, null);
    assertEquals((await kv.get(["memories", "mem-1"])).value, null);
    assertEquals((await kv.get(["roles", "role-1"])).value, null);
    assertEquals((await kv.get(["users", "user-1", "workflows", "wf-1"])).value, null);
    assertEquals((await kv.get(["users", "user-1", "tasks", "tk-1"])).value, null);
    assertEquals((await kv.get(["users", "user-1", "executions", "exec-1"])).value, null);
    assertEquals((await kv.get(["users", "user-1", "memories", "mem-1"])).value, null);
    assertEquals(
      (await kv.get(["users", "user-1", "memory_keys", "wf-1", "auth.jwt"])).value,
      null,
    );
    assertEquals(
      (await kv.get(["users", "user-1", "memories_by_workflow", "wf-1", "mem-1"])).value,
      null,
    );
    assertEquals(
      (await kv.get(["users", "user-1", "memories_by_node", "wf-1", "node-1", "mem-1"])).value,
      null,
    );
    assertEquals(
      (await kv.get(["users", "user-1", "memories_by_task", "tk-1", "mem-1"])).value,
      null,
    );
    assertEquals(
      (await kv.get(["users", "user-1", "memory_access_log", "mem-1", "acc-1"])).value,
      null,
    );
    assertEquals((await kv.get(["users", "user-1", "closedTasks", "tk-closed-1"])).value, null);
    assertEquals((await kv.get(["users", "user-1", "role_journals", "developer"])).value, null);
    assertEquals(result.deletedCount, 15);

    // 5. Assert other apps' data is 100% PRESERVED
    assertEquals((await kv.get(["other_app", "settings"])).value, { theme: "dark" });
    assertEquals((await kv.get(["dempsey_app", "profile"])).value, { name: "Dempsey" });
    assertEquals((await kv.get(["users", "user-1", "profile"])).value, {
      name: "User 1",
      email: "user@example.com",
    });
    assertEquals((await kv.get(["users", "user-1", "passkeys", "cred-1"])).value, {
      credentialId: "cred-1",
    });
    assertEquals(
      (await kv.get(["users", "user-1", "other_app_notes", "note-1"])).value,
      { text: "Hello" },
    );
    assertEquals(
      (await kv.get(["users", "user-1", "client_data", "c-1"])).value,
      { balance: 100 },
    );

    await kv.close();
  },
});

Deno.test({
  name: "purgeWorkflowMcpData - Memory Vault clear integration test",
  async fn(): Promise<void> {
    const userId = "test_user_purge_memories";
    const kv = await Deno.openKv(":memory:");

    // Manually set client for this test or populate via KV
    await kv.set(["users", userId, "memories", "mem-abc"], {
      id: "mem-abc",
      workflowId: "wf-main",
      key: "arch.overview",
      summary: "Overview of architecture",
      content: "Details here",
      scope: "workflow",
      tags: ["arch"],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await kv.set(["users", userId, "memory_keys", "wf-main", "arch.overview"], "mem-abc");

    // Perform purge
    await purgeWorkflowMcpData(kv);

    // Verify memory and key index are gone
    assertEquals((await kv.get(["users", userId, "memories", "mem-abc"])).value, null);
    assertEquals(
      (await kv.get(["users", userId, "memory_keys", "wf-main", "arch.overview"])).value,
      null,
    );

    await kv.close();
  },
});
