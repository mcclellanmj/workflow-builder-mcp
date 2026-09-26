import { assert, assertEquals } from "@std/assert";
import { setKv } from "../../store/kv.ts";
import { saveWorkflow } from "../../store/kv/workflows.ts";
import { saveNode } from "../../store/kv/nodes.ts";
import { saveEdge } from "../../store/kv/edges.ts";
import { saveTask } from "../../store/kv/tasks.ts";
import { workflowRunStartTool } from "./workflow_run_start.ts";
import { workflowRunStatusTool } from "./workflow_run_status.ts";
import { workflowStepAdvanceTool } from "./workflow_step_advance.ts";
import { workflowRunCompleteTool } from "./workflow_run_complete.ts";
import { workflowMessagePostTool } from "./workflow_message_post.ts";
import { workflowMessageReadTool } from "./workflow_message_read.ts";
import type { Task, Workflow, WorkflowEdge, WorkflowNode } from "../../store/types.ts";

// deno-lint-ignore no-explicit-any
function parseResult(res: { content: Array<{ type: string; text: string }>; isError?: boolean }): any {
  assert(!res.isError, `Expected success response, got error: ${JSON.stringify(res)}`);
  return JSON.parse(res.content[0].text);
}

Deno.test("Workflow Execution Tools - End-to-End Run, Decision, Message Board, and Completion", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    const now = new Date().toISOString();
    const wfId = "wf-exec-test";

    // 1. Setup workflow graph
    const workflow: Workflow = {
      id: wfId,
      name: "Feature Pipeline",
      description: "Architecture -> Triage Decision -> QA / Dev",
      createdAt: now,
      updatedAt: now,
    };
    await saveWorkflow(workflow);

    const startNode: WorkflowNode = {
      id: "node-start",
      workflowId: wfId,
      type: "start",
      name: "Start",
      description: "Pipeline entry point",
      runInSubAgent: false,
      config: {},
      status: "pending",
      error: null,
      createdAt: now,
      updatedAt: now,
    };
    const archNode: WorkflowNode = {
      id: "node-arch",
      workflowId: wfId,
      type: "step",
      name: "Architecture Spec",
      description: "Draft architectural specification",
      runInSubAgent: true,
      role: "architect",
      joinPolicy: "all",
      config: {},
      status: "pending",
      error: null,
      createdAt: now,
      updatedAt: now,
    };
    const triageNode: WorkflowNode = {
      id: "node-triage",
      workflowId: wfId,
      type: "decision",
      name: "Review Triage",
      description: "Evaluate review approval status",
      runInSubAgent: false,
      role: "orchestrator",
      joinPolicy: "all",
      config: {
        field: "reviewStatus",
        map: {
          approved: "qa",
          rejected: "retry",
        },
        default: "retry",
      },
      status: "pending",
      error: null,
      createdAt: now,
      updatedAt: now,
    };
    const retryNode: WorkflowNode = {
      id: "node-retry",
      workflowId: wfId,
      type: "step",
      name: "Rework Implementation",
      description: "Fix code according to reviewer feedback",
      runInSubAgent: true,
      role: "developer",
      joinPolicy: "all",
      config: {},
      status: "pending",
      error: null,
      createdAt: now,
      updatedAt: now,
    };
    const qaNode: WorkflowNode = {
      id: "node-qa",
      workflowId: wfId,
      type: "step",
      name: "Final QA",
      description: "Perform end-to-end testing",
      runInSubAgent: true,
      role: "qa-engineer",
      joinPolicy: "all",
      config: {},
      status: "pending",
      error: null,
      createdAt: now,
      updatedAt: now,
    };

    await saveNode(startNode);
    await saveNode(archNode);
    await saveNode(triageNode);
    await saveNode(retryNode);
    await saveNode(qaNode);

    // Edges
    const edges: WorkflowEdge[] = [
      {
        id: "e-1",
        workflowId: wfId,
        fromNodeId: "node-start",
        toNodeId: "node-arch",
      },
      {
        id: "e-2",
        workflowId: wfId,
        fromNodeId: "node-arch",
        toNodeId: "node-triage",
      },
      {
        id: "e-3",
        workflowId: wfId,
        fromNodeId: "node-triage",
        toNodeId: "node-retry",
        condition: "retry",
      },
      {
        id: "e-4",
        workflowId: wfId,
        fromNodeId: "node-triage",
        toNodeId: "node-qa",
        condition: "qa",
      },
    ];

    for (const edge of edges) {
      await saveEdge(edge);
    }

    // 2. Test workflow_run_start
    const startRes = await workflowRunStartTool.execute({
      workflowId: wfId,
      initialContext: { repository: "workflow-builder-mcp", version: 1 },
    });
    const startData = parseResult(startRes);
    const executionId = startData.executionId;
    assert(executionId, "Execution ID should be returned");
    assertEquals(startData.status, "in_progress");
    assertEquals(startData.context.repository, "workflow-builder-mcp");

    // The start node should be completed, and node-arch should be active/running
    assertEquals(startData.execution.nodeStates["node-start"]?.status, "completed");
    assertEquals(startData.execution.nodeStates["node-arch"]?.status, "running");
    assertEquals(startData.activeNodes.length, 1);
    assertEquals(startData.activeNodes[0].id, "node-arch");

    // 3. Test workflow_run_status
    const statusRes = await workflowRunStatusTool.execute({ executionId });
    const statusData = parseResult(statusRes);
    assertEquals(statusData.executionId, executionId);
    assertEquals(statusData.status, "in_progress");
    assertEquals(statusData.activeNodes.length, 1);
    assertEquals(statusData.activeNodes[0].id, "node-arch");
    assertEquals(statusData.completedNodes.length, 1);
    assertEquals(statusData.completedNodes[0].id, "node-start");
    assertEquals(statusData.context.version, 1);

    // 4. Test workflow_message_post & workflow_message_read
    const postRes1 = await workflowMessagePostTool.execute({
      executionId,
      content: "Architecture specification drafted and approved.",
      author: "arch-agent",
      role: "architect",
      nodeId: "node-arch",
      topic: "architecture",
    });
    const postData1 = parseResult(postRes1);
    assert(postData1.message?.id);
    assertEquals(postData1.message.topic, "architecture");

    const postRes2 = await workflowMessagePostTool.execute({
      executionId,
      content: "Task tk-101 review in progress.",
      author: "reviewer-1",
      role: "reviewer",
      taskId: "tk-101",
      topic: "review_feedback",
    });
    const postData2 = parseResult(postRes2);
    assert(postData2.message?.id);

    // Read all messages
    const readAllRes = await workflowMessageReadTool.execute({ executionId });
    const readAllData = parseResult(readAllRes);
    assertEquals(readAllData.count, 2);

    // Read filtered by role
    const readRoleRes = await workflowMessageReadTool.execute({
      executionId,
      role: "architect",
    });
    const readRoleData = parseResult(readRoleRes);
    assertEquals(readRoleData.count, 1);
    assertEquals(readRoleData.messages[0].author, "arch-agent");

    // Read filtered by taskId
    const readTaskRes = await workflowMessageReadTool.execute({
      executionId,
      taskId: "tk-101",
    });
    const readTaskData = parseResult(readTaskRes);
    assertEquals(readTaskData.count, 1);
    assertEquals(readTaskData.messages[0].topic, "review_feedback");

    // 5. Test workflow_step_advance (Step 1: complete node-arch with contextDelta)
    const step1Res = await workflowStepAdvanceTool.execute({
      executionId,
      nodeId: "node-arch",
      status: "completed",
      contextDelta: {
        specDocumentUrl: "specs/feature-v1.md",
        $push: { components: "store" },
      },
      feedback: "Architecture verified against standards",
    });
    const step1Data = parseResult(step1Res);
    assertEquals(step1Data.node.state.status, "completed");
    assertEquals(step1Data.context.specDocumentUrl, "specs/feature-v1.md");
    assertEquals(step1Data.context.components, ["store"]);
    // Node-triage should now be activated
    assertEquals(step1Data.activatedNodes.length, 1);
    assertEquals(step1Data.activatedNodes[0].id, "node-triage");

    // 6. Test workflow_step_advance (Step 2: advance decision node-triage with approval)
    const step2Res = await workflowStepAdvanceTool.execute({
      executionId,
      nodeId: "node-triage",
      status: "completed",
      data: { reviewStatus: "approved" },
    });
    const step2Data = parseResult(step2Res);
    assertEquals(step2Data.condition, "qa");
    assertEquals(step2Data.activatedNodes.length, 1);
    assertEquals(step2Data.activatedNodes[0].id, "node-qa");

    // Verify status shows node-qa running
    const statusRes2 = await workflowRunStatusTool.execute({ executionId });
    const statusData2 = parseResult(statusRes2);
    assertEquals(statusData2.activeNodes[0].id, "node-qa");

    // 7. Test workflow_step_advance (Step 3: complete node-qa)
    const step3Res = await workflowStepAdvanceTool.execute({
      executionId,
      nodeId: "node-qa",
      status: "completed",
      feedback: "All test suites passed 100%",
    });
    const step3Data = parseResult(step3Res);
    assertEquals(step3Data.node.state.status, "completed");
    assertEquals(step3Data.node.state.iterationHistory?.length, 1);
    assertEquals(
      step3Data.node.state.iterationHistory[0].feedback,
      "All test suites passed 100%",
    );

    // 8. Test workflow_run_complete
    const completeRes = await workflowRunCompleteTool.execute({
      executionId,
      status: "completed",
      finalSummary: "Feature implementation completed and verified by QA.",
    });
    const completeData = parseResult(completeRes);
    assertEquals(completeData.executionId, executionId);
    assertEquals(completeData.status, "completed");
    assertEquals(
      completeData.finalSummary,
      "Feature implementation completed and verified by QA.",
    );

    // Final status check
    const finalStatus = await workflowRunStatusTool.execute({ executionId });
    const finalData = parseResult(finalStatus);
    assertEquals(finalData.status, "completed");
  } finally {
    await kv.close();
  }
});

Deno.test("Workflow Execution Tools - Subworkflow Linkage, Bubbling, and Aggregated Messages", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    const now = new Date().toISOString();

    // 1. Setup parent and child workflows
    const parentWf: Workflow = {
      id: "wf-parent",
      name: "Parent Workflow",
      description: "Parent workflow orchestrator",
      createdAt: now,
      updatedAt: now,
    };
    const childWf: Workflow = {
      id: "wf-child",
      name: "Child Subworkflow",
      description: "Child subworkflow task",
      createdAt: now,
      updatedAt: now,
    };
    await saveWorkflow(parentWf);
    await saveWorkflow(childWf);

    const parentStart: WorkflowNode = {
      id: "p-start",
      workflowId: "wf-parent",
      type: "start",
      name: "Start",
      description: "Start",
      runInSubAgent: false,
      config: {},
      status: "pending",
      error: null,
      createdAt: now,
      updatedAt: now,
    };
    const parentDevNode: WorkflowNode = {
      id: "p-dev",
      workflowId: "wf-parent",
      type: "step",
      name: "Dev Task Dispatch",
      description: "Spawns child tasks",
      runInSubAgent: false,
      config: {},
      status: "pending",
      error: null,
      createdAt: now,
      updatedAt: now,
    };
    await saveNode(parentStart);
    await saveNode(parentDevNode);
    await saveEdge({
      id: "pe-1",
      workflowId: "wf-parent",
      fromNodeId: "p-start",
      toNodeId: "p-dev",
    });

    const childStart: WorkflowNode = {
      id: "c-start",
      workflowId: "wf-child",
      type: "start",
      name: "Child Start",
      description: "Child Start",
      runInSubAgent: false,
      config: {},
      status: "pending",
      error: null,
      createdAt: now,
      updatedAt: now,
    };
    const childWork: WorkflowNode = {
      id: "c-work",
      workflowId: "wf-child",
      type: "step",
      name: "Child Work",
      description: "Child Work",
      runInSubAgent: true,
      config: {},
      status: "pending",
      error: null,
      createdAt: now,
      updatedAt: now,
    };
    await saveNode(childStart);
    await saveNode(childWork);
    await saveEdge({
      id: "ce-1",
      workflowId: "wf-child",
      fromNodeId: "c-start",
      toNodeId: "c-work",
    });

    // 2. Start parent execution
    const pStartRes = await workflowRunStartTool.execute({
      workflowId: "wf-parent",
    });
    const pStartData = parseResult(pStartRes);
    const parentExecId = pStartData.executionId;

    // Transition parent node to waiting_for_children
    await workflowStepAdvanceTool.execute({
      executionId: parentExecId,
      nodeId: "p-dev",
      status: "waiting_for_children",
    });

    // Create origin task for child
    const originTask: Task = {
      id: "tk-child-job",
      title: "Implement sub-feature",
      description: "Child task description",
      status: "open",
      originWorkflowId: "wf-parent",
      originExecutionId: parentExecId,
      originNodeId: "p-dev",
      comments: [],
      createdAt: now,
      updatedAt: now,
    };
    await saveTask(originTask);

    // 3. Start child execution linked to parent
    const cStartRes = await workflowRunStartTool.execute({
      workflowId: "wf-child",
      parentExecutionId: parentExecId,
      originTaskId: originTask.id,
      originNodeId: "p-dev",
    });
    const cStartData = parseResult(cStartRes);
    const childExecId = cStartData.executionId;
    assertEquals(cStartData.parentExecutionId, parentExecId);
    assertEquals(cStartData.originTaskId, originTask.id);

    // 4. Post message to child run and message to parent run
    await workflowMessagePostTool.execute({
      executionId: parentExecId,
      content: "Parent orchestrator dispatched child task.",
      author: "orchestrator",
      role: "orchestrator",
      topic: "dispatch",
    });

    await workflowMessagePostTool.execute({
      executionId: childExecId,
      content: "Child subagent working on feature.",
      author: "dev-subagent-1",
      role: "developer",
      taskId: originTask.id,
      topic: "progress",
    });

    // 5. Read parent messages with includeSubworkflows: true
    const aggregatedRes = await workflowMessageReadTool.execute({
      executionId: parentExecId,
      includeSubworkflows: true,
    });
    const aggregatedData = parseResult(aggregatedRes);
    assertEquals(aggregatedData.count, 2);
    assert(aggregatedData.messages.some((m: { author: string }) => m.author === "dev-subagent-1"));

    // 6. Complete child subagent execution
    const childCompleteRes = await workflowRunCompleteTool.execute({
      executionId: childExecId,
      status: "completed",
      finalSummary: "Subfeature successfully created with tests.",
    });
    const childCompleteData = parseResult(childCompleteRes);
    assertEquals(childCompleteData.status, "completed");

    // Check parent execution: p-dev should now automatically be released to completed!
    const parentStatus = await workflowRunStatusTool.execute({
      executionId: parentExecId,
    });
    const parentStatusData = parseResult(parentStatus);
    assertEquals(parentStatusData.execution.nodeStates["p-dev"]?.status, "completed");
  } finally {
    await kv.close();
  }
});

Deno.test("Workflow Execution Tools - Error Handling for Missing Entities", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    // 1. workflow_run_start with nonexistent workflow
    const badStartRes = await workflowRunStartTool.execute({
      workflowId: "nonexistent-wf",
    });
    assert(badStartRes.isError);
    assert(badStartRes.content[0].text.includes("not found"));

    // 2. workflow_run_status with nonexistent execution
    const badStatusRes = await workflowRunStatusTool.execute({
      executionId: "exec-doesnotexist",
    });
    assert(badStatusRes.isError);
    assert(badStatusRes.content[0].text.includes("not found"));

    // 3. workflow_step_advance with nonexistent execution
    const badAdvanceRes = await workflowStepAdvanceTool.execute({
      executionId: "exec-doesnotexist",
      nodeId: "node-1",
      status: "completed",
    });
    assert(badAdvanceRes.isError);
    assert(badAdvanceRes.content[0].text.includes("not found"));

    // 4. workflow_run_complete with nonexistent execution
    const badCompleteRes = await workflowRunCompleteTool.execute({
      executionId: "exec-doesnotexist",
      status: "completed",
    });
    assert(badCompleteRes.isError);
    assert(badCompleteRes.content[0].text.includes("not found"));

    // 5. workflow_message_post with nonexistent execution
    const badPostRes = await workflowMessagePostTool.execute({
      executionId: "exec-doesnotexist",
      content: "Hello",
      author: "tester",
    });
    assert(badPostRes.isError);
    assert(badPostRes.content[0].text.includes("not found"));

    // 6. workflow_message_read with nonexistent execution
    const badReadRes = await workflowMessageReadTool.execute({
      executionId: "exec-doesnotexist",
    });
    assert(badReadRes.isError);
    assert(badReadRes.content[0].text.includes("not found"));
  } finally {
    await kv.close();
  }
});
