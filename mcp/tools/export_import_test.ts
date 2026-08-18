import { assert, assertEquals } from "@std/assert";
import { setKv } from "../../store/kv.ts";
import type {
  WorkflowExportBundle,
  WorkflowImportResult,
  WorkflowNode,
} from "../../store/types.ts";
import { addNodeTool } from "./add_node.ts";
import { connectNodesTool } from "./connect_nodes.ts";
import { createWorkflowTool } from "./create_workflow.ts";
import { exportWorkflowTool } from "./export_workflow.ts";
import { getNextStepTool } from "./get_next_step.ts";
import { getWorkflowTool } from "./get_workflow.ts";
import { importWorkflowTool } from "./import_workflow.ts";
import { startWorkflowTool } from "./start_workflow.ts";

async function createFreshKv(): Promise<Deno.Kv> {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);
  return kv;
}

const parseResponseJson = (res: {
  content: Array<{ type: string; text: string; annotations?: { audience?: string[] } }>;
}) => {
  const jsonItem = res.content.find((c) => c.annotations?.audience?.includes("assistant")) ??
    res.content[res.content.length - 1];
  return JSON.parse(jsonItem.text);
};

const parseResponseMarkdown = (res: {
  content: Array<{ type: string; text: string; annotations?: { audience?: string[] } }>;
}) => {
  const mdItem = res.content.find((c) => c.annotations?.audience?.includes("user")) ??
    res.content[0];
  return mdItem.text;
};

Deno.test("Workflow Export & Import - Basic roundtrip and overwrite handling", async () => {
  await createFreshKv();

  // 1. Create a workflow
  const createRes = await createWorkflowTool.execute({
    name: "Release Pipeline",
    description: "Build, test, deploy pipeline",
  });
  const { workflow, startNode } = JSON.parse(createRes.content[0].text);
  const workflowId = workflow.id;

  const buildRes = await addNodeTool.execute({
    workflowId,
    type: "step",
    name: "Build App",
    description: "Compile source code",
  });
  const buildNode = JSON.parse(buildRes.content[0].text);

  const endRes = await addNodeTool.execute({
    workflowId,
    type: "end",
    name: "Finish",
    description: "Release finished",
  });
  const endNode = JSON.parse(endRes.content[0].text);

  await connectNodesTool.execute({ workflowId, fromNodeId: startNode.id, toNodeId: buildNode.id });
  await connectNodesTool.execute({ workflowId, fromNodeId: buildNode.id, toNodeId: endNode.id });

  // 2. Export workflow
  const exportRes = await exportWorkflowTool.execute({
    workflowId,
    format: "both",
  });
  assertEquals(exportRes.isError, undefined);
  const bundle = parseResponseJson(exportRes) as WorkflowExportBundle;
  const mdExport = parseResponseMarkdown(exportRes);

  assertEquals(bundle.version, "1.0");
  assertEquals(bundle.workflow.workflow.name, "Release Pipeline");
  assertEquals(bundle.workflow.nodes.length, 3);
  assertEquals(bundle.workflow.edges.length, 2);
  assert(mdExport.includes("📦 Workflow Export"));

  // 3. Attempt import without remap or overwrite (should fail due to collision)
  const failImport = await importWorkflowTool.execute({
    data: bundle,
    remapIds: false,
    overwrite: false,
  });
  assertEquals(failImport.isError, true);
  assert(failImport.content[0].text.includes("already exists"));

  // 4. Overwrite import
  const overwriteImport = await importWorkflowTool.execute({
    data: bundle,
    overwrite: true,
    validate: true,
  });
  assertEquals(overwriteImport.isError, undefined);
  const overwriteResult = parseResponseJson(overwriteImport) as WorkflowImportResult;
  assertEquals(overwriteResult.primaryWorkflowId, workflowId);
  assertEquals(overwriteResult.totalNodes, 3);
  assertEquals(overwriteResult.totalEdges, 2);
  assertEquals(overwriteResult.validation?.valid, true);

  // 5. Verify graph in store
  const getRes = await getWorkflowTool.execute({ workflowId });
  const fetched = JSON.parse(getRes.content[0].text);
  assertEquals(fetched.workflow.name, "Release Pipeline");
  assertEquals(fetched.nodes.length, 3);
  assertEquals(fetched.edges.length, 2);
});

Deno.test("Workflow Export & Import - Subworkflow bundling and ID remapping / cloning", async () => {
  await createFreshKv();

  // 1. Create child subworkflow
  const childCreate = await createWorkflowTool.execute({
    name: "Child Subworkflow",
    description: "Inner subworkflow tasks",
    intendedForIndependentRun: false,
  });
  const { workflow: childWf, startNode: childStart } = JSON.parse(childCreate.content[0].text);
  const childStepRes = await addNodeTool.execute({
    workflowId: childWf.id,
    type: "step",
    name: "Child Step",
    description: "Execute child action",
  });
  const childStep = JSON.parse(childStepRes.content[0].text);
  await connectNodesTool.execute({
    workflowId: childWf.id,
    fromNodeId: childStart.id,
    toNodeId: childStep.id,
  });

  // 2. Create parent workflow referencing child
  const parentCreate = await createWorkflowTool.execute({
    name: "Parent Master Workflow",
    description: "Top-level orchestrator",
  });
  const { workflow: parentWf, startNode: parentStart } = JSON.parse(parentCreate.content[0].text);

  const subNodeRes = await addNodeTool.execute({
    workflowId: parentWf.id,
    type: "subworkflow",
    name: "Run Child Workflow",
    description: "Delegate to child workflow",
    config: { childWorkflowId: childWf.id, maxIterations: 5 },
  });
  const subNode = JSON.parse(subNodeRes.content[0].text);

  const parentEndRes = await addNodeTool.execute({
    workflowId: parentWf.id,
    type: "end",
    name: "Parent End",
    description: "Parent done",
  });
  const parentEnd = JSON.parse(parentEndRes.content[0].text);

  await connectNodesTool.execute({
    workflowId: parentWf.id,
    fromNodeId: parentStart.id,
    toNodeId: subNode.id,
  });
  await connectNodesTool.execute({
    workflowId: parentWf.id,
    fromNodeId: subNode.id,
    toNodeId: parentEnd.id,
  });

  // 3. Export parent workflow (with recursive subworkflows)
  const exportRes = await exportWorkflowTool.execute({
    workflowId: parentWf.id,
    includeSubworkflows: true,
  });
  const bundle = parseResponseJson(exportRes) as WorkflowExportBundle;
  assertEquals(bundle.subworkflows?.length, 1);
  assertEquals(bundle.subworkflows?.[0].workflow.id, childWf.id);

  // 4. Import with remapIds: true (clone with new UUIDs)
  const importRes = await importWorkflowTool.execute({
    data: JSON.stringify(bundle), // test JSON string input parsing
    remapIds: true,
    validate: true,
  });
  assertEquals(importRes.isError, undefined);
  const importResult = parseResponseJson(importRes) as WorkflowImportResult;

  assertEquals(importResult.remapped, true);
  assert(importResult.primaryWorkflowId !== parentWf.id);
  assertEquals(importResult.importedWorkflowIds.length, 2);
  assertEquals(importResult.validation?.valid, true);

  // Check that new child workflow exists
  const newChildWfId = importResult.idMap?.workflows[childWf.id];
  assert(newChildWfId, "Expected new child workflow ID in mapping");
  assert(newChildWfId !== childWf.id);

  // Verify the cloned parent workflow has its subworkflow node child ID remapped
  const getParentClone = await getWorkflowTool.execute({
    workflowId: importResult.primaryWorkflowId,
  });
  const parentCloneData = JSON.parse(getParentClone.content[0].text);
  const clonedSubNode = parentCloneData.nodes.find((n: WorkflowNode) => n.type === "subworkflow");
  assert(clonedSubNode);
  assertEquals(clonedSubNode.config.childWorkflowId, newChildWfId);

  // Verify edges in cloned parent connect the new node IDs
  assertEquals(parentCloneData.edges.length, 2);
  for (const edge of parentCloneData.edges) {
    assert(
      edge.fromNodeId !== parentStart.id && edge.fromNodeId !== subNode.id,
      "Edge fromNodeId should be remapped",
    );
  }
});

Deno.test("Workflow Export & Import - Execution runs restoration", async () => {
  await createFreshKv();

  // Create workflow
  const createRes = await createWorkflowTool.execute({
    name: "Execution Test Workflow",
  });
  const { workflow, startNode } = JSON.parse(createRes.content[0].text);
  const stepRes = await addNodeTool.execute({
    workflowId: workflow.id,
    type: "step",
    name: "Step 1",
    description: "Do something",
  });
  const stepNode = JSON.parse(stepRes.content[0].text);
  await connectNodesTool.execute({
    workflowId: workflow.id,
    fromNodeId: startNode.id,
    toNodeId: stepNode.id,
  });

  // Start execution and advance
  const startExec = await startWorkflowTool.execute({
    workflowId: workflow.id,
    format: "json",
  });
  const startExecData = JSON.parse(startExec.content[0].text);
  const executionId = startExecData.executionId;

  await getNextStepTool.execute({
    executionId,
    nodeId: stepNode.id,
    status: "completed",
    format: "json",
  });

  // Export with includeExecutions: true
  const exportRes = await exportWorkflowTool.execute({
    workflowId: workflow.id,
    includeExecutions: true,
    format: "json",
  });
  const bundle = JSON.parse(exportRes.content[0].text) as WorkflowExportBundle;
  assertEquals(bundle.workflow.executions?.length, 1);
  assertEquals(bundle.workflow.executions?.[0].id, executionId);

  // Import with remapIds: true
  const importRes = await importWorkflowTool.execute({
    data: bundle,
    remapIds: true,
  });
  const importResult = parseResponseJson(importRes) as WorkflowImportResult;
  assertEquals(importResult.totalExecutions, 1);

  const newExecId = importResult.idMap?.executions?.[executionId];
  assert(newExecId, "Expected remapped execution ID");

  // Verify getWorkflow with executionId
  const getExecRes = await getWorkflowTool.execute({ executionId: newExecId });
  const execData = JSON.parse(getExecRes.content[0].text);
  assertEquals(execData.execution.id, newExecId);
  assertEquals(execData.execution.workflowId, importResult.primaryWorkflowId);
});

Deno.test("Workflow Export & Import - File path disk export and import", async () => {
  await createFreshKv();

  const createRes = await createWorkflowTool.execute({
    name: "File Pipeline",
    description: "Export directly to disk and import from disk",
  });
  const { workflow } = JSON.parse(createRes.content[0].text);

  const tempFile = await Deno.makeTempFile({ suffix: ".json" });

  try {
    // Export directly to temp file
    const exportRes = await exportWorkflowTool.execute({
      workflowId: workflow.id,
      filePath: tempFile,
      format: "both",
    });
    assertEquals(exportRes.isError, undefined);
    const exportMd = parseResponseMarkdown(exportRes);
    assert(exportMd.includes("Saved to File"));

    // Check that file was written and is valid JSON
    const content = await Deno.readTextFile(tempFile);
    const parsed = JSON.parse(content);
    assertEquals(parsed.version, "1.0");
    assertEquals(parsed.workflow.workflow.name, "File Pipeline");

    // Import from temp file with remapIds
    const importRes = await importWorkflowTool.execute({
      filePath: tempFile,
      remapIds: true,
      validate: true,
    });
    assertEquals(importRes.isError, undefined);
    const importResult = parseResponseJson(importRes) as WorkflowImportResult;
    assertEquals(importResult.remapped, true);
    assert(importResult.primaryWorkflowId !== workflow.id);
  } finally {
    try {
      await Deno.remove(tempFile);
    } catch {
      // ignore
    }
  }
});
