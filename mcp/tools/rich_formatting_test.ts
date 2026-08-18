import { assert, assertEquals } from "@std/assert";
import { setKv } from "../../store/kv.ts";
import { createWorkflowTool } from "./create_workflow.ts";
import { addNodeTool } from "./add_node.ts";
import { connectNodesTool } from "./connect_nodes.ts";
import { startWorkflowTool } from "./start_workflow.ts";
import { getNextStepTool } from "./get_next_step.ts";
import { listWorkflowsTool } from "./list_workflows.ts";
import { listNodesTool } from "./list_nodes.ts";

Deno.test("Rich Formatting - Format Modes and MCP Annotations", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    // 1. Create workflow
    const createRes = await createWorkflowTool.execute({
      name: "Formatting Pipeline",
      description: "Tests markdown, json, and both modes",
    });
    assert(!createRes.isError);
    const { workflow, startNode } = JSON.parse(createRes.content[0].text);
    const workflowId = workflow.id;

    // 2. Add step and end nodes
    const addStepRes = await addNodeTool.execute({
      workflowId,
      type: "step",
      name: "Process Data",
      description: "Transform and filter records",
    });
    const stepNode = JSON.parse(addStepRes.content[0].text);

    const addEndRes = await addNodeTool.execute({
      workflowId,
      type: "end",
      name: "Done",
      description: "End of workflow",
    });
    const endNode = JSON.parse(addEndRes.content[0].text);

    await connectNodesTool.execute({ workflowId, fromNodeId: startNode.id, toNodeId: stepNode.id });
    await connectNodesTool.execute({ workflowId, fromNodeId: stepNode.id, toNodeId: endNode.id });

    // 3. Test workflow_start with format: "markdown"
    const startMdRes = await startWorkflowTool.execute({ workflowId, format: "markdown" });
    assert(!startMdRes.isError);
    assertEquals(startMdRes.content.length, 1);
    assert(startMdRes.content[0].text.includes("## 🚀 Workflow Started: **Formatting Pipeline**"));
    assert(startMdRes.content[0].text.includes("```mermaid\nflowchart TD"));
    // executionId should appear in markdown
    assert(startMdRes.content[0].text.includes("**Execution ID**"));

    // 4. Test workflow_start with format: "json"
    const startJsonRes = await startWorkflowTool.execute({ workflowId, format: "json" });
    assert(!startJsonRes.isError);
    assertEquals(startJsonRes.content.length, 1);
    const parsedStartJson = JSON.parse(startJsonRes.content[0].text);
    assertEquals(parsedStartJson.workflowId, workflowId);
    assertEquals(parsedStartJson.workflowName, "Formatting Pipeline");
    assert(typeof parsedStartJson.executionId === "string");

    // 5. Test workflow_start with default format ("both")
    const startBothRes = await startWorkflowTool.execute({ workflowId });
    assert(!startBothRes.isError);
    assertEquals(startBothRes.content.length, 3);

    // Block 1: Markdown (user audience)
    assertEquals(startBothRes.content[0].annotations?.audience, ["user"]);
    assert(startBothRes.content[0].text.includes("## 🚀 Workflow Started:"));

    // Block 2: Mermaid diagram (user audience)
    assertEquals(startBothRes.content[1].annotations?.audience, ["user"]);
    assert(startBothRes.content[1].text.includes("```mermaid\nflowchart TD"));

    // Block 3: JSON data (assistant audience)
    assertEquals(startBothRes.content[2].annotations?.audience, ["assistant"]);
    const parsedBothJson = JSON.parse(startBothRes.content[2].text);
    assertEquals(parsedBothJson.workflowId, workflowId);
    const executionId = parsedBothJson.executionId;
    assert(typeof executionId === "string" && executionId.length > 0);

    // 6. Test workflow_next with format: "markdown" (using executionId)
    const nextMdRes = await getNextStepTool.execute({
      executionId,
      nodeId: stepNode.id,
      status: "completed",
      format: "markdown",
    });
    assert(!nextMdRes.isError);
    assertEquals(nextMdRes.content.length, 1);
    assert(nextMdRes.content[0].text.includes("## ⚡ Workflow Progress:"));
    assert(nextMdRes.content[0].text.includes("🎉 Workflow Complete!"));
    // executionId should appear in markdown
    assert(nextMdRes.content[0].text.includes("**Execution ID**"));

    // 7. Test workflow_list and node_list formatting
    const listWfMd = await listWorkflowsTool.execute({ format: "markdown" });
    assert(!listWfMd.isError);
    assert(listWfMd.content[0].text.includes("| Workflow Name | ID | Type | Description |"));
    assert(listWfMd.content[0].text.includes("Formatting Pipeline"));

    const listNodesMd = await listNodesTool.execute({ workflowId, format: "markdown" });
    assert(!listNodesMd.isError);
    assert(listNodesMd.content[0].text.includes("| Node Name | Type | Status | Iteration |"));
    assert(listNodesMd.content[0].text.includes("Process Data"));
  } finally {
    kv.close();
  }
});
