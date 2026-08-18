import { assert, assertEquals } from "@std/assert";
import { analyzeWorkflowSuggestions } from "./heuristics.ts";
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

Deno.test("analyzeWorkflowSuggestions - detects loop encapsulation opportunity", () => {
  const nodes: WorkflowNode[] = [
    createMockNode("start", "start", "Start"),
    createMockNode("step1", "step", "Lint"),
    createMockNode("dec", "decision", "Lint Passed?", { options: ["yes", "no"] }),
    createMockNode("fix", "step", "Apply Fixes"),
    createMockNode("end", "end", "End"),
  ];

  const edges: WorkflowEdge[] = [
    createMockEdge("e1", "start", "step1"),
    createMockEdge("e2", "step1", "dec"),
    createMockEdge("e3", "dec", "fix", "no"),
    createMockEdge("e4", "fix", "step1"),
    createMockEdge("e5", "dec", "end", "yes"),
  ];

  const suggestions = analyzeWorkflowSuggestions(nodes, edges);
  assertEquals(suggestions.length, 1);
  assertEquals(suggestions[0].type, "loop_encapsulation");
  assert(suggestions[0].nodeIds.includes("step1"));
  assert(suggestions[0].nodeIds.includes("dec"));
  assert(suggestions[0].nodeIds.includes("fix"));
});

Deno.test("analyzeWorkflowSuggestions - detects linear chain extraction opportunity", () => {
  const nodes: WorkflowNode[] = [
    createMockNode("start", "start", "Start"),
    createMockNode("s1", "step", "Fetch Data"),
    createMockNode("s2", "step", "Parse CSV"),
    createMockNode("s3", "step", "Validate Schema"),
    createMockNode("s4", "step", "Transform JSON"),
    createMockNode("end", "end", "End"),
  ];

  const edges: WorkflowEdge[] = [
    createMockEdge("e1", "start", "s1"),
    createMockEdge("e2", "s1", "s2"),
    createMockEdge("e3", "s2", "s3"),
    createMockEdge("e4", "s3", "s4"),
    createMockEdge("e5", "s4", "end"),
  ];

  const suggestions = analyzeWorkflowSuggestions(nodes, edges);
  assertEquals(suggestions.length, 1);
  assertEquals(suggestions[0].type, "chain_extraction");
  assertEquals(suggestions[0].nodeIds, ["s1", "s2", "s3", "s4"]);
});

Deno.test("analyzeWorkflowSuggestions - detects high complexity in large workflow", () => {
  const nodes: WorkflowNode[] = [
    createMockNode("start", "start", "Start"),
    createMockNode("s1", "step", "Step 1"),
    createMockNode("s2", "step", "Step 2"),
    createMockNode("s3", "step", "Step 3"),
    createMockNode("s4", "step", "Step 4"),
    createMockNode("s5", "step", "Step 5"),
    createMockNode("s6", "step", "Step 6"),
    createMockNode("end", "end", "End"),
  ];

  const edges: WorkflowEdge[] = [
    createMockEdge("e1", "start", "s1"),
    createMockEdge("e2", "s1", "s2"),
    createMockEdge("e3", "s2", "s3"),
    createMockEdge("e4", "s3", "s4"),
    createMockEdge("e5", "s4", "s5"),
    createMockEdge("e6", "s5", "s6"),
    createMockEdge("e7", "s6", "end"),
  ];

  const suggestions = analyzeWorkflowSuggestions(nodes, edges);
  // Both chain and high_complexity detected
  assert(suggestions.some((s) => s.type === "high_complexity"));
  assert(suggestions.some((s) => s.type === "chain_extraction"));
});

Deno.test("validateGraph - includes suggestions in result", () => {
  const nodes: WorkflowNode[] = [
    createMockNode("start", "start", "Start"),
    createMockNode("s1", "step", "Step 1"),
    createMockNode("s2", "step", "Step 2"),
    createMockNode("s3", "step", "Step 3"),
    createMockNode("s4", "step", "Step 4"),
    createMockNode("end", "end", "End"),
  ];

  const edges: WorkflowEdge[] = [
    createMockEdge("e1", "start", "s1"),
    createMockEdge("e2", "s1", "s2"),
    createMockEdge("e3", "s2", "s3"),
    createMockEdge("e4", "s3", "s4"),
    createMockEdge("e5", "s4", "end"),
  ];

  const result = validateGraph(nodes, edges);
  assertEquals(result.valid, true);
  assert(result.suggestions !== undefined);
  assertEquals(result.suggestions.length, 1);
  assertEquals(result.suggestions[0].type, "chain_extraction");
});
