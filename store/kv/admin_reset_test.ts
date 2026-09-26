import { assertEquals } from "@std/assert";
import { purgeWorkflowMcpData } from "./admin_reset.ts";

Deno.test({
  name: "purgeWorkflowMcpData - Safely deletes only workflow keys, strictly preserving other apps",
  async fn() {
    const kv = await Deno.openKv(":memory:");

    // 1. Populate workflow data
    await kv.set(["workflows", "wf-1"], { id: "wf-1", name: "Test Workflow" });
    await kv.set(["executions", "exec-1"], { id: "exec-1" });
    await kv.set(["memories", "mem-1"], { id: "mem-1" });
    await kv.set(["roles", "role-1"], { id: "role-1" });
    await kv.set(["users", "user-1", "workflows", "wf-1"], { id: "wf-1" });
    await kv.set(["users", "user-1", "tasks", "tk-1"], { id: "tk-1" });
    await kv.set(["users", "user-1", "executions", "exec-1"], { id: "exec-1" });

    // 2. Populate other apps' data in the same database
    await kv.set(["other_app", "settings"], { theme: "dark" });
    await kv.set(["dempsey_app", "profile"], { name: "Dempsey" });
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
    assertEquals(result.deletedCount, 7);

    // 5. Assert other apps' data is 100% PRESERVED
    assertEquals((await kv.get(["other_app", "settings"])).value, { theme: "dark" });
    assertEquals((await kv.get(["dempsey_app", "profile"])).value, { name: "Dempsey" });
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
