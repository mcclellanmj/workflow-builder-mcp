import { assert, assertEquals } from "@std/assert";
import { setKv } from "../../store/kv.ts";
import { createWorkflowTool } from "./create_workflow.ts";
import { addNodeTool } from "./add_node.ts";
import { connectNodesTool } from "./connect_nodes.ts";
import { startWorkflowTool } from "./start_workflow.ts";
import { getNextStepTool } from "./get_next_step.ts";
import { resetWorkflowTool } from "./reset_workflow.ts";
import { getExecution, getNode, listNodes } from "../../store/kv.ts";

Deno.test("Execution MCP Tools - start, next, reset lifecycle", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    // 1. Create a workflow (comes with a start node)
    const createRes = await createWorkflowTool.execute({
      name: "CI/CD Pipeline",
      description: "Build, test, decide to deploy, and complete",
    });
    assert(!createRes.isError, "createWorkflowTool failed");
    const createdWorkflow = JSON.parse(createRes.content[0].text);
    const workflowId = createdWorkflow.workflow.id;
    const startNodeId = createdWorkflow.startNode.id;

    // 2. Add step node: "Build"
    const addBuildRes = await addNodeTool.execute({
      workflowId,
      type: "step",
      name: "Build Project",
      description: "Compile TypeScript and bundle assets",
      runInSubAgent: true,
    });
    assert(!addBuildRes.isError, "Failed to add Build node");
    const buildNode = JSON.parse(addBuildRes.content[0].text);

    // 3. Add decision node: "Quality Check"
    const addDecisionRes = await addNodeTool.execute({
      workflowId,
      type: "decision",
      name: "Quality Check",
      description: "Check test coverage and lint results",
      config: { options: ["approved", "rejected"] },
    });
    assert(!addDecisionRes.isError, "Failed to add Quality Check node");
    const decisionNode = JSON.parse(addDecisionRes.content[0].text);

    // 4. Add step node: "Deploy"
    const addDeployRes = await addNodeTool.execute({
      workflowId,
      type: "step",
      name: "Deploy to Prod",
      description: "Deploy artifacts to production server",
    });
    assert(!addDeployRes.isError, "Failed to add Deploy node");
    const deployNode = JSON.parse(addDeployRes.content[0].text);

    // 5. Add step node: "Rollback"
    const addRollbackRes = await addNodeTool.execute({
      workflowId,
      type: "step",
      name: "Rollback",
      description: "Notify on-call and revert commit",
    });
    assert(!addRollbackRes.isError, "Failed to add Rollback node");
    const rollbackNode = JSON.parse(addRollbackRes.content[0].text);

    // 6. Add end node: "Success End"
    const addEndRes = await addNodeTool.execute({
      workflowId,
      type: "end",
      name: "Pipeline Finished",
      description: "Workflow terminal state",
    });
    assert(!addEndRes.isError, "Failed to add End node");
    const endNode = JSON.parse(addEndRes.content[0].text);

    // 7. Connect nodes
    // Start -> Build
    await connectNodesTool.execute({
      workflowId,
      fromNodeId: startNodeId,
      toNodeId: buildNode.id,
    });
    // Build -> Decision
    await connectNodesTool.execute({
      workflowId,
      fromNodeId: buildNode.id,
      toNodeId: decisionNode.id,
    });
    // Decision -> Deploy (condition: approved)
    await connectNodesTool.execute({
      workflowId,
      fromNodeId: decisionNode.id,
      toNodeId: deployNode.id,
      condition: "approved",
    });
    // Decision -> Rollback (condition: rejected)
    await connectNodesTool.execute({
      workflowId,
      fromNodeId: decisionNode.id,
      toNodeId: rollbackNode.id,
      condition: "rejected",
    });
    // Deploy -> End
    await connectNodesTool.execute({
      workflowId,
      fromNodeId: deployNode.id,
      toNodeId: endNode.id,
    });
    // Rollback -> End
    await connectNodesTool.execute({
      workflowId,
      fromNodeId: rollbackNode.id,
      toNodeId: endNode.id,
    });

    // Helper to extract JSON data from single or multi-content MCP response
    const parseResponseJson = (
      res: {
        content: Array<{ type: string; text: string; annotations?: { audience?: string[] } }>;
      },
    ) => {
      const jsonItem = res.content.find((c) => c.annotations?.audience?.includes("assistant")) ??
        res.content[res.content.length - 1];
      return JSON.parse(jsonItem.text);
    };

    // 8. Test workflow_start
    const startRes = await startWorkflowTool.execute({ workflowId });
    assert(!startRes.isError, `workflow_start failed`);
    const startData = parseResponseJson(startRes);
    assertEquals(startData.workflowId, workflowId);
    assertEquals(startData.startNode.status, "completed");
    assertEquals(startData.nextNodes.length, 1);
    assertEquals(startData.nextNodes[0].id, buildNode.id);
    assertEquals(startData.nextNodes[0].name, "Build Project");
    assertEquals(startData.nextNodes[0].runInSubAgent, true);
    assertEquals(startData.workflowComplete, false);

    // Capture the executionId for all subsequent calls
    const executionId = startData.executionId;
    assert(
      typeof executionId === "string" && executionId.length > 0,
      "Expected executionId in start response",
    );

    // Verify execution record was saved in KV
    const savedExecution = await getExecution(executionId);
    assert(savedExecution !== null, "Expected execution to be persisted in KV");
    assertEquals(savedExecution?.workflowId, workflowId);
    assertEquals(savedExecution?.nodeStates[startNodeId]?.status, "completed");

    // Verify template start node also updated in KV (for backward compat)
    const updatedStartNode = await getNode(workflowId, startNodeId);
    assertEquals(updatedStartNode?.status, "completed");

    // 9. Test workflow_next on Build step (using executionId)
    const nextAfterBuild = await getNextStepTool.execute({
      executionId,
      nodeId: buildNode.id,
      status: "completed",
    });
    assert(!nextAfterBuild.isError, "workflow_next failed after build");
    const buildNextData = parseResponseJson(nextAfterBuild);
    assertEquals(buildNextData.executionId, executionId);
    assertEquals(buildNextData.workflowComplete, false);
    assertEquals(buildNextData.nextNodes.length, 1);
    assertEquals(buildNextData.nextNodes[0].id, decisionNode.id);
    assertEquals(buildNextData.nextNodes[0].type, "decision");

    // Verify execution state updated (not the base node)
    const execAfterBuild = await getExecution(executionId);
    assertEquals(execAfterBuild?.nodeStates[buildNode.id]?.status, "completed");

    // 10. Test workflow_next on Decision without decision parameter (should error)
    const decNoArgRes = await getNextStepTool.execute({
      executionId,
      nodeId: decisionNode.id,
      status: "completed",
    });
    assert(decNoArgRes.isError, "Expected error when decision argument missing on decision node");

    // 11. Test workflow_next on Decision with invalid decision value (should error)
    const decInvalidRes = await getNextStepTool.execute({
      executionId,
      nodeId: decisionNode.id,
      status: "completed",
      decision: "unknown_option",
    });
    assert(decInvalidRes.isError, "Expected error when invalid decision string given");

    // 12. Test workflow_next on Decision with valid decision: 'approved'
    const decValidRes = await getNextStepTool.execute({
      executionId,
      nodeId: decisionNode.id,
      status: "completed",
      decision: "approved",
    });
    assert(
      !decValidRes.isError,
      `workflow_next failed on decision`,
    );
    const decData = parseResponseJson(decValidRes);
    assertEquals(decData.workflowComplete, false);
    assertEquals(decData.nextNodes.length, 1);
    assertEquals(decData.nextNodes[0].id, deployNode.id);
    assertEquals(decData.nextNodes[0].name, "Deploy to Prod");

    // 13. Test workflow_next on Deploy -> leads to End node
    const deployNextRes = await getNextStepTool.execute({
      executionId,
      nodeId: deployNode.id,
      status: "completed",
    });
    assert(!deployNextRes.isError, "workflow_next failed on deploy");
    const deployData = parseResponseJson(deployNextRes);
    assertEquals(deployData.workflowComplete, true);
    assertEquals(deployData.nextNodes.length, 0);

    // Verify end node was automatically marked completed in the execution
    const execAfterDeploy = await getExecution(executionId);
    assertEquals(execAfterDeploy?.nodeStates[endNode.id]?.status, "completed");

    // 14. Test workflow_reset by executionId
    const resetRes = await resetWorkflowTool.execute({ executionId });
    assert(!resetRes.isError, "workflow_reset failed");
    const resetData = parseResponseJson(resetRes);
    assertEquals(resetData.executionId, executionId);

    // Verify execution's nodeStates were cleared
    const execAfterReset = await getExecution(executionId);
    assertEquals(Object.keys(execAfterReset?.nodeStates ?? {}).length, 0);

    // 15. Test workflow_reset by workflowId (resets template + deletes executions)
    const startRes2 = await startWorkflowTool.execute({ workflowId });
    const startData2 = parseResponseJson(startRes2);
    const executionId2 = startData2.executionId;

    const wfResetRes = await resetWorkflowTool.execute({ workflowId });
    assert(!wfResetRes.isError, "workflow_reset by workflowId failed");
    const wfResetData = parseResponseJson(wfResetRes);
    assertEquals(wfResetData.nodesReset, 6); // start, build, decision, deploy, rollback, end

    // Verify template nodes are pending
    const allNodesAfterReset = await listNodes(workflowId);
    for (const node of allNodesAfterReset) {
      assertEquals(node.status, "pending");
      assertEquals(node.error, null);
    }

    // Verify executions were deleted
    const exec1AfterReset = await getExecution(executionId);
    const exec2AfterReset = await getExecution(executionId2);
    assertEquals(exec1AfterReset, null);
    assertEquals(exec2AfterReset, null);

    // 16. Test node failure handling in workflow_next
    const startRes3 = await startWorkflowTool.execute({ workflowId });
    const startData3 = parseResponseJson(startRes3);
    const executionId3 = startData3.executionId;

    const failRes = await getNextStepTool.execute({
      executionId: executionId3,
      nodeId: buildNode.id,
      status: "failed",
      error: "Syntax error on line 42",
    });
    assert(!failRes.isError, "failRes should return valid response payload");
    const failData = parseResponseJson(failRes);
    assertEquals(failData.workflowComplete, false);
    assertEquals(failData.nextNodes.length, 0);

    const execAfterFail = await getExecution(executionId3);
    assertEquals(execAfterFail?.nodeStates[buildNode.id]?.status, "failed");
    assertEquals(execAfterFail?.nodeStates[buildNode.id]?.error, "Syntax error on line 42");
    assertEquals(execAfterFail?.status, "failed");
  } finally {
    kv.close();
  }
});

Deno.test("Concurrent Multi-Project Execution - Two independent runs of the same workflow", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    // Build a simple 3-node workflow: Start -> Step -> End
    const createRes = await createWorkflowTool.execute({
      name: "Shared Workflow Template",
      description: "Used by two concurrent projects",
    });
    const { workflow, startNode } = JSON.parse(createRes.content[0].text);
    const workflowId = workflow.id;

    const stepRes = await addNodeTool.execute({
      workflowId,
      type: "step",
      name: "Shared Step",
      description: "A step run independently by each project",
    });
    const stepNode = JSON.parse(stepRes.content[0].text);

    const endRes = await addNodeTool.execute({
      workflowId,
      type: "end",
      name: "Done",
      description: "Workflow complete",
    });
    const endNode = JSON.parse(endRes.content[0].text);

    await connectNodesTool.execute({ workflowId, fromNodeId: startNode.id, toNodeId: stepNode.id });
    await connectNodesTool.execute({ workflowId, fromNodeId: stepNode.id, toNodeId: endNode.id });

    const parseJson = (
      res: {
        content: Array<{ type: string; text: string; annotations?: { audience?: string[] } }>;
      },
    ) => {
      const item = res.content.find((c) => c.annotations?.audience?.includes("assistant")) ??
        res.content[res.content.length - 1];
      return JSON.parse(item.text);
    };

    // Project A and Project B both start the same workflow
    const startA = await startWorkflowTool.execute({ workflowId });
    assert(!startA.isError, "Project A start failed");
    const dataA = parseJson(startA);
    const execIdA = dataA.executionId;

    const startB = await startWorkflowTool.execute({ workflowId });
    assert(!startB.isError, "Project B start failed");
    const dataB = parseJson(startB);
    const execIdB = dataB.executionId;

    // They should get different execution IDs
    assert(execIdA !== execIdB, "Expected different executionIds for concurrent runs");

    // Project A completes the step successfully
    const nextA = await getNextStepTool.execute({
      executionId: execIdA,
      nodeId: stepNode.id,
      status: "completed",
    });
    assert(!nextA.isError);
    const nextDataA = parseJson(nextA);
    assertEquals(nextDataA.workflowComplete, true);
    assertEquals(nextDataA.executionId, execIdA);

    // Project B fails the step
    const nextB = await getNextStepTool.execute({
      executionId: execIdB,
      nodeId: stepNode.id,
      status: "failed",
      error: "Project B: integration test crashed",
    });
    assert(!nextB.isError);
    const nextDataB = parseJson(nextB);
    assertEquals(nextDataB.workflowComplete, false);
    assertEquals(nextDataB.executionId, execIdB);

    // Verify executions are fully independent
    const execA = await getExecution(execIdA);
    const execB = await getExecution(execIdB);

    assertEquals(execA?.status, "completed");
    assertEquals(execA?.nodeStates[stepNode.id]?.status, "completed");

    assertEquals(execB?.status, "failed");
    assertEquals(execB?.nodeStates[stepNode.id]?.status, "failed");
    assertEquals(execB?.nodeStates[stepNode.id]?.error, "Project B: integration test crashed");

    // Verify the workflow template nodes are unaffected (still pending from template perspective)
    // (start node was marked completed when we first set up, but step and end remain pending in template)
    const templateStep = await getNode(workflowId, stepNode.id);
    assertEquals(templateStep?.status, "pending", "Template step should remain pending");
  } finally {
    kv.close();
  }
});

Deno.test("User Interaction Node Execution - prompt, options mapping, and rich instructions", async () => {
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

    // 1. Create a workflow: Start -> Review Step -> User Interaction -> [Fix Step -> Review Step, End]
    const createRes = await createWorkflowTool.execute({
      name: "Interactive Code Fix Loop",
      description: "Demonstrating human-in-the-loop interaction node",
    });
    const { workflow, startNode } = JSON.parse(createRes.content[0].text);
    const workflowId = workflow.id;

    const reviewRes = await addNodeTool.execute({
      workflowId,
      type: "step",
      name: "Review Code",
      description: "Analyze code for minor issues",
    });
    const reviewNode = JSON.parse(reviewRes.content[0].text);

    const userAskRes = await addNodeTool.execute({
      workflowId,
      type: "user_interaction",
      name: "Ask User to Fix Minor Issues",
      description:
        "Present minor findings and ask the user whether to proceed with automated fixes.",
      config: {
        prompt: "Found 2 minor style issues. Would you like to fix them automatically?",
        options: {
          "Yes, fix minor issues": "fix_minor",
          "No, skip and finish": "finish_loop",
        },
        allowFreeText: true,
        contextHint: "Display summary of style findings",
      },
    });
    const userAskNode = JSON.parse(userAskRes.content[0].text);

    const fixRes = await addNodeTool.execute({
      workflowId,
      type: "step",
      name: "Fix Minor Issues",
      description: "Apply automated style fixes",
    });
    const fixNode = JSON.parse(fixRes.content[0].text);

    const endRes = await addNodeTool.execute({
      workflowId,
      type: "end",
      name: "Finished",
      description: "Loop complete",
    });
    const endNode = JSON.parse(endRes.content[0].text);

    // Connect edges
    await connectNodesTool.execute({
      workflowId,
      fromNodeId: startNode.id,
      toNodeId: reviewNode.id,
    });
    await connectNodesTool.execute({
      workflowId,
      fromNodeId: reviewNode.id,
      toNodeId: userAskNode.id,
    });
    await connectNodesTool.execute({
      workflowId,
      fromNodeId: userAskNode.id,
      toNodeId: fixNode.id,
      condition: "fix_minor",
    });
    await connectNodesTool.execute({
      workflowId,
      fromNodeId: userAskNode.id,
      toNodeId: endNode.id,
      condition: "finish_loop",
    });
    await connectNodesTool.execute({ workflowId, fromNodeId: fixNode.id, toNodeId: reviewNode.id });

    // 2. Start workflow
    const startRes = await startWorkflowTool.execute({ workflowId });
    assert(!startRes.isError);
    const startData = parseResponseJson(startRes);
    const executionId = startData.executionId;
    assertEquals(startData.nextNodes[0].id, reviewNode.id);

    // 3. Complete review step -> next step is user_interaction
    const reviewNextRes = await getNextStepTool.execute({
      executionId,
      nodeId: reviewNode.id,
      status: "completed",
    });
    assert(!reviewNextRes.isError);
    const reviewNextData = parseResponseJson(reviewNextRes);
    assertEquals(reviewNextData.nextNodes.length, 1);
    assertEquals(reviewNextData.nextNodes[0].id, userAskNode.id);
    assertEquals(reviewNextData.nextNodes[0].type, "user_interaction");

    // Check that user_interaction node config contains prompt and options for orchestrator
    assertEquals(
      reviewNextData.nextNodes[0].config.prompt,
      "Found 2 minor style issues. Would you like to fix them automatically?",
    );
    const opts = reviewNextData.nextNodes[0].config.options as Record<string, string>;
    assertEquals(opts["Yes, fix minor issues"], "fix_minor");
    assertEquals(opts["No, skip and finish"], "finish_loop");
    assertEquals(reviewNextData.nextNodes[0].config.allowFreeText, true);

    // 4. Advance user_interaction with display label matching option map
    const userSelectRes = await getNextStepTool.execute({
      executionId,
      nodeId: userAskNode.id,
      status: "completed",
      decision: "Yes, fix minor issues", // Match by display label key!
    });
    assert(!userSelectRes.isError, "Expected display label to resolve matching condition");
    const userSelectData = parseResponseJson(userSelectRes);
    assertEquals(userSelectData.nextNodes.length, 1);
    assertEquals(userSelectData.nextNodes[0].id, fixNode.id);

    // 5. Complete fix step -> loops back to review
    const fixNextRes = await getNextStepTool.execute({
      executionId,
      nodeId: fixNode.id,
      status: "completed",
    });
    assert(!fixNextRes.isError);
    const fixNextData = parseResponseJson(fixNextRes);
    assertEquals(fixNextData.nextNodes[0].id, reviewNode.id);

    // 6. Complete review step again -> user interaction again
    await getNextStepTool.execute({
      executionId,
      nodeId: reviewNode.id,
      status: "completed",
    });

    // 7. Advance user_interaction with direct condition string
    const userFinishRes = await getNextStepTool.execute({
      executionId,
      nodeId: userAskNode.id,
      status: "completed",
      decision: "finish_loop", // Direct condition string match
    });
    assert(!userFinishRes.isError);
    const userFinishData = parseResponseJson(userFinishRes);
    assertEquals(userFinishData.workflowComplete, true);

    const execRecord = await getExecution(executionId);
    assertEquals(execRecord?.status, "completed");
  } finally {
    kv.close();
  }
});
