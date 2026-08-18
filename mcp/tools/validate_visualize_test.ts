import { assert, assertEquals } from "@std/assert";
import { saveEdge, saveNode, saveWorkflow, setKv } from "../../store/kv.ts";
import type { Workflow, WorkflowEdge, WorkflowNode } from "../../store/types.ts";
import { validateWorkflowTool } from "./validate_workflow.ts";
import { visualizeWorkflowTool } from "./visualize_workflow.ts";

Deno.test("validateWorkflowTool and visualizeWorkflowTool test", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    const now = new Date().toISOString();
    const workflowId = "wf-1";

    const workflow: Workflow = {
      id: workflowId,
      name: "Order Processing",
      description: "Handles order processing flow",
      createdAt: now,
      updatedAt: now,
    };

    const startNode: WorkflowNode = {
      id: "node-start",
      workflowId,
      type: "start",
      name: "Start",
      description: "Start node",
      runInSubAgent: false,
      config: {},
      status: "completed",
      error: null,
      createdAt: now,
      updatedAt: now,
    };

    const stepNode: WorkflowNode = {
      id: "node-step",
      workflowId,
      type: "step",
      name: "Check Stock",
      description: "Check inventory",
      runInSubAgent: false,
      config: {},
      status: "running",
      error: null,
      createdAt: now,
      updatedAt: now,
    };

    const decisionNode: WorkflowNode = {
      id: "node-decision",
      workflowId,
      type: "decision",
      name: "In Stock?",
      description: "Branch based on stock",
      runInSubAgent: false,
      config: { options: ["yes", "no"] },
      status: "pending",
      error: null,
      createdAt: now,
      updatedAt: now,
    };

    const endNode: WorkflowNode = {
      id: "node-end",
      workflowId,
      type: "end",
      name: "End",
      description: "End node",
      runInSubAgent: false,
      config: {},
      status: "skipped",
      error: null,
      createdAt: now,
      updatedAt: now,
    };

    const edges: WorkflowEdge[] = [
      {
        id: "edge-1",
        workflowId,
        fromNodeId: "node-start",
        toNodeId: "node-step",
      },
      {
        id: "edge-2",
        workflowId,
        fromNodeId: "node-step",
        toNodeId: "node-decision",
      },
      {
        id: "edge-3",
        workflowId,
        fromNodeId: "node-decision",
        toNodeId: "node-end",
        condition: "yes",
      },
      {
        id: "edge-4",
        workflowId,
        fromNodeId: "node-decision",
        toNodeId: "node-end",
        condition: "no",
      },
    ];

    await saveWorkflow(workflow);
    await saveNode(startNode);
    await saveNode(stepNode);
    await saveNode(decisionNode);
    await saveNode(endNode);
    for (const e of edges) {
      await saveEdge(e);
    }

    // Test validation tool
    const valRes = await validateWorkflowTool.execute({ workflowId });
    assert(!valRes.isError);
    const valData = JSON.parse(valRes.content[0].text);
    assertEquals(valData.valid, true);
    assertEquals(valData.errors.length, 0);

    // Test visualization tool
    const visRes = await visualizeWorkflowTool.execute({ workflowId, format: "mermaid" });
    assert(!visRes.isError);
    const visText = visRes.content[0].text;
    assert(visText.includes("flowchart TD"));
    assert(visText.includes('node_start(["✅ Start"])'));
    assert(visText.includes('node_step["🔄 Check Stock"]'));
    assert(visText.includes('node_decision{"⏳ In Stock?"}'));
    assert(visText.includes('node_end(["⏭️ End"])'));
    assert(visText.includes("node_start --> node_step"));
    assert(visText.includes("node_decision -->|yes| node_end"));
    assert(visText.includes("node_decision -->|no| node_end"));

    // Test not found error cases
    const notFoundVal = await validateWorkflowTool.execute({ workflowId: "nonexistent" });
    assert(notFoundVal.isError);

    const notFoundVis = await visualizeWorkflowTool.execute({ workflowId: "nonexistent" });
    assert(notFoundVis.isError);
  } finally {
    kv.close();
  }
});

import { addNodeTool } from "./add_node.ts";
import { connectNodesTool } from "./connect_nodes.ts";
import { createWorkflowTool } from "./create_workflow.ts";

Deno.test("visualizeWorkflowTool - sanitizes quotes, newlines, HTML and condition pipes", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    const createRes = await createWorkflowTool.execute({ name: "Sanitization Workflow" });
    const { workflow, startNode } = JSON.parse(createRes.content[0].text);

    const stepRes = await addNodeTool.execute({
      workflowId: workflow.id,
      type: "step",
      name: 'Run "Special" & <script>alert(1)</script>\nNext Line',
      description: "Handles tricky characters",
    });
    const stepNode = JSON.parse(stepRes.content[0].text);

    const connRes = await connectNodesTool.execute({
      workflowId: workflow.id,
      fromNodeId: startNode.id,
      toNodeId: stepNode.id,
      condition: 'opt1|opt2 "quoted"',
    });
    assert(!connRes.isError);

    const visRes = await visualizeWorkflowTool.execute({ workflowId: workflow.id });
    assert(!visRes.isError);
    const text = visRes.content[0].text;

    assert(!text.includes("<script>"));
    assert(text.includes("&lt;script>"));
    assert(!text.includes('"Special"'));
    assert(text.includes("#quot;Special#quot;"));
    assert(text.includes("opt1/opt2 #quot;quoted#quot;"));
  } finally {
    kv.close();
  }
});

Deno.test("visualizeWorkflowTool - renders user_interaction node as parallelogram with 👤", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    const createRes = await createWorkflowTool.execute({ name: "User Interaction Visualization" });
    const { workflow, startNode } = JSON.parse(createRes.content[0].text);

    const userRes = await addNodeTool.execute({
      workflowId: workflow.id,
      type: "user_interaction",
      name: "Confirm Rollout",
      description: "Ask user for approval",
      config: {
        prompt: "Approve deployment?",
        options: ["approve", "reject"],
      },
    });
    const userNode = JSON.parse(userRes.content[0].text);

    await connectNodesTool.execute({
      workflowId: workflow.id,
      fromNodeId: startNode.id,
      toNodeId: userNode.id,
    });

    const visRes = await visualizeWorkflowTool.execute({
      workflowId: workflow.id,
      format: "mermaid",
    });
    assert(!visRes.isError);
    const text = visRes.content[0].text;

    assert(text.includes("Confirm Rollout"));
    assert(text.includes('{{"⏳ Confirm Rollout 👤"}}'));
  } finally {
    kv.close();
  }
});

import { startWorkflowTool } from "./start_workflow.ts";
import { getNextStepTool } from "./get_next_step.ts";

Deno.test("visualizeWorkflowTool - exports interactive HTML with subworkflows, prompts, and iteration history", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  const testHtmlFile = "./test_workflow_interactive_visualizer.html";

  try {
    // 1. Create Child Subworkflow
    const childWfRes = await createWorkflowTool.execute({
      name: "Data Extraction Subworkflow",
      description: "Extracts and validates raw records",
      intendedForIndependentRun: false,
    });
    const { workflow: childWf, startNode: childStart } = JSON.parse(childWfRes.content[0].text);

    const childStepRes = await addNodeTool.execute({
      workflowId: childWf.id,
      type: "step",
      name: "Parse JSON Records",
      description: "Extract JSON documents from raw payloads and validate schema.",
    });
    const childStepNode = JSON.parse(childStepRes.content[0].text);

    await connectNodesTool.execute({
      workflowId: childWf.id,
      fromNodeId: childStart.id,
      toNodeId: childStepNode.id,
    });

    // 2. Create Parent Main Workflow
    const parentWfRes = await createWorkflowTool.execute({
      name: "Main Pipeline",
      description: "Top-level orchestrator pipeline",
      intendedForIndependentRun: true,
    });
    const { workflow: parentWf, startNode: parentStart } = JSON.parse(parentWfRes.content[0].text);

    // Add subworkflow node
    const subNodeRes = await addNodeTool.execute({
      workflowId: parentWf.id,
      type: "subworkflow",
      name: "Run Data Extraction",
      description: "Delegate record parsing to subworkflow",
      config: {
        childWorkflowId: childWf.id,
      },
    });
    const subNode = JSON.parse(subNodeRes.content[0].text);

    await connectNodesTool.execute({
      workflowId: parentWf.id,
      fromNodeId: parentStart.id,
      toNodeId: subNode.id,
    });

    // 3. Start execution and run a step to produce iteration history
    const startExecRes = await startWorkflowTool.execute({
      workflowId: parentWf.id,
      format: "json",
    });
    assert(!startExecRes.isError);
    const startData = JSON.parse(startExecRes.content[0].text);
    const executionId = startData.executionId;
    assert(executionId, "Execution ID should be present");

    // Advance start node
    await getNextStepTool.execute({
      executionId,
      nodeId: parentStart.id,
      status: "completed",
    });

    // 4. Test visualize with format: "html" and custom filePath
    const visHtmlRes = await visualizeWorkflowTool.execute({
      workflowId: parentWf.id,
      executionId,
      format: "html",
      filePath: testHtmlFile,
    });

    assert(!visHtmlRes.isError);
    const summaryMd = visHtmlRes.content[0].text;
    assert(summaryMd.includes("Interactive Workflow Visualizer Generated"));
    assert(summaryMd.includes("Saved File"));
    assert(summaryMd.includes("**Subworkflows Bundled**: 1"));

    // 5. Verify HTML file exists and contains expected interactive features & embedded data
    const fileStat = await Deno.stat(testHtmlFile);
    assert(fileStat.isFile);
    assert(fileStat.size > 1000);

    const htmlContent = await Deno.readTextFile(testHtmlFile);
    assert(htmlContent.includes("<!DOCTYPE html>"));
    assert(htmlContent.includes("cytoscape"));
    assert(htmlContent.includes("Main Pipeline"));
    assert(htmlContent.includes("Data Extraction Subworkflow"));
    assert(htmlContent.includes("Extract JSON documents from raw payloads"));
    assert(htmlContent.includes("insp-drilldown-btn"));
    assert(htmlContent.includes("insp-prompt"));
  } finally {
    try {
      await Deno.remove(testHtmlFile);
    } catch {
      // ignore
    }
    kv.close();
  }
});
