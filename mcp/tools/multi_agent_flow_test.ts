import { assert, assertEquals, assertRejects } from "@std/assert";
import { setKv } from "../../store/kv.ts";
import { saveWorkflow } from "../../store/kv/workflows.ts";
import { saveNode } from "../../store/kv/nodes.ts";
import { saveEdge } from "../../store/kv/edges.ts";
import { getTask } from "../../store/kv/tasks.ts";
import {
  getExecution,
  transitionNodeState,
} from "../../store/kv/executions.ts";
import { findNextNodes } from "../helpers.ts";
import { saveMemory } from "../../store/kv/memories.ts";
import { workflowRunStartTool } from "./workflow_run_start.ts";
import { workflowStepAdvanceTool } from "./workflow_step_advance.ts";
import { workflowRunCompleteTool } from "./workflow_run_complete.ts";
import { workflowMessagePostTool } from "./workflow_message_post.ts";
import { workflowMessageReadTool } from "./workflow_message_read.ts";
import { createTaskTool } from "./task_create.ts";
import { claimTaskTool } from "./task_claim.ts";
import { taskHandoffTool } from "./task_handoff.ts";
import { memoryRecallTool } from "./memory_recall.ts";
import { memorySearchTool } from "./memory_search.ts";
import type {
  Workflow,
  WorkflowEdge,
  WorkflowNode,
} from "../../store/types.ts";

// deno-lint-ignore no-explicit-any
function parseResult(res: { content: Array<{ type: string; text: string }>; isError?: boolean }): any {
  assert(!res.isError, `Expected success response, got error: ${JSON.stringify(res)}`);
  return JSON.parse(res.content[0].text);
}

Deno.test("Multi-Agent Flow Certification: Architecture -> Multi-Dev -> Multi-Review -> Triage Loop -> QA", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    const now = new Date().toISOString();
    const wfId = "wf-multiagent-target";

    // -------------------------------------------------------------------------
    // 0. Setup Primary Workflow & Child Subworkflows
    // -------------------------------------------------------------------------
    const primaryWf: Workflow = {
      id: wfId,
      name: "Autonomous Multi-Agent Feature Pipeline",
      description: "Architecture -> Dev -> Review -> Triage Loop -> QA Certification",
      createdAt: now,
      updatedAt: now,
    };
    await saveWorkflow(primaryWf);

    const childWf1: Workflow = {
      id: "wf-child-dev1",
      name: "Dev Module A Subworkflow",
      description: "Subworkflow executing Module A implementation",
      intendedForIndependentRun: false,
      createdAt: now,
      updatedAt: now,
    };
    await saveWorkflow(childWf1);

    const childWf2: Workflow = {
      id: "wf-child-dev2",
      name: "Dev Module B Subworkflow",
      description: "Subworkflow executing Module B implementation",
      intendedForIndependentRun: false,
      createdAt: now,
      updatedAt: now,
    };
    await saveWorkflow(childWf2);

    // Primary Nodes
    const nodes: WorkflowNode[] = [
      {
        id: "node-start",
        workflowId: wfId,
        type: "start",
        name: "Pipeline Start",
        description: "Entry point of multi-agent flow",
        runInSubAgent: false,
        config: {},
        status: "pending",
        error: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "node-arch",
        workflowId: wfId,
        type: "step",
        name: "Architecture & Spec",
        description: "Draft specification and save architectural memories",
        role: "architect",
        runInSubAgent: true,
        joinPolicy: "all",
        config: {},
        status: "pending",
        error: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "node-dev",
        workflowId: wfId,
        type: "step",
        name: "Multi-Agent Developer Dispatcher",
        description: "Dispatches developer tasks and waits for child subworkflows",
        role: "developer",
        runInSubAgent: true,
        joinPolicy: "all",
        config: {},
        status: "pending",
        error: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "node-barrier",
        workflowId: wfId,
        type: "step",
        name: "Multi-Agent Developer Barrier",
        description: "Barrier synchronization gate requiring all developer completions",
        role: "orchestrator",
        runInSubAgent: false,
        joinPolicy: "all",
        config: {},
        status: "pending",
        error: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "node-triage",
        workflowId: wfId,
        type: "decision",
        name: "Orchestrator Review Triage",
        description: "Evaluates review results and routes to QA or Developer rework loop",
        role: "orchestrator",
        runInSubAgent: false,
        joinPolicy: "any",
        config: {
          field: "reviewStatus",
          map: {
            approved: "qa",
            rejected: "rework",
          },
          default: "rework",
        },
        status: "pending",
        error: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "node-rework",
        workflowId: wfId,
        type: "step",
        name: "Developer Rework Loop",
        description: "Developer fixes defects reported during adversarial review",
        role: "developer",
        runInSubAgent: true,
        joinPolicy: "all",
        config: {},
        status: "pending",
        error: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "node-qa",
        workflowId: wfId,
        type: "step",
        name: "QA Certification Gate",
        description: "Performs full verification against architectural spec",
        role: "qa-engineer",
        runInSubAgent: true,
        joinPolicy: "all",
        config: {},
        status: "pending",
        error: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "node-end",
        workflowId: wfId,
        type: "end",
        name: "Pipeline Complete",
        description: "Terminal successful workflow node",
        runInSubAgent: false,
        config: {},
        status: "pending",
        error: null,
        createdAt: now,
        updatedAt: now,
      },
    ];

    for (const node of nodes) {
      await saveNode(node);
    }

    // Primary Edges
    const edges: WorkflowEdge[] = [
      { id: "e-start-arch", workflowId: wfId, fromNodeId: "node-start", toNodeId: "node-arch" },
      { id: "e-arch-dev", workflowId: wfId, fromNodeId: "node-arch", toNodeId: "node-dev" },
      { id: "e-dev-barrier", workflowId: wfId, fromNodeId: "node-dev", toNodeId: "node-barrier" },
      { id: "e-barrier-triage", workflowId: wfId, fromNodeId: "node-barrier", toNodeId: "node-triage" },
      { id: "e-triage-rework", workflowId: wfId, fromNodeId: "node-triage", toNodeId: "node-rework", condition: "rework" },
      { id: "e-rework-triage", workflowId: wfId, fromNodeId: "node-rework", toNodeId: "node-triage" },
      { id: "e-triage-qa", workflowId: wfId, fromNodeId: "node-triage", toNodeId: "node-qa", condition: "qa" },
      { id: "e-qa-end", workflowId: wfId, fromNodeId: "node-qa", toNodeId: "node-end" },
    ];

    for (const edge of edges) {
      await saveEdge(edge);
    }

    // Setup child subworkflow nodes
    for (const cWf of [childWf1, childWf2]) {
      const startN: WorkflowNode = {
        id: `${cWf.id}-start`,
        workflowId: cWf.id,
        type: "start",
        name: "Child Start",
        description: "Child subworkflow start",
        runInSubAgent: false,
        config: {},
        status: "pending",
        error: null,
        createdAt: now,
        updatedAt: now,
      };
      const stepN: WorkflowNode = {
        id: `${cWf.id}-work`,
        workflowId: cWf.id,
        type: "step",
        name: "Worker Step",
        description: "Worker implementation",
        runInSubAgent: true,
        role: "developer",
        config: {},
        status: "pending",
        error: null,
        createdAt: now,
        updatedAt: now,
      };
      await saveNode(startN);
      await saveNode(stepN);
      await saveEdge({
        id: `${cWf.id}-e1`,
        workflowId: cWf.id,
        fromNodeId: startN.id,
        toNodeId: stepN.id,
      });
    }

    // Start primary workflow run
    const startRes = await workflowRunStartTool.execute({
      workflowId: wfId,
      initialContext: { project: "workflow-builder-mcp", version: "2.0.0" },
    });
    const startData = parseResult(startRes);
    const parentExecId = startData.executionId;
    assert(parentExecId, "Parent execution ID should be created");
    assertEquals(startData.status, "in_progress");
    assertEquals(startData.activeNodes[0].id, "node-arch");

    // -------------------------------------------------------------------------
    // 1. Architecture step saves project memory via saveMemory (workflowId, tags: ["architecture", "spec"])
    // -------------------------------------------------------------------------
    const archMemory = await saveMemory({
      workflowId: wfId,
      nodeId: "node-arch",
      key: "architecture-spec",
      summary: "Target Multi-Agent Distributed Architecture Specification",
      content: "Architectural blueprint: Micro-agent work breakdown with strict barrier synchronization at triage gate.",
      tags: ["architecture", "spec"],
      source: "architect",
    });
    assert(archMemory.created, "Memory should be newly created");
    assertEquals(archMemory.memory.workflowId, wfId);
    assertEquals(archMemory.memory.tags, ["architecture", "spec"]);

    // Complete architecture step and transition to developer dispatcher
    const archAdvanceRes = await workflowStepAdvanceTool.execute({
      executionId: parentExecId,
      nodeId: "node-arch",
      status: "completed",
      contextDelta: { specApproved: true },
    });
    const archAdvanceData = parseResult(archAdvanceRes);
    assertEquals(archAdvanceData.activatedNodes[0].id, "node-dev");

    // -------------------------------------------------------------------------
    // 2. Two developer tasks created with assigned subworkflows
    // -------------------------------------------------------------------------
    const task1Res = await createTaskTool.execute({
      title: "Dev Task 1: Module A Implementation",
      role: "developer",
      priority: "high",
      originWorkflowId: wfId,
      originExecutionId: parentExecId,
      originNodeId: "node-dev",
      assignedWorkflowId: "wf-child-dev1",
    });
    const task1Data = parseResult(task1Res);
    const devTask1Id = task1Data.task.id;
    assertEquals(task1Data.task.assignedWorkflowId, "wf-child-dev1");
    assertEquals(task1Data.task.originNodeId, "node-dev");
    assertEquals(task1Data.task.originExecutionId, parentExecId);

    const task2Res = await createTaskTool.execute({
      title: "Dev Task 2: Module B Implementation",
      role: "developer",
      priority: "high",
      originWorkflowId: wfId,
      originExecutionId: parentExecId,
      originNodeId: "node-dev",
      assignedWorkflowId: "wf-child-dev2",
    });
    const task2Data = parseResult(task2Res);
    const devTask2Id = task2Data.task.id;
    assertEquals(task2Data.task.assignedWorkflowId, "wf-child-dev2");
    assertEquals(task2Data.task.originNodeId, "node-dev");
    assertEquals(task2Data.task.originExecutionId, parentExecId);

    // -------------------------------------------------------------------------
    // 3. Parent node transitions to "waiting_for_children"
    // -------------------------------------------------------------------------
    const parentWaitRes = await workflowStepAdvanceTool.execute({
      executionId: parentExecId,
      nodeId: "node-dev",
      status: "waiting_for_children",
    });
    const parentWaitData = parseResult(parentWaitRes);
    assertEquals(parentWaitData.node.state.status, "waiting_for_children");

    const parentExecCheck = await getExecution(parentExecId);
    assertEquals(parentExecCheck?.nodeStates["node-dev"].status, "waiting_for_children");

    // -------------------------------------------------------------------------
    // 4. Dev 1 completes subworkflow, signals completion
    // -------------------------------------------------------------------------
    const child1StartRes = await workflowRunStartTool.execute({
      workflowId: "wf-child-dev1",
      parentExecutionId: parentExecId,
      originTaskId: devTask1Id,
      originNodeId: "node-dev",
      initialContext: { worker: "dev-1" },
    });
    const child1StartData = parseResult(child1StartRes);
    const child1ExecId = child1StartData.executionId;

    const child1CompleteRes = await workflowRunCompleteTool.execute({
      executionId: child1ExecId,
      status: "completed",
      finalSummary: "Module A implementation completed and tested by Dev 1",
    });
    const child1CompleteData = parseResult(child1CompleteRes);
    assertEquals(child1CompleteData.status, "completed");

    // Dev 1 task is now closed
    const dev1TaskAfter = await getTask(devTask1Id);
    assertEquals(dev1TaskAfter?.status, "closed");
    assertEquals(dev1TaskAfter?.closedReason, "Module A implementation completed and tested by Dev 1");

    // -------------------------------------------------------------------------
    // 5. Barrier node (joinPolicy: "all") strictly holds; Triage node is NOT triggered yet
    // -------------------------------------------------------------------------
    const parentExecMid = await getExecution(parentExecId);
    assert(parentExecMid);
    // Parent node strictly remains in waiting_for_children because Dev 2 task is still active
    assertEquals(parentExecMid.nodeStates["node-dev"].status, "waiting_for_children");

    // findNextNodes returns empty list: Barrier node and Triage node must NOT be triggered
    const eligibleNodes = await findNextNodes(parentExecMid, "node-dev");
    assertEquals(eligibleNodes.length, 0, "Barrier / Triage must NOT be triggered while Dev 2 is working");

    // Triage node is strictly still pending
    assertEquals(parentExecMid.nodeStates["node-triage"].status, "pending");

    // Strict barrier enforcement verification: transitionNodeState rejects transition to running
    await assertRejects(
      async () => {
        await transitionNodeState({
          executionId: parentExecId,
          nodeId: "node-barrier",
          status: "running",
        });
      },
      Error,
      "inbound dependency 'node-dev' is not completed (current status: 'waiting_for_children'). Barrier policy is 'all'.",
    );

    // -------------------------------------------------------------------------
    // 6. Dev 2 completes subworkflow, signals completion
    // -------------------------------------------------------------------------
    const child2StartRes = await workflowRunStartTool.execute({
      workflowId: "wf-child-dev2",
      parentExecutionId: parentExecId,
      originTaskId: devTask2Id,
      originNodeId: "node-dev",
      initialContext: { worker: "dev-2" },
    });
    const child2StartData = parseResult(child2StartRes);
    const child2ExecId = child2StartData.executionId;

    const child2CompleteRes = await workflowRunCompleteTool.execute({
      executionId: child2ExecId,
      status: "completed",
      finalSummary: "Module B implementation completed and tested by Dev 2",
    });
    const child2CompleteData = parseResult(child2CompleteRes);
    assertEquals(child2CompleteData.status, "completed");

    const dev2TaskAfter = await getTask(devTask2Id);
    assertEquals(dev2TaskAfter?.status, "closed");

    // -------------------------------------------------------------------------
    // 7. Parent node transitions to "completed" once both child tasks complete; barrier releases and Triage node activates
    // -------------------------------------------------------------------------
    const parentExecPostBoth = await getExecution(parentExecId);
    assert(parentExecPostBoth);
    assertEquals(
      parentExecPostBoth.nodeStates["node-dev"].status,
      "completed",
      "Parent node must automatically transition to completed once all child tasks complete",
    );

    // Barrier releases: node-barrier is now eligible
    const releasedNextNodes = await findNextNodes(parentExecPostBoth, "node-dev");
    assertEquals(releasedNextNodes.length, 1);
    assertEquals(releasedNextNodes[0].id, "node-barrier");

    // Complete barrier synchronization node, which activates downstream triage node
    const barrierAdvanceRes = await workflowStepAdvanceTool.execute({
      executionId: parentExecId,
      nodeId: "node-barrier",
      status: "completed",
    });
    const barrierAdvanceData = parseResult(barrierAdvanceRes);
    assertEquals(barrierAdvanceData.activatedNodes.length, 1);
    assertEquals(barrierAdvanceData.activatedNodes[0].id, "node-triage");
    assertEquals(barrierAdvanceData.execution.nodeStates["node-triage"].status, "running");

    // -------------------------------------------------------------------------
    // 8. Decision node evaluates review status (reviewStatus == "rejected" or loopCount < 3),
    //    routes failing task back to developer via task_handoff(action: "reject"), incrementing rejectionCount
    // -------------------------------------------------------------------------
    const triageEvalRes = await workflowStepAdvanceTool.execute({
      executionId: parentExecId,
      nodeId: "node-triage",
      status: "completed",
      data: { reviewStatus: "rejected", loopCount: 1 },
    });
    const triageEvalData = parseResult(triageEvalRes);
    assertEquals(triageEvalData.activatedNodes.length, 1);
    assertEquals(triageEvalData.activatedNodes[0].id, "node-rework");

    // Route failing task back to developer via task_handoff(action: "reject")
    const rejectHandoffRes = await taskHandoffTool.execute({
      taskId: devTask1Id,
      action: "reject",
      toRole: "developer",
      reason: "Adversarial review identified input validation bypass defect in Module A",
      contextSummary: "Rejection in adversarial review: Module A fails on boundary string validation.",
      feedback: [
        "Add strict regex check on token input",
        "Add unit test cases for zero-length and 4KB payload boundaries",
      ],
      rejectedApproaches: ["Permissive string check without boundary length validation"],
    });
    const rejectHandoffData = parseResult(rejectHandoffRes);
    assertEquals(rejectHandoffData.task.rejectionCount, 1, "rejectionCount must be incremented to 1");
    assertEquals(rejectHandoffData.task.status, "open", "Task must revert to open status on rejection");
    assertEquals(rejectHandoffData.task.role, "developer");
    assertEquals(rejectHandoffData.handoffRecord.action, "reject");

    // -------------------------------------------------------------------------
    // 9. Developer fixes and passes re-review
    // -------------------------------------------------------------------------
    const claimRes = await claimTaskTool.execute({
      taskId: devTask1Id,
      assignee: "dev-agent-1",
      role: "developer",
    });
    const claimData = parseResult(claimRes);
    assertEquals(claimData.task.status, "claimed");
    assertEquals(claimData.task.assignee, "dev-agent-1");

    // Developer completes rework node with applied fixes
    const reworkAdvanceRes = await workflowStepAdvanceTool.execute({
      executionId: parentExecId,
      nodeId: "node-rework",
      status: "completed",
      data: { fixed: true },
      feedback: "Applied strict boundary validation and regex sanitization.",
    });
    const reworkAdvanceData = parseResult(reworkAdvanceRes);
    // Loop back to node-triage
    assertEquals(reworkAdvanceData.activatedNodes[0].id, "node-triage");

    // Re-review passes at triage: reviewStatus == "approved"
    const reTriageRes = await workflowStepAdvanceTool.execute({
      executionId: parentExecId,
      nodeId: "node-triage",
      status: "completed",
      data: { reviewStatus: "approved" },
    });
    const reTriageData = parseResult(reTriageRes);
    assertEquals(reTriageData.activatedNodes.length, 1);
    assertEquals(reTriageData.activatedNodes[0].id, "node-qa");

    // -------------------------------------------------------------------------
    // 10. Final QA node activates, queries architectural memories, posts completion message, and workflow run completes
    // -------------------------------------------------------------------------
    const currentExecQA = await getExecution(parentExecId);
    assert(currentExecQA);
    assertEquals(currentExecQA.nodeStates["node-qa"].status, "running");

    // QA queries architectural memories saved in step 1
    const recalledMem = await memoryRecallTool.execute({
      workflowId: wfId,
      key: "architecture-spec",
    });
    const recalledMemData = parseResult(recalledMem);
    assert(recalledMemData.memory);
    assertEquals(recalledMemData.memory.key, "architecture-spec");
    assertEquals(recalledMemData.memory.tags, ["architecture", "spec"]);
    assert(recalledMemData.memory.content.includes("Architectural blueprint"));

    // QA searches architectural memories by keyword query
    const searchMem = await memorySearchTool.execute({
      workflowId: wfId,
      query: "architecture barrier",
      format: "json",
    });
    const searchMemData = parseResult(searchMem);
    assert(searchMemData.count >= 1);
    assertEquals(searchMemData.hits[0].memory.key, "architecture-spec");

    // QA posts certification message to workflow execution message board
    const qaMessageRes = await workflowMessagePostTool.execute({
      executionId: parentExecId,
      content: "All developer implementations and adversarial review rework items verified green against architecture spec.",
      author: "qa-lead",
      role: "qa-engineer",
      nodeId: "node-qa",
      topic: "qa_certification",
    });
    const qaMessageData = parseResult(qaMessageRes);
    assert(qaMessageData.message?.id);
    assertEquals(qaMessageData.message.topic, "qa_certification");

    // QA node completes
    await workflowStepAdvanceTool.execute({
      executionId: parentExecId,
      nodeId: "node-qa",
      status: "completed",
    });

    // Workflow execution completes
    const runCompleteRes = await workflowRunCompleteTool.execute({
      executionId: parentExecId,
      status: "completed",
      finalSummary: "Certified multi-agent pipeline: Architecture, Devs, Review, Triage loop, and QA Gate passed 100% green.",
    });
    const runCompleteData = parseResult(runCompleteRes);
    assertEquals(runCompleteData.status, "completed");

    // Verify final state and execution messages
    const finalExec = await getExecution(parentExecId);
    assert(finalExec);
    assertEquals(finalExec.status, "completed");
    assertEquals(finalExec.nodeStates["node-qa"].status, "completed");

    const finalMessagesRes = await workflowMessageReadTool.execute({
      executionId: parentExecId,
    });
    const finalMessagesData = parseResult(finalMessagesRes);
    assert(finalMessagesData.messages.length >= 3); // 2 child completion messages + 1 QA message
    assert(finalMessagesData.messages.some((m: { topic?: string }) => m.topic === "child_completion"));
    assert(finalMessagesData.messages.some((m: { topic?: string }) => m.topic === "qa_certification"));
  } finally {
    kv.close();
  }
});
