import { assert, assertEquals } from "@std/assert";
import { validateGraph, wouldCreateCycle } from "./graph.ts";
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

Deno.test("validateGraph - empty nodes list", () => {
  const result = validateGraph([], []);
  assertEquals(result.valid, false);
  assertEquals(result.errors, ["Workflow has no nodes."]);
  assertEquals(result.warnings, []);
});

Deno.test("validateGraph - valid DAG with single start, step, decision, and end node", () => {
  const nodes: WorkflowNode[] = [
    createMockNode("start-1", "start", "Start"),
    createMockNode("step-1", "step", "Step 1"),
    createMockNode("dec-1", "decision", "Decision 1", { options: ["yes", "no"] }),
    createMockNode("end-1", "end", "End"),
  ];
  const edges: WorkflowEdge[] = [
    createMockEdge("e-1", "start-1", "step-1"),
    createMockEdge("e-2", "step-1", "dec-1"),
    createMockEdge("e-3", "dec-1", "end-1", "yes"),
    createMockEdge("e-4", "dec-1", "end-1", "no"),
  ];

  const result = validateGraph(nodes, edges);
  assertEquals(result.valid, true);
  assertEquals(result.errors, []);
  assertEquals(result.warnings, []);
});

Deno.test("validateGraph - start node constraints (missing start, multiple start, inbound edge to start)", () => {
  // Missing start node
  const noStartNodes = [
    createMockNode("step-1", "step", "Step 1"),
    createMockNode("end-1", "end", "End"),
  ];
  const noStartEdges = [createMockEdge("e-1", "step-1", "end-1")];
  const noStartRes = validateGraph(noStartNodes, noStartEdges);
  assertEquals(noStartRes.valid, false);
  assert(noStartRes.errors.includes("Workflow must have exactly one start node."));

  // Multiple start nodes
  const multiStartNodes = [
    createMockNode("start-1", "start", "Start 1"),
    createMockNode("start-2", "start", "Start 2"),
    createMockNode("end-1", "end", "End"),
  ];
  const multiStartRes = validateGraph(multiStartNodes, []);
  assertEquals(multiStartRes.valid, false);
  assert(
    multiStartRes.errors.includes(
      'Workflow has 2 start nodes ("Start 1", "Start 2"). Exactly one is required.',
    ),
  );

  // Inbound edge to start node
  const inboundStartNodes = [
    createMockNode("start-1", "start", "Start Node"),
    createMockNode("step-1", "step", "Step Node"),
    createMockNode("end-1", "end", "End Node"),
  ];
  const inboundStartEdges = [
    createMockEdge("e-1", "start-1", "step-1"),
    createMockEdge("e-2", "step-1", "start-1"),
  ];
  const inboundStartRes = validateGraph(inboundStartNodes, inboundStartEdges);
  assertEquals(inboundStartRes.valid, false);
  assert(
    inboundStartRes.errors.includes('Start node "Start Node" must not have inbound edges.'),
  );
});

Deno.test("validateGraph - end node constraints (missing end warning, outbound edge error)", () => {
  // Missing end node -> warning
  const noEndNodes = [
    createMockNode("start-1", "start", "Start"),
    createMockNode("step-1", "step", "Step 1"),
  ];
  const noEndEdges = [createMockEdge("e-1", "start-1", "step-1")];
  const noEndRes = validateGraph(noEndNodes, noEndEdges);
  assertEquals(noEndRes.valid, true);
  assertEquals(noEndRes.errors, []);
  assertEquals(noEndRes.warnings, [
    "Workflow has no end node. Consider adding one for explicit completion.",
  ]);

  // Outbound edge from end node -> error
  const outboundEndNodes = [
    createMockNode("start-1", "start", "Start"),
    createMockNode("end-1", "end", "End"),
    createMockNode("step-1", "step", "Step"),
  ];
  const outboundEndEdges = [
    createMockEdge("e-1", "start-1", "end-1"),
    createMockEdge("e-2", "end-1", "step-1"),
  ];
  const outboundEndRes = validateGraph(outboundEndNodes, outboundEndEdges);
  assertEquals(outboundEndRes.valid, false);
  assert(outboundEndRes.errors.includes('End node "End" must not have outbound edges.'));
});

Deno.test("validateGraph - invalid edge references", () => {
  const nodes = [
    createMockNode("start-1", "start", "Start"),
    createMockNode("end-1", "end", "End"),
  ];
  const edges = [
    createMockEdge("e-1", "non-existent-src", "end-1"),
    createMockEdge("e-2", "start-1", "non-existent-tgt"),
  ];
  const result = validateGraph(nodes, edges);
  assertEquals(result.valid, false);
  assert(
    result.errors.includes(
      'Edge "e-1" references non-existent source node "non-existent-src".',
    ),
  );
  assert(
    result.errors.includes(
      'Edge "e-2" references non-existent target node "non-existent-tgt".',
    ),
  );
});

Deno.test("validateGraph - decision node option coverage warnings", () => {
  const nodes = [
    createMockNode("start-1", "start", "Start"),
    createMockNode("dec-1", "decision", "Decide", { options: ["opt-a", "opt-b", "opt-c"] }),
    createMockNode("end-1", "end", "End"),
  ];
  const edges = [
    createMockEdge("e-1", "start-1", "dec-1"),
    createMockEdge("e-2", "dec-1", "end-1", "opt-a"),
    createMockEdge("e-3", "dec-1", "end-1", "unlisted-opt"),
  ];

  const result = validateGraph(nodes, edges);
  assertEquals(result.valid, true);
  assertEquals(result.errors, []);
  assert(
    result.warnings.includes(
      'Decision node "Decide" has option "opt-b" with no matching outbound edge.',
    ),
  );
  assert(
    result.warnings.includes(
      'Decision node "Decide" has option "opt-c" with no matching outbound edge.',
    ),
  );
  assert(
    result.warnings.includes(
      'Decision node "Decide" has edge with condition "unlisted-opt" that is not in its options [opt-a, opt-b, opt-c].',
    ),
  );
});

Deno.test("validateGraph - reachability and cycle detection", () => {
  // Unreachable node
  const unreachableNodes = [
    createMockNode("start-1", "start", "Start"),
    createMockNode("step-1", "step", "Step 1"),
    createMockNode("orphan-1", "step", "Orphan"),
    createMockNode("end-1", "end", "End"),
  ];
  const unreachableEdges = [
    createMockEdge("e-1", "start-1", "step-1"),
    createMockEdge("e-2", "step-1", "end-1"),
  ];
  const unreachRes = validateGraph(unreachableNodes, unreachableEdges);
  assertEquals(unreachRes.valid, false);
  assert(
    unreachRes.errors.includes(
      'Node "Orphan" (orphan-1) is not reachable from the start node.',
    ),
  );

  // Cycle in graph (Start -> A -> B -> C -> A)
  const cycleNodes = [
    createMockNode("start-1", "start", "Start"),
    createMockNode("node-a", "step", "A"),
    createMockNode("node-b", "step", "B"),
    createMockNode("node-c", "step", "C"),
    createMockNode("end-1", "end", "End"),
  ];
  const cycleEdges = [
    createMockEdge("e-1", "start-1", "node-a"),
    createMockEdge("e-2", "node-a", "node-b"),
    createMockEdge("e-3", "node-b", "node-c"),
    createMockEdge("e-4", "node-c", "node-a"),
    createMockEdge("e-5", "node-c", "end-1"),
  ];
  const cycleRes = validateGraph(cycleNodes, cycleEdges);
  assertEquals(cycleRes.valid, false);
  assert(
    cycleRes.errors.some((e) => e.includes("Workflow contains an un-gated cycle with nodes")),
  );
});

Deno.test("wouldCreateCycle - self loop and cycle detection", () => {
  // Self loop
  assertEquals(wouldCreateCycle("node-a", "node-a", []), true);

  // Empty graph - non-cycle
  assertEquals(wouldCreateCycle("node-a", "node-b", []), false);

  // Existing A -> B; adding B -> A creates cycle
  const edges1: WorkflowEdge[] = [createMockEdge("e1", "node-a", "node-b")];
  assertEquals(wouldCreateCycle("node-b", "node-a", edges1), true);

  // Existing A -> B -> C; adding C -> A creates cycle
  const edges2: WorkflowEdge[] = [
    createMockEdge("e1", "node-a", "node-b"),
    createMockEdge("e2", "node-b", "node-c"),
  ];
  assertEquals(wouldCreateCycle("node-c", "node-a", edges2), true);

  // Existing A -> B -> C; adding A -> C does NOT create cycle (valid DAG diamond)
  assertEquals(wouldCreateCycle("node-a", "node-c", edges2), false);

  // Existing A -> B, C -> D; adding B -> C does NOT create cycle
  const edges3: WorkflowEdge[] = [
    createMockEdge("e1", "node-a", "node-b"),
    createMockEdge("e2", "node-c", "node-d"),
  ];
  assertEquals(wouldCreateCycle("node-b", "node-c", edges3), false);

  // Complex DAG with branches
  const edges4: WorkflowEdge[] = [
    createMockEdge("e1", "n1", "n2"),
    createMockEdge("e2", "n1", "n3"),
    createMockEdge("e3", "n2", "n4"),
    createMockEdge("e4", "n3", "n4"),
    createMockEdge("e5", "n4", "n5"),
  ];
  assertEquals(wouldCreateCycle("n5", "n1", edges4), true);
  assertEquals(wouldCreateCycle("n4", "n2", edges4), true);
  assertEquals(wouldCreateCycle("n2", "n5", edges4), false);
});
