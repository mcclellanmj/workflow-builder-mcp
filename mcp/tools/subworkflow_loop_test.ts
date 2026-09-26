import { assert, assertEquals } from "@std/assert";
import { setKv } from "../../store/kv.ts";
import { createWorkflowTool } from "./create_workflow.ts";
import { addNodeTool } from "./add_node.ts";
import { editNodeTool } from "./edit_node.ts";
import { connectNodesTool } from "./connect_nodes.ts";
import { visualizeWorkflowTool } from "./visualize_workflow.ts";

const parseJson = (
  res: { content: Array<{ type: string; text: string; annotations?: { audience?: string[] } }> },
) => {
  const item = res.content.find((c) => c.annotations?.audience?.includes("assistant")) ??
    res.content[res.content.length - 1];
  return JSON.parse(item.text);
};

Deno.test("Subworkflow - node creation, edit, and visualization", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    const wfRes = await createWorkflowTool.execute({
      name: "Parent Workflow",
      description: "Workflow with nested subworkflow",
    });
    const { workflow, startNode } = parseJson(wfRes);
    const workflowId = workflow.id;

    // Add subworkflow node
    const addSubRes = await addNodeTool.execute({
      workflowId,
      type: "subworkflow",
      name: "Run Child Workflow",
      description: "Executes child review workflow",
      config: { childWorkflowId: "child-wf-999" },
    });
    assert(!addSubRes.isError);
    const subNode = parseJson(addSubRes);
    assertEquals(subNode.type, "subworkflow");
    assertEquals(subNode.config.childWorkflowId, "child-wf-999");

    const addEndRes = await addNodeTool.execute({
      workflowId,
      type: "end",
      name: "Parent End",
      description: "Complete",
    });
    const endNode = parseJson(addEndRes);

    await connectNodesTool.execute({ workflowId, fromNodeId: startNode.id, toNodeId: subNode.id });
    await connectNodesTool.execute({ workflowId, fromNodeId: subNode.id, toNodeId: endNode.id });

    // Edit subworkflow node
    const editRes = await editNodeTool.execute({
      workflowId,
      nodeId: subNode.id,
      config: { childWorkflowId: "child-wf-updated" },
    });
    assert(!editRes.isError);
    const editedNode = parseJson(editRes);
    assertEquals(editedNode.config.childWorkflowId, "child-wf-updated");

    // Visualize workflow without executionId (template view)
    const visRes = await visualizeWorkflowTool.execute({ workflowId });
    assert(!visRes.isError);
    assert(visRes.content[0].text.includes('["⏳ Run Child Workflow 📦"]'));
  } finally {
    kv.close();
  }
});
