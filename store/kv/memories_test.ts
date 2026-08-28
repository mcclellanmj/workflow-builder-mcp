import { assertEquals, assertNotEquals, assertRejects } from "@std/assert";
import { withUserContext } from "../../auth/context.ts";
import { setKv } from "./client.ts";
import {
  deleteMemory,
  getMemory,
  getMemoryAccessLog,
  listMemories,
  recallMemory,
  saveMemory,
} from "./memories.ts";

Deno.test("Memories - Save, Upsert, and Scoping", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    const userId = "user_memory_test";

    await withUserContext(userId, async () => {
      // 1. Save workflow-scoped memory
      const resWf = await saveMemory({
        key: "auth-model",
        summary: "Uses OAuth2 with PKCE",
        content: "Detailed OAuth2 instructions and secrets handling...",
        scope: "workflow",
        workflowId: "wf-101",
        source: "agent-architect",
        tags: ["auth", "security"],
      });
      assertEquals(resWf.created, true);
      assertEquals(resWf.memory.key, "auth-model");
      assertEquals(resWf.memory.scope, "workflow");
      assertEquals(resWf.memory.workflowId, "wf-101");

      // 2. Save node-scoped memory
      const resNode = await saveMemory({
        key: "edge-cases",
        summary: "UTF-8 parsing edge cases",
        content: "Watch out for multi-byte runes in input streams",
        scope: "node",
        workflowId: "wf-101",
        nodeId: "step-parser",
        tags: ["parser", "utf8"],
      });
      assertEquals(resNode.created, true);
      assertEquals(resNode.memory.nodeId, "step-parser");

      // 3. Save role-scoped memory
      const resRole = await saveMemory({
        key: "auth-model", // Same key as workflow memory, but scoped to role
        summary: "General authentication conventions across all pipelines",
        content: "All services must validate JWT signatures using JWKS endpoint",
        scope: "role",
        roleId: "security-reviewer",
        tags: ["auth", "standard"],
      });
      assertEquals(resRole.created, true);
      assertEquals(resRole.memory.scope, "role");
      assertEquals(resRole.memory.roleId, "security-reviewer");
      assertNotEquals(resRole.memory.id, resWf.memory.id);

      // 4. Upsert behavior: save again with same key and scope -> updates existing
      const resUpdate = await saveMemory({
        key: "auth-model",
        summary: "Uses OAuth2 PKCE + Biometric Passkeys",
        content: "Updated content with WebAuthn details",
        scope: "workflow",
        workflowId: "wf-101",
        tags: ["auth", "security", "passkey"],
      });
      assertEquals(resUpdate.created, false);
      assertEquals(resUpdate.memory.id, resWf.memory.id);
      assertEquals(resUpdate.memory.summary, "Uses OAuth2 PKCE + Biometric Passkeys");
      assertEquals(resUpdate.memory.content, "Updated content with WebAuthn details");

      // 5. getMemory by ID
      const fetched = await getMemory(resWf.memory.id);
      assertEquals(fetched?.id, resWf.memory.id);
      assertEquals(fetched?.summary, "Uses OAuth2 PKCE + Biometric Passkeys");
    });
  } finally {
    kv.close();
  }
});

Deno.test("Memories - Listing summaries (no content) and Access Tracking", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    const userId = "user_memory_list_test";

    await withUserContext(userId, async () => {
      await saveMemory({
        key: "mem-1",
        summary: "Summary one",
        content: "SECRET CONTENT ONE",
        scope: "workflow",
        workflowId: "wf-A",
        tags: ["alpha"],
      });
      await saveMemory({
        key: "mem-2",
        summary: "Summary two",
        content: "SECRET CONTENT TWO",
        scope: "workflow",
        workflowId: "wf-A",
        tags: ["alpha", "beta"],
      });
      await saveMemory({
        key: "mem-3",
        summary: "Summary three",
        content: "SECRET CONTENT THREE",
        scope: "role",
        roleId: "frontend",
        tags: ["beta"],
      });

      // 1. List all - verify summaries only, no content
      const allSummaries = await listMemories();
      assertEquals(allSummaries.length, 3);
      for (const item of allSummaries) {
        // @ts-ignore - verify content is not returned in summary
        assertEquals(item.content, undefined);
        assertEquals(typeof item.summary, "string");
        assertEquals(item.accessCount, 0);
        assertEquals(item.lastAccessed, undefined);
      }

      // 2. Filter by workflowId
      const wfSummaries = await listMemories({ workflowId: "wf-A" });
      assertEquals(wfSummaries.length, 2);

      // 3. Filter by roleId
      const roleSummaries = await listMemories({ roleId: "frontend" });
      assertEquals(roleSummaries.length, 1);
      assertEquals(roleSummaries[0].key, "mem-3");

      // 4. Filter by tags
      const tagSummaries = await listMemories({ tags: ["alpha", "beta"] });
      assertEquals(tagSummaries.length, 1);
      assertEquals(tagSummaries[0].key, "mem-2");

      // 5. Recall memory and check access log
      const recalled = await recallMemory({
        key: "mem-1",
        scope: "workflow",
        workflowId: "wf-A",
        accessedBy: "test-agent",
        executionId: "exec-123",
        taskId: "tk-999",
      });
      assertEquals(recalled?.content, "SECRET CONTENT ONE");

      // Check access log directly
      const logs = await getMemoryAccessLog(recalled!.id);
      assertEquals(logs.length, 1);
      assertEquals(logs[0].accessedBy, "test-agent");
      assertEquals(logs[0].executionId, "exec-123");
      assertEquals(logs[0].taskId, "tk-999");

      // Second recall from another agent
      await recallMemory({
        id: recalled!.id,
        accessedBy: "second-agent",
      });
      const logsAfterSecond = await getMemoryAccessLog(recalled!.id);
      assertEquals(logsAfterSecond.length, 2);

      // List memories now shows lastAccessed and accessCount = 2
      const updatedSummaries = await listMemories({ workflowId: "wf-A" });
      const mem1Summary = updatedSummaries.find((s) => s.key === "mem-1");
      assertEquals(mem1Summary?.accessCount, 2);
      assertNotEquals(mem1Summary?.lastAccessed, undefined);
    });
  } finally {
    kv.close();
  }
});

Deno.test("Memories - Delete with accessCount and index cleanup", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    const userId = "user_memory_del_test";

    await withUserContext(userId, async () => {
      const saved = await saveMemory({
        key: "to-delete",
        summary: "Will be deleted",
        content: "Some content",
        scope: "workflow",
        workflowId: "wf-del",
      });

      // Recall it twice to generate access log
      await recallMemory({ id: saved.memory.id, accessedBy: "agent-1" });
      await recallMemory({ id: saved.memory.id, accessedBy: "agent-2" });

      const logsBefore = await getMemoryAccessLog(saved.memory.id);
      assertEquals(logsBefore.length, 2);

      // Delete by key and scope
      const delRes = await deleteMemory({
        key: "to-delete",
        scope: "workflow",
        workflowId: "wf-del",
      });
      assertEquals(delRes.deleted, true);
      assertEquals(delRes.accessCount, 2);

      // Verify it's gone
      const fetched = await getMemory(saved.memory.id);
      assertEquals(fetched, null);

      const logsAfter = await getMemoryAccessLog(saved.memory.id);
      assertEquals(logsAfter.length, 0);

      const listAfter = await listMemories({ workflowId: "wf-del" });
      assertEquals(listAfter.length, 0);

      // Deleting again returns deleted: false, accessCount: 0
      const delAgain = await deleteMemory({ id: saved.memory.id });
      assertEquals(delAgain.deleted, false);
      assertEquals(delAgain.accessCount, 0);
    });
  } finally {
    kv.close();
  }
});

Deno.test("Memories - User Tenant Isolation", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    const userAlice = "user_alice_memories";
    const userBob = "user_bob_memories";

    let aliceMemId = "";
    await withUserContext(userAlice, async () => {
      const saved = await saveMemory({
        key: "config-key",
        summary: "Alice config",
        content: "Alice confidential credentials",
        scope: "workflow",
        workflowId: "wf-shared",
      });
      aliceMemId = saved.memory.id;
      await recallMemory({ id: aliceMemId, accessedBy: "alice" });
    });

    await withUserContext(userBob, async () => {
      // Bob cannot get Alice's memory by ID
      const bobGet = await getMemory(aliceMemId);
      assertEquals(bobGet, null);

      // Bob cannot list Alice's memories
      const bobList = await listMemories({ workflowId: "wf-shared" });
      assertEquals(bobList.length, 0);

      // Bob cannot recall Alice's memory
      const bobRecall = await recallMemory({
        key: "config-key",
        scope: "workflow",
        workflowId: "wf-shared",
      });
      assertEquals(bobRecall, null);

      // Bob's access log is empty
      const bobLogs = await getMemoryAccessLog(aliceMemId);
      assertEquals(bobLogs.length, 0);

      // Bob creates memory with same key
      await saveMemory({
        key: "config-key",
        summary: "Bob config",
        content: "Bob public info",
        scope: "workflow",
        workflowId: "wf-shared",
      });
    });

    await withUserContext(userAlice, async () => {
      const aliceGet = await getMemory(aliceMemId);
      assertEquals(aliceGet?.summary, "Alice config");
      assertEquals(aliceGet?.content, "Alice confidential credentials");
    });
  } finally {
    kv.close();
  }
});

Deno.test("Memories - Validation Errors", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    await withUserContext("user_test", async () => {
      await assertRejects(
        () => saveMemory({ key: "  ", summary: "sum", content: "cnt", scope: "workflow" }),
        Error,
        "Memory key cannot be empty",
      );

      await assertRejects(
        () => saveMemory({ key: "k", summary: "  ", content: "cnt", scope: "workflow" }),
        Error,
        "Memory summary cannot be empty",
      );
    });
  } finally {
    kv.close();
  }
});
