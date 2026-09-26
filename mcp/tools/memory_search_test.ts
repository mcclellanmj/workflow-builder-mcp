import { assert, assertEquals } from "@std/assert";
import { getMemory, setKv } from "../../store/kv.ts";
import { memorySaveTool } from "./memory_save.ts";
import { memorySearchTool } from "./memory_search.ts";

Deno.test("Memory Search MCP Tool - Natural language query and telemetry tracking", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    // 1. Seed memories
    await memorySaveTool.execute({
      workflowId: "wf-xr",
      key: "vr-ground-plane-scaling",
      summary: "Ground plane scaling VR calibration procedure",
      content: "Ensure floor offset and tracking origin are calibrated for Quest 3 and Vision Pro.",
      tags: ["vr", "xr", "calibration", "scaling"],
    });

    await memorySaveTool.execute({
      workflowId: "wf-xr",
      key: "auth-oauth-pkce",
      summary: "OAuth 2.0 PKCE authentication flow",
      content: "Authorization code exchange using SHA-256 code challenge.",
      tags: ["auth", "security", "pkce"],
    });

    // 2. Perform natural language search
    const searchRes = await memorySearchTool.execute({
      workflowId: "wf-xr",
      query: "ground plane scaling VR",
      format: "json",
    });

    assert(!searchRes.isError, "memory_search should succeed");
    const searchData = JSON.parse(searchRes.content[0].text);

    assertEquals(searchData.count, 1);
    assertEquals(searchData.hits[0].memory.key, "vr-ground-plane-scaling");
    assert(searchData.hits[0].score > 0, "Score should be positive");
    assert(
      searchData.hits[0].matchedFields.includes("summary") ||
        searchData.hits[0].matchedFields.includes("key"),
    );

    // 3. Verify telemetry: memory access telemetry was logged
    const accessedMem = await getMemory(searchData.hits[0].memory.id);
    assert(accessedMem !== null);
    assertEquals(accessedMem.accessCount, 1, "accessCount must be incremented by search telemetry");
    assert(typeof accessedMem.lastAccessed === "string" && accessedMem.lastAccessed.length > 0);
  } finally {
    kv.close();
  }
});

Deno.test("Memory Search MCP Tool - Node and tag filtering", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    await memorySaveTool.execute({
      workflowId: "wf-1",
      nodeId: "step-1",
      key: "wf1-cache",
      summary: "Redis cache invalidation",
      content: "TTL set to 300 seconds.",
      tags: ["cache", "performance"],
    });

    await memorySaveTool.execute({
      workflowId: "wf-1",
      nodeId: "step-2",
      key: "wf1-db",
      summary: "Memcached cache invalidation",
      content: "TTL set to 600 seconds.",
      tags: ["cache", "database"],
    });

    // Filter by nodeId
    const nodeFilterRes = await memorySearchTool.execute({
      workflowId: "wf-1",
      nodeId: "step-1",
      query: "cache",
      format: "json",
    });
    assert(!nodeFilterRes.isError);
    const nodeData = JSON.parse(nodeFilterRes.content[0].text);
    assertEquals(nodeData.count, 1);
    assertEquals(nodeData.hits[0].memory.key, "wf1-cache");

    // Filter by tags
    const tagFilterRes = await memorySearchTool.execute({
      workflowId: "wf-1",
      query: "cache",
      tags: ["database"],
      format: "json",
    });
    assert(!tagFilterRes.isError);
    const tagData = JSON.parse(tagFilterRes.content[0].text);
    assertEquals(tagData.count, 1);
    assertEquals(tagData.hits[0].memory.key, "wf1-db");
  } finally {
    kv.close();
  }
});

Deno.test("Memory Search MCP Tool - Keyword boosting and ranking", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    // Memory A has 'optimization' in the key (boost: 3)
    await memorySaveTool.execute({
      workflowId: "wf-boost",
      key: "optimization-strategy",
      summary: "General guidelines",
      content: "Details about performance in general.",
      tags: ["engineering"],
    });

    // Memory B has 'optimization' only in content body (boost: 1)
    await memorySaveTool.execute({
      workflowId: "wf-boost",
      key: "general-architecture-doc",
      summary: "Overview of architecture",
      content: "Here we discuss database query optimization techniques in detail.",
      tags: ["engineering"],
    });

    const rankRes = await memorySearchTool.execute({
      workflowId: "wf-boost",
      query: "optimization",
      format: "json",
    });

    assert(!rankRes.isError);
    const rankData = JSON.parse(rankRes.content[0].text);
    assertEquals(rankData.count, 2);
    assertEquals(
      rankData.hits[0].memory.key,
      "optimization-strategy",
      "Key match should rank higher due to key: 3 boost",
    );
    assertEquals(rankData.hits[1].memory.key, "general-architecture-doc");
    assert(
      rankData.hits[0].score > rankData.hits[1].score,
      "Top hit should have strictly higher BM25 score",
    );
  } finally {
    kv.close();
  }
});

Deno.test("Memory Search MCP Tool - Formats, threshold, limit, and listing mode", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    await memorySaveTool.execute({
      workflowId: "wf-k8s",
      key: "doc-1",
      summary: "First document on Kubernetes pod autoscaling",
      content: "HPA scaling configurations and metrics.",
      tags: ["k8s", "scaling"],
    });

    await memorySaveTool.execute({
      workflowId: "wf-k8s",
      key: "doc-2",
      summary: "Second document on Kubernetes ingress routing",
      content: "Nginx ingress controller rules and TLS certs.",
      tags: ["k8s", "ingress"],
    });

    // 1. Markdown format search
    const mdRes = await memorySearchTool.execute({
      workflowId: "wf-k8s",
      query: "Kubernetes",
      format: "markdown",
    });
    assert(!mdRes.isError);
    assertEquals(mdRes.content.length, 1);
    const mdText = mdRes.content[0].text;
    assert(mdText.includes("## 🔍 Memory Search: `Kubernetes`"));
    assert(mdText.includes("doc-1"));
    assert(mdText.includes("doc-2"));

    // 2. Both / rich format (default)
    const bothRes = await memorySearchTool.execute({
      workflowId: "wf-k8s",
      query: "Kubernetes",
      format: "both",
    });
    assert(!bothRes.isError);
    assertEquals(bothRes.content.length, 2);
    assert(bothRes.content[0].text.includes("## 🔍 Memory Search"));
    const jsonBlock = JSON.parse(bothRes.content[1].text);
    assertEquals(jsonBlock.count, 2);

    // 3. Limit
    const limitRes = await memorySearchTool.execute({
      workflowId: "wf-k8s",
      query: "Kubernetes",
      limit: 1,
      format: "json",
    });
    const limitData = JSON.parse(limitRes.content[0].text);
    assertEquals(limitData.count, 1);

    // 4. Threshold
    const thresholdRes = await memorySearchTool.execute({
      workflowId: "wf-k8s",
      query: "Kubernetes",
      threshold: 999.0, // Impossibly high threshold
      format: "json",
    });
    const thresholdData = JSON.parse(thresholdRes.content[0].text);
    assertEquals(thresholdData.count, 0);

    // 5. Listing mode (no query -> list mode consolidating memory_list)
    const listRes = await memorySearchTool.execute({
      workflowId: "wf-k8s",
      format: "json",
    });
    assert(!listRes.isError);
    const listData = JSON.parse(listRes.content[0].text);
    assertEquals(listData.count, 2);
    assertEquals(listData.memories.length, 2);
  } finally {
    kv.close();
  }
});
