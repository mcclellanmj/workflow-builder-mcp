import { assert, assertEquals } from "@std/assert";
import { setKv } from "../../store/kv.ts";
import { createWorkflowTool } from "./create_workflow.ts";
import { addNodeTool } from "./add_node.ts";
import { connectNodesTool } from "./connect_nodes.ts";
import { workflowHydrateTool } from "./hydrate_workflow.ts";
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

    // 3. Test workflow_hydrate with format: "markdown"
    const hydrateMdRes = await workflowHydrateTool.execute({ workflowId, format: "markdown" });
    assert(!hydrateMdRes.isError);
    assertEquals(hydrateMdRes.content.length, 1);
    assert(
      hydrateMdRes.content[0].text.includes(
        "## 🚀 Workflow Hydrated into Epic: **Formatting Pipeline**",
      ),
    );
    assert(hydrateMdRes.content[0].text.includes("Process Data"));

    // 4. Test workflow_hydrate with format: "json"
    const hydrateJsonRes = await workflowHydrateTool.execute({ workflowId, format: "json" });
    assert(!hydrateJsonRes.isError);
    assertEquals(hydrateJsonRes.content.length, 1);
    const parsedJson = JSON.parse(hydrateJsonRes.content[0].text);
    assertEquals(parsedJson.epic.workflowId, workflowId);
    assertEquals(parsedJson.summary.totalTasks, 1);
    assertEquals(parsedJson.readyTasks.length, 1);

    // 5. Test workflow_hydrate with default format ("both") - returns markdown (user) and json (assistant)
    const hydrateBothRes = await workflowHydrateTool.execute({ workflowId });
    assert(!hydrateBothRes.isError);
    assertEquals(hydrateBothRes.content.length, 2);

    // Block 1: Markdown (user audience)
    assertEquals(hydrateBothRes.content[0].annotations?.audience, ["user"]);
    assert(hydrateBothRes.content[0].text.includes("## 🚀 Workflow Hydrated into Epic:"));

    // Block 2: JSON data (assistant audience)
    assertEquals(hydrateBothRes.content[1].annotations?.audience, ["assistant"]);
    const parsedBothJson = JSON.parse(hydrateBothRes.content[1].text);
    assertEquals(parsedBothJson.epic.workflowId, workflowId);
    assert(typeof parsedBothJson.epic.id === "string" && parsedBothJson.epic.id.startsWith("tk-"));

    // 6. Test workflow_list and node_list formatting
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

Deno.test("Rich Formatting - Sub-Agent Roles in workflow_hydrate", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    const createRes = await createWorkflowTool.execute({
      name: "Subagent Test Flow",
      description: "Tests sub-agent instruction and role assignment",
    });
    const { workflow, startNode } = JSON.parse(createRes.content[0].text);
    const workflowId = workflow.id;

    const stepRes = await addNodeTool.execute({
      workflowId,
      type: "step",
      name: "Deep Analysis",
      description: "Analyze entire codebase for performance bottlenecks",
      runInSubAgent: true,
    });
    const stepNode = JSON.parse(stepRes.content[0].text);

    const endRes = await addNodeTool.execute({
      workflowId,
      type: "end",
      name: "Complete",
      description: "End",
    });
    const endNode = JSON.parse(endRes.content[0].text);

    await connectNodesTool.execute({ workflowId, fromNodeId: startNode.id, toNodeId: stepNode.id });
    await connectNodesTool.execute({ workflowId, fromNodeId: stepNode.id, toNodeId: endNode.id });

    // Verify workflow_hydrate assigns 'subagent' role when runInSubAgent is true
    const hydrateRes = await workflowHydrateTool.execute({ workflowId, format: "json" });
    assert(!hydrateRes.isError);
    const hydrateData = JSON.parse(hydrateRes.content[0].text);
    assertEquals(hydrateData.tasks.length, 1);
    assertEquals(hydrateData.tasks[0].title, "Deep Analysis");
    assertEquals(hydrateData.tasks[0].role, "subagent");
  } finally {
    kv.close();
  }
});
