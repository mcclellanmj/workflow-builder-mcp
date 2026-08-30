import { assert, assertEquals } from "@std/assert";
import { getMemory, setKv } from "../../store/kv.ts";
import { memorySaveTool } from "./memory_save.ts";
import { memorySearchTool } from "./memory_search.ts";
import type { Memory } from "../../store/types.ts";

Deno.test("Memory Search MCP Tool - Natural language query and telemetry tracking", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    // 1. Seed memories
    await memorySaveTool.execute({
      key: "vr-ground-plane-scaling",
      summary: "Ground plane scaling VR calibration procedure",
      content: "Ensure floor offset and tracking origin are calibrated for Quest 3 and Vision Pro.",
      scope: "workflow",
      workflowId: "wf-xr",
      tags: ["vr", "xr", "calibration", "scaling"],
    });

    await memorySaveTool.execute({
      key: "auth-oauth-pkce",
      summary: "OAuth 2.0 PKCE authentication flow",
      content: "Authorization code exchange using SHA-256 code challenge.",
      scope: "workflow",
      workflowId: "wf-auth",
      tags: ["auth", "security", "pkce"],
    });

    await memorySaveTool.execute({
      key: "db-connection-pool",
      summary: "PostgreSQL max connection pooling strategy",
      content: "Pool size set to 20 connections per container instance.",
      scope: "role",
      roleId: "dba",
      tags: ["database", "postgres"],
    });

    // 2. Perform natural language search
    const searchRes = await memorySearchTool.execute({
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

Deno.test("Memory Search MCP Tool - Scope and tag filtering", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    await memorySaveTool.execute({
      key: "wf1-cache",
      summary: "Redis cache invalidation",
      content: "TTL set to 300 seconds.",
      scope: "workflow",
      workflowId: "wf-1",
      tags: ["cache", "performance"],
    });

    await memorySaveTool.execute({
      key: "wf2-cache",
      summary: "Memcached cache invalidation",
      content: "TTL set to 600 seconds.",
      scope: "workflow",
      workflowId: "wf-2",
      tags: ["cache", "performance"],
    });

    await memorySaveTool.execute({
      key: "role-cache",
      summary: "Frontend HTTP cache headers",
      content: "Cache-Control: public, max-age=3600",
      scope: "role",
      roleId: "frontend-dev",
      tags: ["cache", "http"],
    });

    // Filter by workflowId
    const wfFilterRes = await memorySearchTool.execute({
      query: "cache",
      workflowId: "wf-1",
      format: "json",
    });
    assert(!wfFilterRes.isError);
    const wfData = JSON.parse(wfFilterRes.content[0].text);
    assertEquals(wfData.count, 1);
    assertEquals(wfData.hits[0].memory.key, "wf1-cache");

    // Filter by scope
    const scopeFilterRes = await memorySearchTool.execute({
      query: "cache",
      scope: "role",
      format: "json",
    });
    assert(!scopeFilterRes.isError);
    const scopeData = JSON.parse(scopeFilterRes.content[0].text);
    assertEquals(scopeData.count, 1);
    assertEquals(scopeData.hits[0].memory.key, "role-cache");

    // Filter by tags
    const tagFilterRes = await memorySearchTool.execute({
      query: "cache",
      tags: ["http"],
      format: "json",
    });
    assert(!tagFilterRes.isError);
    const tagData = JSON.parse(tagFilterRes.content[0].text);
    assertEquals(tagData.count, 1);
    assertEquals(tagData.hits[0].memory.key, "role-cache");
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
      key: "optimization-strategy",
      summary: "General guidelines",
      content: "Details about performance in general.",
      scope: "workflow",
      workflowId: "wf-boost",
      tags: ["engineering"],
    });

    // Memory B has 'optimization' only in content body (boost: 1)
    await memorySaveTool.execute({
      key: "general-architecture-doc",
      summary: "Overview of architecture",
      content: "Here we discuss database query optimization techniques in detail.",
      scope: "workflow",
      workflowId: "wf-boost",
      tags: ["engineering"],
    });

    const rankRes = await memorySearchTool.execute({
      query: "optimization",
      workflowId: "wf-boost",
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

Deno.test("Memory Search MCP Tool - Vector and hybrid search modes", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    // Insert memories with embeddings
    await memorySaveTool.execute({
      key: "semantic-audio-dsp",
      summary: "Audio digital signal processing",
      content: "Spatial audio rendering algorithms.",
      scope: "workflow",
      workflowId: "wf-dsp",
      tags: ["audio", "dsp"],
    });
    // Set embedding on memory
    const audioSearch = await memorySearchTool.execute({ query: "audio", format: "json" });
    const audioSearchData = JSON.parse(audioSearch.content[0].text);
    const audioMem = await getMemory(audioSearchData.hits[0].id);
    if (audioMem) {
      audioMem.embedding = [1.0, 0.0, 0.0];
      await kv.set(["users", audioMem.userId || "anonymous", "memories", audioMem.id], audioMem);
    }

    await memorySaveTool.execute({
      key: "semantic-shader-glsl",
      summary: "GLSL compute shader pipeline",
      content: "GPU vertex and fragment transforms.",
      scope: "workflow",
      workflowId: "wf-dsp",
      tags: ["graphics", "shader"],
    });
    const shaderKeyEntry = await kv.get<string>([
      "users",
      "anonymous",
      "memory_keys",
      "workflow",
      "wf-dsp",
      "semantic-shader-glsl",
    ]);
    if (shaderKeyEntry.value) {
      const memDoc =
        (await kv.get<Memory>(["users", "anonymous", "memories", shaderKeyEntry.value])).value;
      if (memDoc) {
        memDoc.embedding = [0.0, 1.0, 0.0];
        await kv.set(["users", "anonymous", "memories", shaderKeyEntry.value], memDoc);
      }
    }

    // Vector search
    const vectorRes = await memorySearchTool.execute({
      vector: [0.95, 0.05, 0.0],
      mode: "vector",
      format: "json",
    });
    assert(!vectorRes.isError);
    const vectorData = JSON.parse(vectorRes.content[0].text);
    assertEquals(vectorData.count, 1);
    assertEquals(vectorData.hits[0].memory.key, "semantic-audio-dsp");

    // Hybrid search
    const hybridRes = await memorySearchTool.execute({
      query: "audio",
      vector: [0.95, 0.05, 0.0],
      mode: "hybrid",
      format: "json",
    });
    assert(!hybridRes.isError);
    const hybridData = JSON.parse(hybridRes.content[0].text);
    assertEquals(hybridData.count, 1);
    assertEquals(hybridData.hits[0].memory.key, "semantic-audio-dsp");
  } finally {
    kv.close();
  }
});

Deno.test("Memory Search MCP Tool - Formats, threshold, limit, and validation error", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    await memorySaveTool.execute({
      key: "doc-1",
      summary: "First document on Kubernetes pod autoscaling",
      content: "HPA scaling configurations and metrics.",
      scope: "workflow",
      workflowId: "wf-k8s",
      tags: ["k8s", "scaling"],
    });

    await memorySaveTool.execute({
      key: "doc-2",
      summary: "Second document on Kubernetes ingress routing",
      content: "Nginx ingress controller rules and TLS certs.",
      scope: "workflow",
      workflowId: "wf-k8s",
      tags: ["k8s", "ingress"],
    });

    // 1. Markdown format
    const mdRes = await memorySearchTool.execute({
      query: "Kubernetes",
      format: "markdown",
    });
    assert(!mdRes.isError);
    assertEquals(mdRes.content.length, 1);
    const mdText = mdRes.content[0].text;
    assert(mdText.includes("## 🔍 Memory Search: `Kubernetes`"));
    assert(mdText.includes("| Score | Key | Scope | Target | Summary | Tags | Matched In |"));
    assert(mdText.includes("doc-1"));
    assert(mdText.includes("doc-2"));

    // 2. Both / rich format (default)
    const bothRes = await memorySearchTool.execute({
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
      query: "Kubernetes",
      limit: 1,
      format: "json",
    });
    const limitData = JSON.parse(limitRes.content[0].text);
    assertEquals(limitData.count, 1);

    // 4. Threshold
    const thresholdRes = await memorySearchTool.execute({
      query: "Kubernetes",
      threshold: 999.0, // Impossibly high threshold
      format: "json",
    });
    const thresholdData = JSON.parse(thresholdRes.content[0].text);
    assertEquals(thresholdData.count, 0);

    // 5. Validation error: neither query nor vector
    const emptyRes = await memorySearchTool.execute({
      format: "json",
    });
    assert(emptyRes.isError);
    assert(emptyRes.content[0].text.includes("Either 'query' or 'vector' must be provided"));
  } finally {
    kv.close();
  }
});
