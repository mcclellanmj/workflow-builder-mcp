import { assert, assertEquals } from "@std/assert";
import { setKv } from "../../store/kv.ts";
import { createWorkflowTool } from "./create_workflow.ts";
import { addNodeTool } from "./add_node.ts";
import { editNodeTool } from "./edit_node.ts";
import { getNodeTool } from "./get_node.ts";
import { listNodesTool } from "./list_nodes.ts";
import { deleteNodeTool } from "./delete_node.ts";
import { connectNodesTool } from "./connect_nodes.ts";

Deno.test("Node tools lifecycle and edge cases test", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    // 1. Create a workflow
    const wfRes = await createWorkflowTool.execute({
      name: "Node Test Workflow",
      description: "Testing node tools",
    });
    assert(!wfRes.isError);
    const { workflow, startNode } = JSON.parse(wfRes.content[0].text);
    const workflowId = workflow.id;

    // 2. Reject adding 'start' node
    const addStartRes = await addNodeTool.execute({
      workflowId,
      type: "start" as unknown as "step",
      name: "Another Start",
      description: "Invalid",
    });
    assert(addStartRes.isError);

    // 3. Add a step node
    const addStepRes = await addNodeTool.execute({
      workflowId,
      type: "step",
      name: "Step 1",
      description: "Do something",
      runInSubAgent: true,
    });
    assert(!addStepRes.isError);
    const stepNode = JSON.parse(addStepRes.content[0].text);
    assertEquals(stepNode.name, "Step 1");
    assertEquals(stepNode.type, "step");
    assertEquals(stepNode.runInSubAgent, true);
    assertEquals(stepNode.status, "pending");

    // 4. Decision node: reject if config.options missing or invalid
    const addBadDecisionRes = await addNodeTool.execute({
      workflowId,
      type: "decision",
      name: "Decision 1",
      description: "Check condition",
    });
    assert(addBadDecisionRes.isError);

    // 5. Add valid decision node
    const addDecisionRes = await addNodeTool.execute({
      workflowId,
      type: "decision",
      name: "Decision 1",
      description: "Check condition",
      config: { options: ["yes", "no"] },
    });
    assert(!addDecisionRes.isError);
    const decisionNode = JSON.parse(addDecisionRes.content[0].text);
    assertEquals(decisionNode.type, "decision");
    assertEquals(decisionNode.config.options, ["yes", "no"]);

    // 6. Add end node
    const addEndRes = await addNodeTool.execute({
      workflowId,
      type: "end",
      name: "End",
      description: "Workflow complete",
    });
    assert(!addEndRes.isError);
    const endNode = JSON.parse(addEndRes.content[0].text);
    assertEquals(endNode.type, "end");

    // 7. Connect start -> step -> decision -> end (yes)
    const conn1 = await connectNodesTool.execute({
      workflowId,
      fromNodeId: startNode.id,
      toNodeId: stepNode.id,
    });
    assert(!conn1.isError);

    const conn2 = await connectNodesTool.execute({
      workflowId,
      fromNodeId: stepNode.id,
      toNodeId: decisionNode.id,
    });
    assert(!conn2.isError);

    const conn3 = await connectNodesTool.execute({
      workflowId,
      fromNodeId: decisionNode.id,
      toNodeId: endNode.id,
      condition: "yes",
    });
    assert(!conn3.isError);

    // 8. Get step node with connections
    const getStepRes = await getNodeTool.execute({
      workflowId,
      nodeId: stepNode.id,
    });
    assert(!getStepRes.isError);
    const getStepData = JSON.parse(getStepRes.content[0].text);
    assertEquals(getStepData.id, stepNode.id);
    assertEquals(getStepData.inboundEdges.length, 1);
    assertEquals(getStepData.inboundEdges[0].fromNodeId, startNode.id);
    assertEquals(getStepData.outboundEdges.length, 1);
    assertEquals(getStepData.outboundEdges[0].toNodeId, decisionNode.id);

    // 9. List nodes
    const listRes = await listNodesTool.execute({ workflowId });
    assert(!listRes.isError);
    const jsonItem = listRes.content.find((c) => c.annotations?.audience?.includes("assistant")) ??
      listRes.content[listRes.content.length - 1];
    const listData = JSON.parse(jsonItem.text);
    assertEquals(listData.length, 4); // start, step, decision, end

    // 10. Edit step node
    const editStepRes = await editNodeTool.execute({
      workflowId,
      nodeId: stepNode.id,
      name: "Updated Step 1",
      description: "Updated description",
      runInSubAgent: false,
    });
    assert(!editStepRes.isError);
    const updatedStep = JSON.parse(editStepRes.content[0].text);
    assertEquals(updatedStep.name, "Updated Step 1");
    assertEquals(updatedStep.description, "Updated description");
    assertEquals(updatedStep.runInSubAgent, false);

    // 11. Reject editing type
    const editTypeRes = await editNodeTool.execute({
      workflowId,
      nodeId: stepNode.id,
      // @ts-expect-error testing disallowed property
      type: "decision",
    });
    assert(editTypeRes.isError);

    // 12. Reject deleting start node
    const delStartRes = await deleteNodeTool.execute({
      workflowId,
      nodeId: startNode.id,
    });
    assert(delStartRes.isError);

    // 13. Delete step node and check edge cleanup
    const delStepRes = await deleteNodeTool.execute({
      workflowId,
      nodeId: stepNode.id,
    });
    assert(!delStepRes.isError);
    const delStepData = JSON.parse(delStepRes.content[0].text);
    assertEquals(delStepData.success, true);
    assertEquals(delStepData.removedEdges.length, 2); // inbound from start, outbound to decision

    // 14. Verify node is gone
    const getDeletedRes = await getNodeTool.execute({
      workflowId,
      nodeId: stepNode.id,
    });
    assert(getDeletedRes.isError);

    // 15. User interaction node: reject if config.prompt is missing
    const addBadUserRes = await addNodeTool.execute({
      workflowId,
      type: "user_interaction",
      name: "Ask User",
      description: "Prompt user for feedback",
    });
    assert(addBadUserRes.isError);

    // 16. Add valid user_interaction node with options map and flags
    const addUserRes = await addNodeTool.execute({
      workflowId,
      type: "user_interaction",
      name: "Confirm Next Steps",
      description: "Ask user how to proceed",
      config: {
        prompt: "Should we apply fixes or exit?",
        options: { "Apply fixes": "fix", "Exit now": "exit" },
        allowFreeText: true,
        contextHint: "Display summary of 2 minor issues",
      },
    });
    assert(!addUserRes.isError);
    const userNode = JSON.parse(addUserRes.content[0].text);
    assertEquals(userNode.type, "user_interaction");
    assertEquals(userNode.config.prompt, "Should we apply fixes or exit?");
    assertEquals(userNode.config.options, { "Apply fixes": "fix", "Exit now": "exit" });
    assertEquals(userNode.config.allowFreeText, true);

    // 17. Edit user_interaction node
    const editUserRes = await editNodeTool.execute({
      workflowId,
      nodeId: userNode.id,
      config: {
        prompt: "Updated question?",
      },
    });
    assert(!editUserRes.isError);
    const updatedUserNode = JSON.parse(editUserRes.content[0].text);
    assertEquals(updatedUserNode.config.prompt, "Updated question?");
    assertEquals(updatedUserNode.config.options, { "Apply fixes": "fix", "Exit now": "exit" });
  } finally {
    kv.close();
  }
});
