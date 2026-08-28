import { assert, assertEquals } from "@std/assert";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { createMcpServer } from "./server.ts";
import { setKv } from "./store/kv.ts";

Deno.test("McpServer integration test with client over InMemoryTransport", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    const server = createMcpServer();
    const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    // 1. List tools
    const toolList = await client.listTools();
    assert(toolList.tools.length >= 16, "Expected at least 16 tools registered");
    const toolNames = toolList.tools.map((t: { name: string }) => t.name);
    assert(toolNames.includes("workflow_create"));
    assert(toolNames.includes("workflow_list"));
    assert(toolNames.includes("workflow_get"));
    assert(toolNames.includes("workflow_delete"));
    assert(toolNames.includes("node_add"));
    assert(toolNames.includes("node_edit"));
    assert(toolNames.includes("node_delete"));
    assert(toolNames.includes("node_get"));
    assert(toolNames.includes("node_list"));
    assert(toolNames.includes("node_connect"));
    assert(toolNames.includes("node_disconnect"));
    assert(toolNames.includes("workflow_hydrate"));
    assert(toolNames.includes("workflow_validate"));
    assert(toolNames.includes("workflow_visualize"));
    assert(toolNames.includes("task_ready"));
    assert(toolNames.includes("task_claim"));
    assert(toolNames.includes("task_close"));

    // 2. Call workflow_create via client
    const createRes = await client.callTool({
      name: "workflow_create",
      arguments: { name: "Client Test Workflow", description: "Created via MCP client" },
    });
    assert(!createRes.isError);
    const content = createRes.content as Array<{ type: string; text: string }>;
    const createdData = JSON.parse(content[0].text);
    assertEquals(createdData.workflow.name, "Client Test Workflow");

    // 3. Call workflow_list via client without args
    const listRes = await client.callTool({
      name: "workflow_list",
    });
    assert(!listRes.isError);
    const listContent = listRes.content as Array<
      { type: string; text: string; annotations?: { audience?: string[] } }
    >;
    assertEquals(listContent.length, 2); // Markdown block for user, JSON block for assistant
    const jsonItem = listContent.find((c) => c.annotations?.audience?.includes("assistant")) ??
      listContent[1];
    const listData = JSON.parse(jsonItem.text);
    assertEquals(listData.length, 1);
    assertEquals(listData[0].id, createdData.workflow.id);

    await client.close();
    await server.close();
  } finally {
    kv.close();
  }
});
