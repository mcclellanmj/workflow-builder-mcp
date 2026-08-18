import { assert, assertEquals } from "@std/assert";
import { setKv } from "../../store/kv.ts";
import {
  addNodeTool,
  connectNodesTool,
  createWorkflowTool,
  extractSubworkflowTool,
  listNodesTool,
  listWorkflowsTool,
  validateWorkflowTool,
} from "./index.ts";

async function setupFreshKv(): Promise<Deno.Kv> {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);
  return kv;
}

Deno.test("workflow_extract_subworkflow - extracts linear chain into child sub-workflow", async () => {
  const kv = await setupFreshKv();

  // 1. Create parent workflow
  const createRes = await createWorkflowTool.execute({
    name: "Parent Pipeline",
    description: "Main data ingestion pipeline",
  });
  const createData = JSON.parse(createRes.content[0].text);
  const parentWfId = createData.workflow.id;
  const startNodeId = createData.startNode.id;

  // 2. Add 4 sequential steps and an end node
  const s1 = JSON.parse(
    (await addNodeTool.execute({
      workflowId: parentWfId,
      type: "step",
      name: "Step 1",
      description: "Fetch",
    })).content[0].text,
  );
  const s2 = JSON.parse(
    (await addNodeTool.execute({
      workflowId: parentWfId,
      type: "step",
      name: "Step 2",
      description: "Parse",
    })).content[0].text,
  );
  const s3 = JSON.parse(
    (await addNodeTool.execute({
      workflowId: parentWfId,
      type: "step",
      name: "Step 3",
      description: "Transform",
    })).content[0].text,
  );
  const s4 = JSON.parse(
    (await addNodeTool.execute({
      workflowId: parentWfId,
      type: "step",
      name: "Step 4",
      description: "Save",
    })).content[0].text,
  );
  const end = JSON.parse(
    (await addNodeTool.execute({
      workflowId: parentWfId,
      type: "end",
      name: "End",
      description: "Done",
    })).content[0].text,
  );

  // Connect them: start -> s1 -> s2 -> s3 -> s4 -> end
  await connectNodesTool.execute({
    workflowId: parentWfId,
    fromNodeId: startNodeId,
    toNodeId: s1.id,
  });
  await connectNodesTool.execute({ workflowId: parentWfId, fromNodeId: s1.id, toNodeId: s2.id });
  await connectNodesTool.execute({ workflowId: parentWfId, fromNodeId: s2.id, toNodeId: s3.id });
  await connectNodesTool.execute({ workflowId: parentWfId, fromNodeId: s3.id, toNodeId: s4.id });
  await connectNodesTool.execute({ workflowId: parentWfId, fromNodeId: s4.id, toNodeId: end.id });

  // 3. Extract s2 & s3 into a child sub-workflow
  const extractRes = await extractSubworkflowTool.execute({
    parentWorkflowId: parentWfId,
    nodeIds: [s2.id, s3.id],
    subworkflowName: "Parse & Transform",
    subworkflowDescription: "Encapsulated parsing and transformation routines",
  });
  assertEquals(extractRes.isError, undefined);
  const extractData = JSON.parse(extractRes.content[0].text);
  const childWfId = extractData.childWorkflow.id;
  const parentSubNodeId = extractData.parentSubworkflowNode.id;
  assert(parentSubNodeId);

  assertEquals(extractData.childWorkflow.intendedForIndependentRun, false);

  // 4. Validate Child Workflow structure
  const childValidation = JSON.parse(
    (await validateWorkflowTool.execute({ workflowId: childWfId })).content[0].text,
  );
  assertEquals(childValidation.valid, true);
  assertEquals(childValidation.errors.length, 0);

  // 5. Validate Parent Workflow structure
  const parentValidation = JSON.parse(
    (await validateWorkflowTool.execute({ workflowId: parentWfId })).content[0].text,
  );
  assertEquals(parentValidation.valid, true);
  assertEquals(parentValidation.errors.length, 0);

  // Check parent nodes: should contain start, s1, parentSubNode, s4, end
  const parentNodesRes = await listNodesTool.execute({ workflowId: parentWfId });
  const parentNodes = JSON.parse(parentNodesRes.content[1].text);
  const parentNodeNames = parentNodes.map((n: { name: string }) => n.name);
  assertEquals(parentNodeNames.includes("Step 2"), false);
  assertEquals(parentNodeNames.includes("Step 3"), false);
  assertEquals(parentNodeNames.includes("Parse & Transform"), true);

  // 6. Test workflow_list filtering
  // Default filter (standalone): should only return parent workflow
  const listDefaultRes = await listWorkflowsTool.execute({ filter: "standalone" });
  const listDefault = JSON.parse(listDefaultRes.content[1].text);
  assertEquals(listDefault.length, 1);
  assertEquals(listDefault[0].id, parentWfId);
  assertEquals(listDefault[0].type, "standalone");

  // filter: "subworkflows": should only return child workflow
  const listSubRes = await listWorkflowsTool.execute({ filter: "subworkflows" });
  const listSub = JSON.parse(listSubRes.content[1].text);
  assertEquals(listSub.length, 1);
  assertEquals(listSub[0].id, childWfId);
  assertEquals(listSub[0].type, "subworkflow");

  // filter: "all": should return both
  const listAllRes = await listWorkflowsTool.execute({ filter: "all" });
  const listAll = JSON.parse(listAllRes.content[1].text);
  assertEquals(listAll.length, 2);

  kv.close();
});

Deno.test("workflow_extract_subworkflow - prevents extracting start or end nodes", async () => {
  const kv = await setupFreshKv();

  const createRes = await createWorkflowTool.execute({ name: "Validation Test" });
  const createData = JSON.parse(createRes.content[0].text);
  const parentWfId = createData.workflow.id;
  const startNodeId = createData.startNode.id;

  const end = JSON.parse(
    (await addNodeTool.execute({
      workflowId: parentWfId,
      type: "end",
      name: "End",
      description: "Done",
    })).content[0].text,
  );

  // Attempting to extract start node
  const startExtractRes = await extractSubworkflowTool.execute({
    parentWorkflowId: parentWfId,
    nodeIds: [startNodeId],
    subworkflowName: "Invalid Start Extract",
  });
  assertEquals(startExtractRes.isError, true);
  assert(startExtractRes.content[0].text.includes("start"));

  // Attempting to extract end node
  const endExtractRes = await extractSubworkflowTool.execute({
    parentWorkflowId: parentWfId,
    nodeIds: [end.id],
    subworkflowName: "Invalid End Extract",
  });
  assertEquals(endExtractRes.isError, true);
  assert(endExtractRes.content[0].text.includes("end"));

  kv.close();
});
