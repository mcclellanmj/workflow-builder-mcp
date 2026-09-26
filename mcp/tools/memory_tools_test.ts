import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { setKv } from "../../store/kv.ts";
import { createWorkflowTool } from "./create_workflow.ts";
import { addNodeTool } from "./add_node.ts";
import { memorySaveTool } from "./memory_save.ts";
import { memorySearchTool } from "./memory_search.ts";
import { memoryRecallTool } from "./memory_recall.ts";
import { memoryDeleteTool } from "./memory_delete.ts";

Deno.test("Memory MCP Tools - Save across workflow, node, task and upsert", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    // 1. Workflow-level memory
    const saveWfRes = await memorySaveTool.execute({
      workflowId: "wf-alpha",
      key: "oauth-config",
      summary: "OAuth2 authentication standard",
      content: "All requests must include Bearer tokens issued by Auth0.",
      source: "security-auditor",
      tags: ["auth", "security"],
    });
    assert(!saveWfRes.isError, "memory_save for workflow failed");
    const saveWfData = JSON.parse(saveWfRes.content[0].text);
    assertEquals(saveWfData.created, true);
    assertEquals(saveWfData.action, "created");
    assertEquals(saveWfData.memory.key, "oauth-config");
    assertEquals(saveWfData.memory.workflowId, "wf-alpha");
    assertEquals(saveWfData.memory.summary, "OAuth2 authentication standard");
    assertEquals(
      saveWfData.memory.content,
      "All requests must include Bearer tokens issued by Auth0.",
    );

    // 2. Node-anchored memory
    const saveNodeRes = await memorySaveTool.execute({
      workflowId: "wf-alpha",
      nodeId: "step-fetch",
      key: "retry-policy",
      summary: "Exponential backoff on 503 errors",
      content: "Retry up to 5 times with initial delay of 200ms and jitter.",
      tags: ["network", "resilience"],
    });
    assert(!saveNodeRes.isError, "memory_save for node failed");
    const saveNodeData = JSON.parse(saveNodeRes.content[0].text);
    assertEquals(saveNodeData.created, true);
    assertEquals(saveNodeData.memory.workflowId, "wf-alpha");
    assertEquals(saveNodeData.memory.nodeId, "step-fetch");

    // 3. Task-anchored memory
    const saveTaskRes = await memorySaveTool.execute({
      workflowId: "wf-alpha",
      taskId: "tk-task-01",
      key: "coding-conventions",
      summary: "TypeScript strict mode & lint rules",
      content: "Ensure all exported functions have explicit return types and no any.",
      tags: ["standards", "typescript"],
    });
    assert(!saveTaskRes.isError, "memory_save for task failed");
    const saveTaskData = JSON.parse(saveTaskRes.content[0].text);
    assertEquals(saveTaskData.created, true);
    assertEquals(saveTaskData.memory.taskId, "tk-task-01");
    assertNotEquals(saveTaskData.memory.id, saveWfData.memory.id);

    // 4. Upsert behavior: update workflow memory with same key
    const updateWfRes = await memorySaveTool.execute({
      workflowId: "wf-alpha",
      key: "oauth-config",
      summary: "OAuth2 + PKCE authentication standard",
      content: "Updated: Bearer tokens issued by Auth0 with mandatory PKCE verification.",
      tags: ["auth", "security", "pkce"],
    });
    assert(!updateWfRes.isError, "memory_save upsert failed");
    const updateWfData = JSON.parse(updateWfRes.content[0].text);
    assertEquals(updateWfData.created, false);
    assertEquals(updateWfData.action, "updated");
    assertEquals(updateWfData.memory.id, saveWfData.memory.id);
    assertEquals(updateWfData.memory.summary, "OAuth2 + PKCE authentication standard");
    assertEquals(
      updateWfData.memory.content,
      "Updated: Bearer tokens issued by Auth0 with mandatory PKCE verification.",
    );
  } finally {
    kv.close();
  }
});

Deno.test("Memory MCP Tools - Listing memories via memory_search (short summaries only, no full content)", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    // Populate memories
    await memorySaveTool.execute({
      workflowId: "wf-orders",
      key: "db-schema",
      summary: "PostgreSQL multi-tenant schema isolation",
      content: "SUPER_SECRET_DATABASE_CREDENTIALS_AND_FULL_DDL_HERE",
      tags: ["database", "sql"],
    });

    await memorySaveTool.execute({
      workflowId: "wf-orders",
      key: "queue-config",
      summary: "RabbitMQ dead-letter exchange configuration",
      content: "SUPER_SECRET_QUEUE_PASSWORD_AND_DETAILED_TOPOLOGY_HERE",
      tags: ["queue", "rabbitmq"],
    });

    await memorySaveTool.execute({
      workflowId: "wf-orders",
      taskId: "tk-frontend-task",
      key: "style-guide",
      summary: "UI design system components",
      content: "FULL_DESIGN_SPEC_AND_TOKENS_HERE",
      tags: ["design", "ui"],
    });

    // 1. List with format: "json" (no query -> list mode)
    const listJsonRes = await memorySearchTool.execute({
      workflowId: "wf-orders",
      format: "json",
    });
    assert(!listJsonRes.isError);
    assertEquals(listJsonRes.content.length, 1);
    const listJsonData = JSON.parse(listJsonRes.content[0].text);
    assertEquals(listJsonData.count, 3);
    assertEquals(listJsonData.memories.length, 3);

    // CRITICAL REQUIREMENT: verify full content is NOT included in summary list!
    for (const mem of listJsonData.memories) {
      assertEquals(mem.content, undefined, "Memory summary must not include full content");
      assert(typeof mem.summary === "string", "Summary must be present");
      assertEquals(mem.accessCount, 0, "Initial accessCount must be 0");
      assertEquals(mem.lastAccessed, undefined, "Initial lastAccessed must be undefined");
    }

    // 2. List with format: "markdown"
    const listMdRes = await memorySearchTool.execute({
      workflowId: "wf-orders",
      format: "markdown",
    });
    assert(!listMdRes.isError);
    assertEquals(listMdRes.content.length, 1);
    const mdText = listMdRes.content[0].text;
    assert(mdText.includes("## 🧠 Memories for Workflow `wf-orders` (3 found)"));
    assert(mdText.includes("db-schema"));
    assert(mdText.includes("queue-config"));
    assert(mdText.includes("PostgreSQL multi-tenant schema isolation"));
    // Full content must NEVER leak into markdown list
    assert(!mdText.includes("SUPER_SECRET_DATABASE_CREDENTIALS"));
    assert(!mdText.includes("SUPER_SECRET_QUEUE_PASSWORD"));

    // 3. Tag filtering
    const tagRes = await memorySearchTool.execute({
      workflowId: "wf-orders",
      tags: ["database"],
      format: "json",
    });
    const tagData = JSON.parse(tagRes.content[0].text);
    assertEquals(tagData.count, 1);
    assertEquals(tagData.memories[0].key, "db-schema");
  } finally {
    kv.close();
  }
});

Deno.test("Memory MCP Tools - Recalling memory (returns full content & logs access)", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    const fullSecret =
      "DETAILED_RUNBOOK: Step 1 drain traffic, Step 2 apply schema migrations, Step 3 switch traffic.";
    await memorySaveTool.execute({
      workflowId: "wf-shipping",
      key: "deploy-runbook",
      summary: "Zero-downtime deployment procedure",
      content: fullSecret,
      tags: ["deploy", "ops"],
    });

    // 1. Initial list has accessCount: 0 and lastAccessed: undefined
    const preListRes = await memorySearchTool.execute({
      workflowId: "wf-shipping",
      format: "json",
    });
    const preListData = JSON.parse(preListRes.content[0].text);
    assertEquals(preListData.memories[0].accessCount, 0);
    assertEquals(preListData.memories[0].lastAccessed, undefined);

    // 2. Recall memory with tracking metadata
    const recallRes = await memoryRecallTool.execute({
      workflowId: "wf-shipping",
      key: "deploy-runbook",
      accessedBy: "orchestrator-agent",
      executionId: "exec-run-99",
      taskId: "task-deploy-01",
    });
    assert(!recallRes.isError, "memory_recall failed");
    const recallData = JSON.parse(recallRes.content[0].text);

    // Verify full content is returned
    assertEquals(recallData.memory.content, fullSecret);
    assertEquals(recallData.memory.key, "deploy-runbook");
    // Verify access tracking confirmation
    assertEquals(recallData.accessLogged, true);
    assertEquals(recallData.accessedBy, "orchestrator-agent");
    assertEquals(recallData.executionId, "exec-run-99");
    assertEquals(recallData.taskId, "task-deploy-01");

    // 3. Subsequent list now reflects the access!
    const postListRes = await memorySearchTool.execute({
      workflowId: "wf-shipping",
      format: "json",
    });
    const postListData = JSON.parse(postListRes.content[0].text);
    assertEquals(postListData.memories[0].accessCount, 1);
    assert(
      typeof postListData.memories[0].lastAccessed === "string" &&
        postListData.memories[0].lastAccessed.length > 0,
      "lastAccessed must be an ISO timestamp",
    );

    // 4. Second recall increments accessCount to 2
    await memoryRecallTool.execute({
      workflowId: "wf-shipping",
      key: "deploy-runbook",
      accessedBy: "agent-beta",
    });

    const secondListRes = await memorySearchTool.execute({
      workflowId: "wf-shipping",
      format: "json",
    });
    const secondListData = JSON.parse(secondListRes.content[0].text);
    assertEquals(secondListData.memories[0].accessCount, 2);

    // 5. Recalling non-existent memory returns an error
    const nonExistentRecall = await memoryRecallTool.execute({
      workflowId: "wf-shipping",
      key: "unknown-key",
    });
    assert(nonExistentRecall.isError, "Recalling non-existent memory should return error response");
  } finally {
    kv.close();
  }
});

Deno.test("Memory MCP Tools - Deleting memory with accessCount reporting and cleanup", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    await memorySaveTool.execute({
      workflowId: "wf-cache",
      key: "temp-cache-key",
      summary: "Temporary Redis cache key pattern",
      content: "cache:temp:v1:*",
    });

    // Recall twice to build access count
    await memoryRecallTool.execute({
      workflowId: "wf-cache",
      key: "temp-cache-key",
      accessedBy: "worker-1",
    });
    await memoryRecallTool.execute({
      workflowId: "wf-cache",
      key: "temp-cache-key",
      accessedBy: "worker-2",
    });

    // Delete memory
    const deleteRes = await memoryDeleteTool.execute({
      workflowId: "wf-cache",
      key: "temp-cache-key",
    });
    assert(!deleteRes.isError, "memory_delete failed");
    const deleteData = JSON.parse(deleteRes.content[0].text);
    assertEquals(deleteData.deleted, true);
    assertEquals(deleteData.accessCount, 2, "Must return total accessCount prior to deletion");
    assertEquals(deleteData.key, "temp-cache-key");

    // Subsequent list is empty
    const listRes = await memorySearchTool.execute({
      workflowId: "wf-cache",
      format: "json",
    });
    const listData = JSON.parse(listRes.content[0].text);
    assertEquals(listData.count, 0);
    assertEquals(listData.memories.length, 0);

    // Deleting again returns deleted: false and accessCount: 0
    const deleteAgainRes = await memoryDeleteTool.execute({
      workflowId: "wf-cache",
      key: "temp-cache-key",
    });
    assert(!deleteAgainRes.isError);
    const deleteAgainData = JSON.parse(deleteAgainRes.content[0].text);
    assertEquals(deleteAgainData.deleted, false);
    assertEquals(deleteAgainData.accessCount, 0);
  } finally {
    kv.close();
  }
});

Deno.test("Memory MCP Tools - Workflow and Node name/slug resolution integration", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    // 1. Create real workflow
    const wfRes = await createWorkflowTool.execute({
      name: "Payment Processing System",
      description: "Handles merchant checkout and refunds",
    });
    assert(!wfRes.isError);
    const { workflow: realWf } = JSON.parse(wfRes.content[0].text);

    // 2. Add real node
    const nodeRes = await addNodeTool.execute({
      workflowId: realWf.id,
      type: "step",
      name: "Authorize Card",
      description: "Authorizes card with processor",
    });
    assert(!nodeRes.isError);
    const realNode = JSON.parse(nodeRes.content[0].text);

    // 3. Save node memory using exact workflow name and node name
    const saveRes = await memorySaveTool.execute({
      workflowId: "Payment Processing System", // Resolves to realWf.id
      nodeId: "Authorize Card", // Resolves to realNode.id
      key: "gateway-timeout",
      summary: "30s gateway timeout behavior",
      content: "If processor does not respond in 30s, record status as timeout.",
    });
    assert(!saveRes.isError);
    const saveData = JSON.parse(saveRes.content[0].text);
    assertEquals(
      saveData.memory.workflowId,
      realWf.id,
      "Should resolve workflow name to actual UUID",
    );
    assertEquals(saveData.memory.nodeId, realNode.id, "Should resolve node name to actual UUID");

    // 4. Recall using slug
    const recallRes = await memoryRecallTool.execute({
      workflowId: "payment-processing-system", // Slug resolution
      nodeId: "authorize-card", // Slug resolution
      key: "gateway-timeout",
      accessedBy: "slug-tester",
    });
    assert(!recallRes.isError);
    const recallData = JSON.parse(recallRes.content[0].text);
    assertEquals(
      recallData.memory.content,
      "If processor does not respond in 30s, record status as timeout.",
    );
    assertEquals(recallData.accessLogged, true);
  } finally {
    kv.close();
  }
});
