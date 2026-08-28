import { assert, assertEquals } from "@std/assert";
import { setKv } from "../../store/kv.ts";
import { createWorkflowTool } from "./create_workflow.ts";
import { addNodeTool } from "./add_node.ts";
import { editNodeTool } from "./edit_node.ts";
import { connectNodesTool } from "./connect_nodes.ts";
import { workflowHydrateTool } from "./hydrate_workflow.ts";
import { visualizeWorkflowTool } from "./visualize_workflow.ts";
import { closeTaskTool } from "./task_close.ts";
import { readyTasksTool } from "./task_ready.ts";

const parseJson = (
  res: { content: Array<{ type: string; text: string; annotations?: { audience?: string[] } }> },
) => {
  const item = res.content.find((c) => c.annotations?.audience?.includes("assistant")) ??
    res.content[res.content.length - 1];
  return JSON.parse(item.text);
};

Deno.test("Subworkflow and Gated Looping - Review-Fix Loop Hydration Lifecycle", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    // 1. Create a parent workflow
    const wfRes = await createWorkflowTool.execute({
      name: "Review & Fix Looping Workflow",
      description: "Demonstrates loops until review score is high enough",
    });
    assert(!wfRes.isError);
    const { workflow, startNode } = parseJson(wfRes);
    const workflowId = workflow.id;

    // 2. Add nodes: Review (step) -> Decision (Score Check) -> Fix (step) -> End (end)
    const reviewNode = parseJson(
      await addNodeTool.execute({
        workflowId,
        type: "step",
        name: "Review Code",
        description: "Review pull request and score out of 100",
        config: { maxIterations: 5 },
      }),
    );

    const decisionNode = parseJson(
      await addNodeTool.execute({
        workflowId,
        type: "decision",
        name: "Score Check",
        description: "Pass if score >= 80, otherwise fix",
        config: { options: ["needs fix", "approved"] },
      }),
    );

    const fixNode = parseJson(
      await addNodeTool.execute({
        workflowId,
        type: "step",
        name: "Fix Issues",
        description: "Apply corrections based on review feedback",
      }),
    );

    const endNode = parseJson(
      await addNodeTool.execute({
        workflowId,
        type: "end",
        name: "Approved & Deployed",
        description: "Review passed, merge and deploy",
      }),
    );

    // 3. Connect nodes
    await connectNodesTool.execute({
      workflowId,
      fromNodeId: startNode.id,
      toNodeId: reviewNode.id,
    });
    await connectNodesTool.execute({
      workflowId,
      fromNodeId: reviewNode.id,
      toNodeId: decisionNode.id,
    });
    await connectNodesTool.execute({
      workflowId,
      fromNodeId: decisionNode.id,
      toNodeId: fixNode.id,
      condition: "needs fix",
    });
    // Loop back-edge: Fix -> Review
    await connectNodesTool.execute({
      workflowId,
      fromNodeId: fixNode.id,
      toNodeId: reviewNode.id,
    });
    await connectNodesTool.execute({
      workflowId,
      fromNodeId: decisionNode.id,
      toNodeId: endNode.id,
      condition: "approved",
    });

    // 4. Hydrate workflow into Epic and Task DAG
    const hydrateRes = await workflowHydrateTool.execute({ workflowId });
    assert(!hydrateRes.isError);
    const hydrateData = parseJson(hydrateRes);

    assertEquals(hydrateData.epic.type, "epic");
    assertEquals(hydrateData.tasks.length, 3); // Review Code, Score Check, Fix Issues
    // Verify Review Code is immediately ready in ready frontier (no deadlock from back-edge)
    assertEquals(hydrateData.readyTasks.length, 1);
    assertEquals(hydrateData.readyTasks[0].title, "Review Code");

    const reviewTask = hydrateData.tasks.find((t: { title: string }) => t.title === "Review Code");
    const decisionTask = hydrateData.tasks.find((t: { title: string }) =>
      t.title === "Score Check"
    );
    const fixTask = hydrateData.tasks.find((t: { title: string }) => t.title === "Fix Issues");
    assert(reviewTask && decisionTask && fixTask);

    // 5. Close Review Code -> Unblocks Score Check
    const closeReview = parseJson(await closeTaskTool.execute({ task: reviewTask.id }));
    assertEquals(closeReview.unblockedTasks.length, 1);
    assertEquals(closeReview.unblockedTasks[0].id, decisionTask.id);

    // Verify Score Check is in ready frontier
    const ready2 = parseJson(await readyTasksTool.execute({ workflowId }));
    assertEquals(ready2.frontierSize, 1);
    assertEquals(ready2.readyTasks[0].id, decisionTask.id);

    // 6. Close Score Check -> Unblocks Fix Issues
    const closeDec = parseJson(await closeTaskTool.execute({ task: decisionTask.id }));
    assertEquals(closeDec.unblockedTasks.length, 1);
    assertEquals(closeDec.unblockedTasks[0].id, fixTask.id);
  } finally {
    kv.close();
  }
});

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
    assert(visRes.content[0].text.includes('["⏳ Run Child Workflow 📦"]]'));
  } finally {
    kv.close();
  }
});
