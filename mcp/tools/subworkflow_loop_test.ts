import { assert, assertEquals } from "@std/assert";
import { setKv } from "../../store/kv.ts";
import { createWorkflowTool } from "./create_workflow.ts";
import { addNodeTool } from "./add_node.ts";
import { editNodeTool } from "./edit_node.ts";
import { connectNodesTool } from "./connect_nodes.ts";
import { startWorkflowTool } from "./start_workflow.ts";
import { getNextStepTool } from "./get_next_step.ts";
import { getNodeTool } from "./get_node.ts";
import { resetWorkflowTool } from "./reset_workflow.ts";
import { visualizeWorkflowTool } from "./visualize_workflow.ts";

Deno.test("Subworkflow and Gated Looping - Review-Fix Loop Lifecycle", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    // 1. Create a parent workflow
    const wfRes = await createWorkflowTool.execute({
      name: "Review & Fix Looping Workflow",
      description: "Demonstrates loops until review score is high enough",
    });
    assert(!wfRes.isError);
    const { workflow, startNode } = JSON.parse(wfRes.content[0].text);
    const workflowId = workflow.id;

    // 2. Add nodes: Review (step) -> Decision (Score Check) -> Fix (step) -> End (end)
    const addReviewRes = await addNodeTool.execute({
      workflowId,
      type: "step",
      name: "Review Code",
      description: "Review pull request and score out of 100",
      config: { maxIterations: 5 },
    });
    assert(!addReviewRes.isError);
    const reviewNode = JSON.parse(addReviewRes.content[0].text);

    const addDecisionRes = await addNodeTool.execute({
      workflowId,
      type: "decision",
      name: "Score Check",
      description: "Pass if score >= 80, otherwise fix",
      config: { options: ["needs fix", "approved"] },
    });
    assert(!addDecisionRes.isError);
    const decisionNode = JSON.parse(addDecisionRes.content[0].text);

    const addFixRes = await addNodeTool.execute({
      workflowId,
      type: "step",
      name: "Fix Issues",
      description: "Apply corrections based on review feedback",
    });
    assert(!addFixRes.isError);
    const fixNode = JSON.parse(addFixRes.content[0].text);

    const addEndRes = await addNodeTool.execute({
      workflowId,
      type: "end",
      name: "Approved & Deployed",
      description: "Review passed, merge and deploy",
    });
    assert(!addEndRes.isError);
    const endNode = JSON.parse(addEndRes.content[0].text);

    // 3. Connect nodes
    // Start -> Review
    await connectNodesTool.execute({
      workflowId,
      fromNodeId: startNode.id,
      toNodeId: reviewNode.id,
    });
    // Review -> Decision
    await connectNodesTool.execute({
      workflowId,
      fromNodeId: reviewNode.id,
      toNodeId: decisionNode.id,
    });
    // Decision -> Fix (needs fix)
    await connectNodesTool.execute({
      workflowId,
      fromNodeId: decisionNode.id,
      toNodeId: fixNode.id,
      condition: "needs fix",
    });
    // Fix -> Review (loop back-edge)
    const loopConn = await connectNodesTool.execute({
      workflowId,
      fromNodeId: fixNode.id,
      toNodeId: reviewNode.id,
    });
    assert(!loopConn.isError);
    const loopConnData = JSON.parse(loopConn.content[0].text);
    assert(loopConnData.warning?.includes("feedback loop"));

    // Decision -> End (approved)
    await connectNodesTool.execute({
      workflowId,
      fromNodeId: decisionNode.id,
      toNodeId: endNode.id,
      condition: "approved",
    });

    const parseResponseJson = (
      res: {
        content: Array<{ type: string; text: string; annotations?: { audience?: string[] } }>;
      },
    ) => {
      const jsonItem = res.content.find((c) => c.annotations?.audience?.includes("assistant")) ??
        res.content[res.content.length - 1];
      return JSON.parse(jsonItem.text);
    };

    // 4. Start workflow -> Next node should be "Review Code" (iteration 1)
    const startRes = await startWorkflowTool.execute({ workflowId });
    assert(!startRes.isError);
    const startData = parseResponseJson(startRes);
    assertEquals(startData.nextNodes.length, 1);
    assertEquals(startData.nextNodes[0].id, reviewNode.id);
    assertEquals(startData.nextNodes[0].iteration, 1);

    const executionId = startData.executionId;
    assert(typeof executionId === "string" && executionId.length > 0);

    // 5. Iteration 1: Review completes -> Decision "needs fix"
    const next1 = await getNextStepTool.execute({
      executionId,
      nodeId: reviewNode.id,
      status: "completed",
    });
    assert(!next1.isError);
    const next1Data = parseResponseJson(next1);
    assertEquals(next1Data.nextNodes.length, 1);
    assertEquals(next1Data.nextNodes[0].id, decisionNode.id);

    // Decision selects "needs fix" -> Next step is Fix
    const next2 = await getNextStepTool.execute({
      executionId,
      nodeId: decisionNode.id,
      status: "completed",
      decision: "needs fix",
    });
    assert(!next2.isError);
    const next2Data = parseResponseJson(next2);
    assertEquals(next2Data.nextNodes.length, 1);
    assertEquals(next2Data.nextNodes[0].id, fixNode.id);

    // Fix completes -> Loops back to Review (Iteration 2)
    const next3 = await getNextStepTool.execute({
      executionId,
      nodeId: fixNode.id,
      status: "completed",
    });
    assert(!next3.isError);
    const next3Data = parseResponseJson(next3);
    assertEquals(next3Data.nextNodes.length, 1);
    assertEquals(next3Data.nextNodes[0].id, reviewNode.id);
    assertEquals(next3Data.nextNodes[0].iteration, 2);

    // Verify Review node iteration history via get_node (with executionId)
    const getRevRes = await getNodeTool.execute({ workflowId, nodeId: reviewNode.id, executionId });
    const revNodeData = JSON.parse(getRevRes.content[0].text);
    assertEquals(revNodeData.iteration, 2);
    assertEquals(revNodeData.iterationHistory?.length, 1);
    assertEquals(revNodeData.iterationHistory[0].iteration, 1);

    // 6. Iteration 2: Review completes -> Decision "approved"
    const next4 = await getNextStepTool.execute({
      executionId,
      nodeId: reviewNode.id,
      status: "completed",
    });
    assert(!next4.isError);

    const next5 = await getNextStepTool.execute({
      executionId,
      nodeId: decisionNode.id,
      status: "completed",
      decision: "approved",
    });
    assert(!next5.isError);
    const next5Data = parseResponseJson(next5);
    assertEquals(next5Data.workflowComplete, true);
    assert(next5Data.summary.includes("Reached end node"));

    // 7. Reset by executionId
    const resetRes = await resetWorkflowTool.execute({ executionId });
    assert(!resetRes.isError);

    // After reset, the execution's nodeStates are cleared — get_node without executionId returns template (pending)
    const getResetRevRes = await getNodeTool.execute({ workflowId, nodeId: reviewNode.id });
    const resetRevData = JSON.parse(getResetRevRes.content[0].text);
    assertEquals(resetRevData.status, "pending");
  } finally {
    kv.close();
  }
});

Deno.test("Subworkflow and Gated Looping - maxIterations Guardrail", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    const parseResponseJson = (
      res: {
        content: Array<{ type: string; text: string; annotations?: { audience?: string[] } }>;
      },
    ) => {
      const jsonItem = res.content.find((c) => c.annotations?.audience?.includes("assistant")) ??
        res.content[res.content.length - 1];
      return JSON.parse(jsonItem.text);
    };

    const wfRes = await createWorkflowTool.execute({
      name: "Max Iterations Workflow",
      description: "Tests hitting loop limit",
    });
    const { workflow, startNode } = JSON.parse(wfRes.content[0].text);
    const workflowId = workflow.id;

    // Add Loop node with maxIterations = 2
    const addLoopNode = await addNodeTool.execute({
      workflowId,
      type: "step",
      name: "Repeating Step",
      description: "Loops forever unless stopped",
      config: { maxIterations: 2 },
    });
    const loopNode = JSON.parse(addLoopNode.content[0].text);

    const addDecNode = await addNodeTool.execute({
      workflowId,
      type: "decision",
      name: "Check Done",
      description: "Branch",
      config: { options: ["repeat", "exit"] },
    });
    const decNode = JSON.parse(addDecNode.content[0].text);

    const addEndNode = await addNodeTool.execute({
      workflowId,
      type: "end",
      name: "Exit",
      description: "End",
    });
    const endNode = JSON.parse(addEndNode.content[0].text);

    await connectNodesTool.execute({ workflowId, fromNodeId: startNode.id, toNodeId: loopNode.id });
    await connectNodesTool.execute({ workflowId, fromNodeId: loopNode.id, toNodeId: decNode.id });
    await connectNodesTool.execute({
      workflowId,
      fromNodeId: decNode.id,
      toNodeId: loopNode.id,
      condition: "repeat",
    });
    await connectNodesTool.execute({
      workflowId,
      fromNodeId: decNode.id,
      toNodeId: endNode.id,
      condition: "exit",
    });

    // Start (Iteration 1)
    const startRes = await startWorkflowTool.execute({ workflowId });
    const startData = parseResponseJson(startRes);
    const executionId = startData.executionId;

    // Step 1 completes -> Dec repeats -> Loop (Iteration 2)
    await getNextStepTool.execute({ executionId, nodeId: loopNode.id, status: "completed" });
    const rep1 = await getNextStepTool.execute({
      executionId,
      nodeId: decNode.id,
      status: "completed",
      decision: "repeat",
    });
    const rep1Data = parseResponseJson(rep1);
    assertEquals(rep1Data.nextNodes[0].iteration, 2);

    // Iteration 2 completes -> Dec repeats -> Should trip maxIterations limit (since max is 2)
    await getNextStepTool.execute({ executionId, nodeId: loopNode.id, status: "completed" });
    const rep2 = await getNextStepTool.execute({
      executionId,
      nodeId: decNode.id,
      status: "completed",
      decision: "repeat",
    });
    const rep2Data = parseResponseJson(rep2);
    assertEquals(rep2Data.nextNodes.length, 0); // Fails, no actionable next nodes

    // Verify node is marked failed with limit message in the execution
    const getNodeRes = await getNodeTool.execute({ workflowId, nodeId: loopNode.id, executionId });
    const nodeData = JSON.parse(getNodeRes.content[0].text);
    assertEquals(nodeData.status, "failed");
    assert(nodeData.error.includes("Loop iteration limit exceeded"));
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
    const { workflow, startNode } = JSON.parse(wfRes.content[0].text);
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
    const subNode = JSON.parse(addSubRes.content[0].text);
    assertEquals(subNode.type, "subworkflow");
    assertEquals(subNode.config.childWorkflowId, "child-wf-999");

    const addEndRes = await addNodeTool.execute({
      workflowId,
      type: "end",
      name: "Parent End",
      description: "Complete",
    });
    const endNode = JSON.parse(addEndRes.content[0].text);

    await connectNodesTool.execute({ workflowId, fromNodeId: startNode.id, toNodeId: subNode.id });
    await connectNodesTool.execute({ workflowId, fromNodeId: subNode.id, toNodeId: endNode.id });

    // Edit subworkflow node
    const editRes = await editNodeTool.execute({
      workflowId,
      nodeId: subNode.id,
      config: { childWorkflowId: "child-wf-updated" },
    });
    assert(!editRes.isError);
    const editedNode = JSON.parse(editRes.content[0].text);
    assertEquals(editedNode.config.childWorkflowId, "child-wf-updated");

    // Visualize workflow without executionId (template view)
    const visRes = await visualizeWorkflowTool.execute({ workflowId });
    assert(!visRes.isError);
    assert(visRes.content[0].text.includes('["⏳ Run Child Workflow 📦"]]'));

    // Start an execution and visualize with executionId
    const startRes = await startWorkflowTool.execute({ workflowId });
    const startData = JSON.parse(
      (startRes.content.find((c) => c.annotations?.audience?.includes("assistant")) ??
        startRes.content[startRes.content.length - 1]).text,
    );
    const executionId = startData.executionId;

    const visExecRes = await visualizeWorkflowTool.execute({ executionId });
    assert(!visExecRes.isError);
    // subworkflow node should still be pending in execution (not yet run)
    assert(visExecRes.content[0].text.includes('["⏳ Run Child Workflow 📦"]]'));
  } finally {
    kv.close();
  }
});
