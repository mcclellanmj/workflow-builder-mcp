import { assert, assertEquals } from "@std/assert";
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

Deno.test("Memories - Save, Upsert, and Indexing by workflow, node, task", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    const userId = "user_memory_test";
    const workflowId = "wf-101";

    await withUserContext(userId, async () => {
      // 1. Save workflow-wide memory
      const resWf = await saveMemory({
        workflowId,
        key: "auth-model",
        summary: "Uses OAuth2 with PKCE",
        content: "Detailed OAuth2 instructions and secrets handling...",
        source: "agent-architect",
        tags: ["auth", "security"],
      });
      assertEquals(resWf.created, true);
      assertEquals(resWf.memory.key, "auth-model");
      assertEquals(resWf.memory.workflowId, workflowId);

      // 2. Save node-anchored memory
      const resNode = await saveMemory({
        workflowId,
        nodeId: "step-parser",
        key: "edge-cases",
        summary: "UTF-8 parsing edge cases",
        content: "Watch out for multi-byte runes in input streams",
        tags: ["parser", "utf8"],
      });
      assertEquals(resNode.created, true);
      assertEquals(resNode.memory.nodeId, "step-parser");

      // 3. Save task-anchored memory
      const resTask = await saveMemory({
        workflowId,
        taskId: "tk-dev-42",
        key: "db-schema",
        summary: "Table schema for user accounts",
        content: "CREATE TABLE users (id UUID PRIMARY KEY...);",
        tags: ["database", "schema"],
      });
      assertEquals(resTask.created, true);
      assertEquals(resTask.memory.taskId, "tk-dev-42");

      // 4. Upsert: same workflowId + key updates existing
      const resUpdate = await saveMemory({
        workflowId,
        key: "auth-model",
        summary: "Uses OAuth2 PKCE + Biometric Passkeys",
        content: "Updated content with WebAuthn details",
        tags: ["auth", "security", "passkey"],
      });
      assertEquals(resUpdate.created, false);
      assertEquals(resUpdate.memory.id, resWf.memory.id);
      assertEquals(resUpdate.memory.summary, "Uses OAuth2 PKCE + Biometric Passkeys");

      // 5. Query by workflowId (project-wide)
      const projectMemories = await listMemories({ workflowId });
      assertEquals(projectMemories.length, 3);

      // 6. Query by nodeId
      const nodeMemories = await listMemories({ workflowId, nodeId: "step-parser" });
      assertEquals(nodeMemories.length, 1);
      assertEquals(nodeMemories[0].key, "edge-cases");

      // 7. Query by taskId
      const taskMemories = await listMemories({ taskId: "tk-dev-42" });
      assertEquals(taskMemories.length, 1);
      assertEquals(taskMemories[0].key, "db-schema");

      // 8. Filter by tags
      const tagged = await listMemories({ workflowId, tags: ["passkey"] });
      assertEquals(tagged.length, 1);
      assertEquals(tagged[0].key, "auth-model");

      // 9. Recall memory by key
      const recalled = await recallMemory({
        workflowId,
        key: "auth-model",
        accessedBy: "test-agent",
      });
      assert(recalled !== null);
      assertEquals(recalled.accessCount, 1);

      // Verify access log
      const logs = await getMemoryAccessLog(resWf.memory.id);
      assertEquals(logs.length, 1);
      assertEquals(logs[0].accessedBy, "test-agent");

      // 10. Delete memory
      const delRes = await deleteMemory({ id: resWf.memory.id });
      assertEquals(delRes.deleted, true);

      const afterDelete = await getMemory(resWf.memory.id);
      assertEquals(afterDelete, null);
    });
  } finally {
    kv.close();
  }
});
