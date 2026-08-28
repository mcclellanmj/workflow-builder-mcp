import { assert, assertEquals } from "@std/assert";
import { setKv } from "../../store/kv.ts";
import { createWorkflowTool } from "./create_workflow.ts";
import { listWorkflowsTool } from "./list_workflows.ts";
import { getWorkflowTool } from "./get_workflow.ts";
import { deleteWorkflowTool } from "./delete_workflow.ts";

Deno.test("Workflow CRUD MCP tools lifecycle test", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    // 1. Create workflow
    const createRes = await createWorkflowTool.execute({
      name: "Test Workflow",
      description: "A test workflow description",
    });
    assert(!createRes.isError, "createWorkflowTool failed");
    const createdData = JSON.parse(createRes.content[0].text);
    assertEquals(createdData.workflow.name, "Test Workflow");
    assertEquals(createdData.workflow.description, "A test workflow description");
    assertEquals(createdData.startNode.type, "start");
    assertEquals(createdData.startNode.name, "Start");
    assertEquals(createdData.startNode.description, "Workflow entry point");
    assertEquals(createdData.startNode.status, "pending");

    const workflowId = createdData.workflow.id;

    const parseResponseJson = (
      res: {
        content: Array<{ type: string; text: string; annotations?: { audience?: string[] } }>;
      },
    ) => {
      const jsonItem = res.content.find((c) => c.annotations?.audience?.includes("assistant")) ??
        res.content[res.content.length - 1];
      return JSON.parse(jsonItem.text);
    };

    // 2. List workflows
    const listRes = await listWorkflowsTool.execute({});
    assert(!listRes.isError, "listWorkflowsTool failed");
    const listData = parseResponseJson(listRes);
    assertEquals(listData.length, 1);
    assertEquals(listData[0].id, workflowId);
    assertEquals(listData[0].name, "Test Workflow");

    // 3. Get workflow
    const getRes = await getWorkflowTool.execute({ workflowId });
    assert(!getRes.isError, "getWorkflowTool failed");
    const getData = JSON.parse(getRes.content[0].text);
    assertEquals(getData.workflow.id, workflowId);
    assertEquals(getData.nodes.length, 1);
    assertEquals(getData.nodes[0].id, createdData.startNode.id);
    assertEquals(getData.edges.length, 0);

    // 4. Delete workflow
    const deleteRes = await deleteWorkflowTool.execute({ workflowId });
    assert(!deleteRes.isError, "deleteWorkflowTool failed");
    const deleteData = JSON.parse(deleteRes.content[0].text);
    assertEquals(deleteData.workflowId, workflowId);

    // 5. Verify get returns error after deletion
    const getAfterDelete = await getWorkflowTool.execute({ workflowId });
    assert(getAfterDelete.isError, "Expected error after workflow deletion");

    // 6. Verify list is empty
    const listAfterDelete = await listWorkflowsTool.execute({});
    const listAfterDeleteData = parseResponseJson(listAfterDelete);
    assertEquals(listAfterDeleteData.length, 0);
  } finally {
    kv.close();
  }
});

import { addNodeTool } from "./add_node.ts";
import { connectNodesTool } from "./connect_nodes.ts";
import { disconnectNodesTool } from "./disconnect_nodes.ts";

Deno.test("disconnectNodesTool - disconnect edge and post-disconnection warnings", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    const createRes = await createWorkflowTool.execute({ name: "Disconnect Test Workflow" });
    const { workflow, startNode } = JSON.parse(createRes.content[0].text);

    const stepRes = await addNodeTool.execute({
      workflowId: workflow.id,
      type: "step",
      name: "Step 1",
      description: "Perform task",
    });
    const stepNode = JSON.parse(stepRes.content[0].text);

    // Connect Start -> Step 1
    const connRes = await connectNodesTool.execute({
      workflowId: workflow.id,
      fromNodeId: startNode.id,
      toNodeId: stepNode.id,
    });
    assert(!connRes.isError);

    // Disconnect nonexistent edge
    const failDisconn = await disconnectNodesTool.execute({
      workflowId: workflow.id,
      fromNodeId: stepNode.id,
      toNodeId: startNode.id,
    });
    assert(failDisconn.isError);

    // Disconnect Start -> Step 1 (should warn about step 1 becoming unreachable)
    const disconnRes = await disconnectNodesTool.execute({
      workflowId: workflow.id,
      fromNodeId: startNode.id,
      toNodeId: stepNode.id,
    });
    assert(!disconnRes.isError);
    const disconnData = JSON.parse(disconnRes.content[0].text);
    assertEquals(disconnData.deletedEdge.fromNodeId, startNode.id);
    assertEquals(disconnData.deletedEdge.toNodeId, stepNode.id);
    assert(disconnData.warnings && disconnData.warnings.length > 0);
  } finally {
    kv.close();
  }
});

import { saveNodes } from "../../store/kv.ts";
import type { WorkflowNode } from "../../store/types.ts";

Deno.test("KV Atomic Chunking - deleteWorkflow and saveNodes with large node counts", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    const createRes = await createWorkflowTool.execute({ name: "Bulk Workflow" });
    const { workflow } = JSON.parse(createRes.content[0].text);

    // Create 600 nodes (exceeding single MAX_ATOMIC_OPS of 500)
    const bulkNodes: WorkflowNode[] = [];
    for (let i = 0; i < 600; i++) {
      bulkNodes.push({
        id: `bulk-node-${i}`,
        workflowId: workflow.id,
        type: "step",
        name: `Bulk Step ${i}`,
        description: `Description ${i}`,
        runInSubAgent: false,
        config: {},
        status: "pending",
        error: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }

    await saveNodes(bulkNodes);

    // Delete workflow with 600+ entries across multiple chunked batches
    const deleteRes = await deleteWorkflowTool.execute({ workflowId: workflow.id });
    assert(!deleteRes.isError, "deleteWorkflowTool failed on bulk nodes");
  } finally {
    kv.close();
  }
});

import { listExecutions, listReferencedChildWorkflowIds, saveExecution } from "../../store/kv.ts";

Deno.test("Subworkflow reference indexing and batched execution lookups", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    const parentRes = await createWorkflowTool.execute({ name: "Parent Workflow" });
    const parentWf = JSON.parse(parentRes.content[0].text).workflow;

    const childRes = await createWorkflowTool.execute({ name: "Child Subworkflow" });
    const childWf = JSON.parse(childRes.content[0].text).workflow;

    // Add subworkflow node referencing childWf
    await addNodeTool.execute({
      workflowId: parentWf.id,
      type: "subworkflow",
      name: "Run Child",
      description: "Invokes child workflow",
      config: { childWorkflowId: childWf.id },
    });

    const referenced = await listReferencedChildWorkflowIds();
    assert(referenced.has(childWf.id), "Expected child workflow to be indexed");

    // Test batched listExecutions
    for (let i = 0; i < 5; i++) {
      await saveExecution({
        id: `exec-${i}`,
        workflowId: parentWf.id,
        status: "completed",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        nodeStates: {},
      });
    }

    const execs = await listExecutions(parentWf.id);
    assertEquals(execs.length, 5);
  } finally {
    kv.close();
  }
});
