import { assert, assertEquals } from "@std/assert";
import { validateGraph } from "./graph.ts";
import type { WorkflowEdge, WorkflowNode } from "../store/types.ts";

function createMockNode(
  id: string,
  type: WorkflowNode["type"],
  name = id,
  config: Record<string, unknown> = {},
): WorkflowNode {
  return {
    id,
    workflowId: "wf-test",
    type,
    name,
    description: `Node ${name}`,
    runInSubAgent: false,
    config,
    status: "pending",
    error: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function createMockEdge(
  id: string,
  fromNodeId: string,
  toNodeId: string,
  condition?: string,
): WorkflowEdge {
  return {
    id,
    workflowId: "wf-test",
    fromNodeId,
    toNodeId,
    ...(condition !== undefined ? { condition } : {}),
  };
}

Deno.test("validateGraph - valid review-fix gated loop", () => {
  const nodes: WorkflowNode[] = [
    createMockNode("start-1", "start", "Start"),
    createMockNode("review", "step", "Code Review"),
    createMockNode("decision", "decision", "Score Check", { options: ["fix", "pass"] }),
    createMockNode("fix", "step", "Fix Issues"),
    createMockNode("end-1", "end", "End"),
  ];

  const edges: WorkflowEdge[] = [
    createMockEdge("e-start", "start-1", "review"),
    createMockEdge("e-rev-dec", "review", "decision"),
    createMockEdge("e-dec-fix", "decision", "fix", "fix"),
    createMockEdge("e-fix-rev", "fix", "review"), // Loop back-edge
    createMockEdge("e-dec-pass", "decision", "end-1", "pass"), // Exit edge to end
  ];

  const result = validateGraph(nodes, edges);
  assertEquals(result.valid, true);
  assertEquals(result.errors, []);
});

Deno.test("validateGraph - un-gated cycle rejected", () => {
  const nodes: WorkflowNode[] = [
    createMockNode("start-1", "start", "Start"),
    createMockNode("step-a", "step", "Step A"),
    createMockNode("step-b", "step", "Step B"),
    createMockNode("end-1", "end", "End"),
  ];

  const edges: WorkflowEdge[] = [
    createMockEdge("e-1", "start-1", "step-a"),
    createMockEdge("e-2", "step-a", "step-b"),
    createMockEdge("e-3", "step-b", "step-a"), // Cycle without decision node
    createMockEdge("e-4", "step-b", "end-1"),
  ];

  const result = validateGraph(nodes, edges);
  assertEquals(result.valid, false);
  assert(
    result.errors.some((e) =>
      e.includes("Workflow contains an un-gated cycle with nodes") &&
      (e.includes("Loops must contain at least one decision node") ||
        e.includes("Loops must contain at least one decision or user_interaction node"))
    ),
  );
});

Deno.test("validateGraph - valid review-fix loop gated by user_interaction node", () => {
  const nodes: WorkflowNode[] = [
    createMockNode("start-1", "start", "Start"),
    createMockNode("review", "step", "Review Code"),
    createMockNode("user_ask", "user_interaction", "User Confirmation", {
      prompt: "Should we apply additional fixes?",
      options: { "Fix More": "fix_more", "Looks Good": "finish" },
    }),
    createMockNode("fix", "step", "Apply Fixes"),
    createMockNode("end-1", "end", "End"),
  ];

  const edges: WorkflowEdge[] = [
    createMockEdge("e-start-rev", "start-1", "review"),
    createMockEdge("e-rev-user", "review", "user_ask"),
    createMockEdge("e-user-fix", "user_ask", "fix", "fix_more"),
    createMockEdge("e-fix-rev", "fix", "review"), // Loop back-edge
    createMockEdge("e-user-end", "user_ask", "end-1", "finish"), // Exit edge to end
  ];

  const result = validateGraph(nodes, edges);
  assertEquals(result.valid, true);
  assertEquals(result.errors, []);
  assertEquals(result.warnings, []);
});

Deno.test("validateGraph - cycle with decision node but no exit path rejected", () => {
  const nodes: WorkflowNode[] = [
    createMockNode("start-1", "start", "Start"),
    createMockNode("review", "step", "Review"),
    createMockNode("dec", "decision", "Decision", { options: ["fix", "retry"] }),
    createMockNode("fix", "step", "Fix"),
    createMockNode("end-1", "end", "End"),
  ];

  const edges: WorkflowEdge[] = [
    createMockEdge("e-start-rev", "start-1", "review"),
    createMockEdge("e-start-end", "start-1", "end-1"), // Start reaches end, but the loop below is trapped
    createMockEdge("e-2", "review", "dec"),
    createMockEdge("e-3", "dec", "fix", "fix"),
    createMockEdge("e-4", "dec", "review", "retry"),
    createMockEdge("e-5", "fix", "review"),
  ];

  const result = validateGraph(nodes, edges);
  assertEquals(result.valid, false);
  assert(
    result.errors.some((e) =>
      e.includes("that has no exit path") || e.includes("has no exit condition")
    ),
  );
});

Deno.test("validateGraph - subworkflow node validation", () => {
  // Valid subworkflow node
  const validNodes: WorkflowNode[] = [
    createMockNode("start-1", "start", "Start"),
    createMockNode("sub-1", "subworkflow", "Child Process", { childWorkflowId: "child-wf-123" }),
    createMockNode("end-1", "end", "End"),
  ];
  const validEdges: WorkflowEdge[] = [
    createMockEdge("e-1", "start-1", "sub-1"),
    createMockEdge("e-2", "sub-1", "end-1"),
  ];
  const validRes = validateGraph(validNodes, validEdges);
  assertEquals(validRes.valid, true);

  // Missing childWorkflowId
  const badNodes: WorkflowNode[] = [
    createMockNode("start-1", "start", "Start"),
    createMockNode("sub-1", "subworkflow", "Bad Child", {}),
    createMockNode("end-1", "end", "End"),
  ];
  const badRes = validateGraph(badNodes, validEdges);
  assertEquals(badRes.valid, false);
  assert(badRes.errors.some((e) => e.includes("requires a non-empty 'childWorkflowId'")));

  // Self-recursion
  const selfNodes: WorkflowNode[] = [
    createMockNode("start-1", "start", "Start"),
    createMockNode("sub-1", "subworkflow", "Self Child", { childWorkflowId: "wf-test" }),
    createMockNode("end-1", "end", "End"),
  ];
  const selfRes = validateGraph(selfNodes, validEdges);
  assertEquals(selfRes.valid, false);
  assert(selfRes.errors.some((e) => e.includes("cannot reference its own workflow ID")));
});
