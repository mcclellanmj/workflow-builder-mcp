import { assert, assertEquals } from "@std/assert";
import { setKv } from "../../store/kv.ts";
import { createWorkflowTool } from "./create_workflow.ts";
import { addNodeTool } from "./add_node.ts";
import { editNodeTool } from "./edit_node.ts";
import { getNodeTool } from "./get_node.ts";
import { getWorkflowTool } from "./get_workflow.ts";
import { connectNodesTool } from "./connect_nodes.ts";
import { startWorkflowTool } from "./start_workflow.ts";
import { getNextStepTool } from "./get_next_step.ts";
import { searchWorkflowTool } from "./search_workflow.ts";
import { workflowPatchTool } from "./patch_workflow.ts";
import { workflowTreeTool } from "./tree_workflow.ts";

Deno.test("Name and Slug Resolution - Eliminating UUID Lookup Overhead", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    // 1. Create Child Workflow: "Security Check"
    const childRes = await createWorkflowTool.execute({
      name: "Security Check",
      description: "Sub-workflow for validating security passkeys and auth",
      intendedForIndependentRun: false,
    });
    assert(!childRes.isError);
    const { workflow: childWf } = JSON.parse(childRes.content[0].text);

    // Add nodes to Child Workflow
    const step5Res = await addNodeTool.execute({
      workflow: childWf.id,
      type: "step",
      name: "Step 5-web",
      description: "Perform web authentication vulnerability scanning",
    });
    assert(!step5Res.isError);

    const step6Res = await addNodeTool.execute({
      workflow: childWf.id,
      type: "step",
      name: "Passkey Verification",
      description: "Check account takeover guardrails and passkey credentials",
    });
    assert(!step6Res.isError);

    // 2. Create Parent Workflow: "Review Workflow"
    const parentRes = await createWorkflowTool.execute({
      name: "Review Workflow",
      description: "Main review pipeline",
    });
    assert(!parentRes.isError);
    const { workflow: parentWf } = JSON.parse(parentRes.content[0].text);

    // Add subworkflow node referencing child workflow
    const subNodeRes = await addNodeTool.execute({
      workflow: parentWf.id,
      type: "subworkflow",
      name: "security",
      description: "Executes security checks",
      config: { childWorkflowId: childWf.id },
    });
    assert(!subNodeRes.isError);

    // 3. Connect start -> security using slug and names
    const connRes = await connectNodesTool.execute({
      workflow: "review-workflow",
      fromNode: "Start",
      toNode: "security",
    });
    assert(!connRes.isError);

    // 4. Test workflow_get with slug "review-workflow"
    const getSlugRes = await getWorkflowTool.execute({ workflow: "review-workflow" });
    assert(!getSlugRes.isError);
    const getSlugData = JSON.parse(getSlugRes.content[0].text);
    assertEquals(getSlugData.workflow.id, parentWf.id);
    assertEquals(getSlugData.workflow.name, "Review Workflow");

    // 5. Test hierarchical path resolution: "review-workflow/security"
    const getPathRes = await getWorkflowTool.execute({ workflow: "review-workflow/security" });
    assert(!getPathRes.isError);
    const getPathData = JSON.parse(getPathRes.content[0].text);
    assertEquals(getPathData.workflow.id, childWf.id);
    assertEquals(getPathData.workflow.name, "Security Check");

    // 6. Test node_edit using path and node slug: "Step 5-web"
    const editNodeRes = await editNodeTool.execute({
      workflow: "review-workflow/security",
      node: "step-5-web",
      description: "Updated description for Step 5-web with passkey enforcement",
      runInSubAgent: true,
    });
    assert(!editNodeRes.isError);
    const editNodeData = JSON.parse(editNodeRes.content[0].text);
    assertEquals(editNodeData.name, "Step 5-web");
    assertEquals(
      editNodeData.description,
      "Updated description for Step 5-web with passkey enforcement",
    );
    assertEquals(editNodeData.runInSubAgent, true);

    // 7. Test node_get using exact name "Step 5-web"
    const getNodeRes = await getNodeTool.execute({
      workflow: "review-workflow/security",
      node: "Step 5-web",
    });
    assert(!getNodeRes.isError);
    const getNodeData = JSON.parse(getNodeRes.content[0].text);
    assertEquals(getNodeData.name, "Step 5-web");
    assertEquals(getNodeData.runInSubAgent, true);

    // 8. Test workflow_start using workflow slug: "review-workflow"
    const startRes = await startWorkflowTool.execute({
      workflow: "review-workflow",
      format: "json",
    });
    assert(!startRes.isError);
    const startData = JSON.parse(startRes.content[0].text);
    assert(startData.executionId);
    assertEquals(startData.nextNodes[0].name, "security");

    // 9. Test workflow_next using node slug: "security"
    const nextRes = await getNextStepTool.execute({
      executionId: startData.executionId,
      node: "security",
      status: "completed",
    });
    assert(!nextRes.isError);

    // 10. Test workflow_get with includeSubworkflows: true
    const getWithSubs = await getWorkflowTool.execute({
      workflow: "review-workflow",
      includeSubworkflows: true,
    });
    assert(!getWithSubs.isError);
    const getWithSubsData = JSON.parse(getWithSubs.content[0].text);
    assertEquals(getWithSubsData.workflow.id, parentWf.id);
    assertEquals(getWithSubsData.subworkflows.length, 1);
    assertEquals(getWithSubsData.subworkflows[0].workflow.id, childWf.id);
  } finally {
    kv.close();
  }
});

Deno.test("workflow_search - Cross-workflow and node searching with boolean queries", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    // Create workflows with specific security keywords
    const wf1Res = await createWorkflowTool.execute({
      name: "Security Pipeline",
      description: "Pipeline for authentication and authorization",
    });
    const { workflow: wf1 } = JSON.parse(wf1Res.content[0].text);

    await addNodeTool.execute({
      workflow: wf1.id,
      type: "step",
      name: "Passkey Validator",
      description: "Validates FIDO2 WebAuthn passkey signatures",
    });

    await addNodeTool.execute({
      workflow: wf1.id,
      type: "decision",
      name: "Risk Gate",
      description: "Checks for account takeover indicators",
      config: { options: ["allow", "block"] },
    });

    const wf2Res = await createWorkflowTool.execute({
      name: "Billing Pipeline",
      description: "Invoicing and payment processing",
    });
    const { workflow: wf2 } = JSON.parse(wf2Res.content[0].text);

    await addNodeTool.execute({
      workflow: wf2.id,
      type: "step",
      name: "Invoice Generator",
      description: "Generates PDF invoices for customers",
    });

    // 1. Boolean OR search across all workflows: "authentication OR account takeover OR passkey"
    const searchOrRes = await searchWorkflowTool.execute({
      query: "authentication OR account takeover OR passkey",
      format: "json",
    });
    assert(!searchOrRes.isError);
    const searchOrData = JSON.parse(searchOrRes.content[0].text);
    assert(searchOrData.totalMatches >= 3);

    // Verify matched items belong to Security Pipeline
    const matchWfNames = searchOrData.matches.map((m: { workflowName: string }) => m.workflowName);
    assert(matchWfNames.includes("Security Pipeline"));
    assert(!matchWfNames.includes("Billing Pipeline"));

    // 2. Scoped search to specific workflow using slug: "billing-pipeline"
    const scopedRes = await searchWorkflowTool.execute({
      query: "invoice",
      workflow: "billing-pipeline",
      format: "json",
    });
    assert(!scopedRes.isError);
    const scopedData = JSON.parse(scopedRes.content[0].text);
    assertEquals(scopedData.totalMatches, 1);
    assertEquals(scopedData.matches[0].node.name, "Invoice Generator");

    // 3. Type filter search: only decision nodes
    const typeFilterRes = await searchWorkflowTool.execute({
      query: "takeover",
      type: "decision",
      format: "json",
    });
    assert(!typeFilterRes.isError);
    const typeFilterData = JSON.parse(typeFilterRes.content[0].text);
    assertEquals(typeFilterData.totalMatches, 1);
    assertEquals(typeFilterData.matches[0].node.type, "decision");
  } finally {
    kv.close();
  }
});

Deno.test("workflow_patch - Atomic multi-node batch updates", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    const wfRes = await createWorkflowTool.execute({
      name: "Batch Patch Workflow",
      description: "Testing multi-node atomic edits",
    });
    const { workflow: wf } = JSON.parse(wfRes.content[0].text);

    // Add 3 nodes
    await addNodeTool.execute({
      workflow: wf.id,
      type: "step",
      name: "Old Step 1",
      description: "Old description 1",
    });

    await addNodeTool.execute({
      workflow: wf.id,
      type: "decision",
      name: "Old Decision",
      description: "Old decision description",
      config: { options: ["opt1", "opt2"] },
    });

    await addNodeTool.execute({
      workflow: wf.id,
      type: "step",
      name: "Old Step 2",
      description: "Old description 2",
    });

    // Batch update all 3 nodes in a single tool call using slug/names
    const patchRes = await workflowPatchTool.execute({
      workflow: "batch-patch-workflow",
      nodes: [
        {
          node: "old-step-1",
          name: "New Step 1",
          description: "Updated step 1 instructions",
          runInSubAgent: true,
        },
        {
          node: "Old Decision",
          name: "Gating Decision",
          config: { options: ["approved", "rejected"] },
        },
        {
          node: "Old Step 2",
          name: "Aggregation Node",
          description: "Updated aggregation node",
        },
      ],
      format: "json",
    });

    assert(!patchRes.isError);
    const patchData = JSON.parse(patchRes.content[0].text);
    assertEquals(patchData.updatedCount, 3);

    // Verify all 3 nodes were persisted
    const node1 = await getNodeTool.execute({ workflow: wf.id, node: "New Step 1" });
    const node1Data = JSON.parse(node1.content[0].text);
    assertEquals(node1Data.name, "New Step 1");
    assertEquals(node1Data.description, "Updated step 1 instructions");
    assertEquals(node1Data.runInSubAgent, true);

    const node2 = await getNodeTool.execute({ workflow: wf.id, node: "Gating Decision" });
    const node2Data = JSON.parse(node2.content[0].text);
    assertEquals(node2Data.config.options, ["approved", "rejected"]);

    const node3 = await getNodeTool.execute({ workflow: wf.id, node: "Aggregation Node" });
    const node3Data = JSON.parse(node3.content[0].text);
    assertEquals(node3Data.name, "Aggregation Node");
  } finally {
    kv.close();
  }
});

Deno.test("workflow_tree - Hierarchical recursive inspection of subworkflows", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    // 1. Level 2 Grandchild Workflow: "Passkey Verification"
    const l2Res = await createWorkflowTool.execute({
      name: "Passkey Verification",
      description: "Checks WebAuthn passkey signatures",
      intendedForIndependentRun: false,
    });
    const { workflow: l2Wf } = JSON.parse(l2Res.content[0].text);

    await addNodeTool.execute({
      workflow: l2Wf.id,
      type: "step",
      name: "Verify Signature",
      description: "Verify passkey cryptographic signature",
    });

    // 2. Level 1 Child Workflow: "Security Checks"
    const l1Res = await createWorkflowTool.execute({
      name: "Security Checks",
      description: "Validates security controls",
      intendedForIndependentRun: false,
    });
    const { workflow: l1Wf } = JSON.parse(l1Res.content[0].text);

    await addNodeTool.execute({
      workflow: l1Wf.id,
      type: "subworkflow",
      name: "Run Passkey Verification",
      description: "Invokes passkey subworkflow",
      config: { childWorkflowId: l2Wf.id },
    });

    // 3. Root Workflow: "Release Pipeline"
    const rootRes = await createWorkflowTool.execute({
      name: "Release Pipeline",
      description: "Top-level orchestrator",
    });
    const { workflow: rootWf } = JSON.parse(rootRes.content[0].text);

    await addNodeTool.execute({
      workflow: rootWf.id,
      type: "subworkflow",
      name: "Run Security Checks",
      description: "Invokes security subworkflow",
      config: { childWorkflowId: l1Wf.id },
    });

    // 4. Generate workflow_tree with depth 3
    const treeRes = await workflowTreeTool.execute({
      workflow: "release-pipeline",
      depth: 3,
      format: "both",
    });
    assert(!treeRes.isError);

    const jsonItem = treeRes.content.find((c) => c.annotations?.audience?.includes("assistant")) ??
      treeRes.content[treeRes.content.length - 1];
    const treeData = JSON.parse(jsonItem.text);

    assertEquals(treeData.workflow.name, "Release Pipeline");
    assertEquals(treeData.children.length, 1);
    assertEquals(treeData.children[0].tree.workflow.name, "Security Checks");
    assertEquals(treeData.children[0].tree.children.length, 1);
    assertEquals(treeData.children[0].tree.children[0].tree.workflow.name, "Passkey Verification");

    // Check markdown diagram text
    const mdItem = treeRes.content.find((c) => c.annotations?.audience?.includes("user")) ??
      treeRes.content[0];
    assert(mdItem.text.includes("Release Pipeline"));
    assert(mdItem.text.includes("Security Checks"));
    assert(mdItem.text.includes("Passkey Verification"));
  } finally {
    kv.close();
  }
});
