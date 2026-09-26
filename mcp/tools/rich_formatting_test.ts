import { assert, assertEquals } from "@std/assert";
import { setKv } from "../../store/kv.ts";
import { createWorkflowTool } from "./create_workflow.ts";
import { addNodeTool } from "./add_node.ts";
import { connectNodesTool } from "./connect_nodes.ts";
import { listWorkflowsTool } from "./list_workflows.ts";
import { listNodesTool } from "./list_nodes.ts";
import { listTasksTool } from "./task_list.ts";
import { createTaskTool } from "./task_create.ts";

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

    // 3. Create a task linked to this workflow
    await createTaskTool.execute({
      title: "Run Process Data",
      originWorkflowId: workflowId,
      role: "developer",
    });

    // 4. Test task_list with format: "markdown"
    const taskMdRes = await listTasksTool.execute({ workflowId, format: "markdown" });
    assert(!taskMdRes.isError);
    assertEquals(taskMdRes.content.length, 1);
    assert(taskMdRes.content[0].text.includes("### Tasks (1 total)"));
    assert(taskMdRes.content[0].text.includes("Run Process Data"));

    // 5. Test task_list with format: "json"
    const taskJsonRes = await listTasksTool.execute({ workflowId, format: "json" });
    assert(!taskJsonRes.isError);
    assertEquals(taskJsonRes.content.length, 1);
    const parsedJson = JSON.parse(taskJsonRes.content[0].text);
    assertEquals(parsedJson.tasks.length, 1);
    assertEquals(parsedJson.summary.total, 1);

    // 6. Test task_list with default format ("both") - returns markdown (user) and json (assistant)
    const taskBothRes = await listTasksTool.execute({ workflowId });
    assert(!taskBothRes.isError);
    assertEquals(taskBothRes.content.length, 2);

    // Block 1: Markdown (user audience)
    assertEquals(taskBothRes.content[0].annotations?.audience, ["user"]);
    assert(taskBothRes.content[0].text.includes("### Tasks (1 total)"));

    // Block 2: JSON data (assistant audience)
    assertEquals(taskBothRes.content[1].annotations?.audience, ["assistant"]);
    const parsedBothJson = JSON.parse(taskBothRes.content[1].text);
    assertEquals(parsedBothJson.tasks.length, 1);

    // 7. Test workflow_list and node_list formatting
    const listWfMd = await listWorkflowsTool.execute({ format: "markdown" });
    assert(!listWfMd.isError);
    assert(listWfMd.content[0].text.includes("| Workflow Name | ID | Type | Description |"));
    assert(listWfMd.content[0].text.includes("Formatting Pipeline"));

    const listNodesMd = await listNodesTool.execute({ workflowId, format: "markdown" });
    assert(!listNodesMd.isError);
    assert(listNodesMd.content[0].text.includes("Process Data"));
  } finally {
    kv.close();
  }
});
