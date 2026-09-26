import { assert, assertEquals } from "@std/assert";
import { evaluateDecisionNode, getNestedValue } from "./evaluator.ts";
import { findNextNodes } from "./execution_helpers.ts";
import { validateGraph } from "../validation/graph.ts";
import type {
  DecisionConfig,
  WorkflowEdge,
  WorkflowExecution,
  WorkflowNode,
} from "../store/types.ts";

// ---------------------------------------------------------------------------
// 1. getNestedValue Tests
// ---------------------------------------------------------------------------

Deno.test("getNestedValue - extracts flat and deeply nested paths", () => {
  const data = {
    simple: "hello",
    review: {
      status: "approved",
      score: 95,
      meta: {
        reviewer: "agent-1",
      },
    },
    tasks: {
      "tk-123": {
        passed: true,
      },
    },
  };

  assertEquals(getNestedValue(data, "simple"), "hello");
  assertEquals(getNestedValue(data, "review.status"), "approved");
  assertEquals(getNestedValue(data, "review.score"), 95);
  assertEquals(getNestedValue(data, "review.meta.reviewer"), "agent-1");
  assertEquals(getNestedValue(data, "tasks.tk-123.passed"), true);
});

Deno.test("getNestedValue - handles missing paths and invalid inputs safely", () => {
  const data = { a: { b: 1 } };

  assertEquals(getNestedValue(data, "a.c"), undefined);
  assertEquals(getNestedValue(data, "non.existent.path"), undefined);
  assertEquals(getNestedValue({} as Record<string, unknown>, "a.b"), undefined);
  assertEquals(getNestedValue(null as unknown as Record<string, unknown>, "a.b"), undefined);
  assertEquals(getNestedValue(data, ""), undefined);
});

// ---------------------------------------------------------------------------
// 2. evaluateDecisionNode Tests
// ---------------------------------------------------------------------------

Deno.test("evaluateDecisionNode - discrete map matching", () => {
  const config: DecisionConfig = {
    field: "review.status",
    map: {
      "approved": "qa",
      "rejected": "retry",
    },
    default: "escalate",
  };

  const data = { review: { status: "approved" } };
  assertEquals(evaluateDecisionNode(config, data, {}), "qa");

  const rejectData = { review: { status: "rejected" } };
  assertEquals(evaluateDecisionNode(config, rejectData, {}), "retry");

  const unknownData = { review: { status: "pending" } };
  assertEquals(evaluateDecisionNode(config, unknownData, {}), "escalate");
});

Deno.test("evaluateDecisionNode - data takes precedence over context", () => {
  const config: DecisionConfig = {
    field: "status",
    map: {
      "active": "run",
      "inactive": "stop",
    },
    default: "stop",
  };

  const data = { status: "active" };
  const context = { status: "inactive" };
  assertEquals(evaluateDecisionNode(config, data, context), "run");

  // Context used when field not in data
  assertEquals(evaluateDecisionNode(config, {}, context), "stop");
});

Deno.test("evaluateDecisionNode - numeric rules evaluation with numbers and stringified numbers", () => {
  const config: DecisionConfig = {
    field: "attemptCount",
    numericRules: [
      { op: "<", value: 3, condition: "retry" },
      { op: "==", value: 3, condition: "warning" },
      { op: ">", value: 3, condition: "escalate" },
    ],
    default: "escalate",
  };

  // Numeric values
  assertEquals(evaluateDecisionNode(config, { attemptCount: 1 }, {}), "retry");
  assertEquals(evaluateDecisionNode(config, { attemptCount: 2.5 }, {}), "retry");
  assertEquals(evaluateDecisionNode(config, { attemptCount: 3 }, {}), "warning");
  assertEquals(evaluateDecisionNode(config, { attemptCount: 4 }, {}), "escalate");

  // Permissive stringified numbers (e.g. "1", "3.0")
  assertEquals(evaluateDecisionNode(config, { attemptCount: "1" }, {}), "retry");
  assertEquals(evaluateDecisionNode(config, { attemptCount: "3" }, {}), "warning");
  assertEquals(evaluateDecisionNode(config, { attemptCount: "5" }, {}), "escalate");

  // Non-numeric fallback to default
  assertEquals(evaluateDecisionNode(config, { attemptCount: "invalid" }, {}), "escalate");
  assertEquals(evaluateDecisionNode(config, {}, {}), "escalate");
});

Deno.test("evaluateDecisionNode - all comparison operators (<, <=, >, >=, ==, !=)", () => {
  const ltConfig: DecisionConfig = {
    field: "val",
    numericRules: [{ op: "<", value: 10, condition: "lt" }],
    default: "other",
  };
  assertEquals(evaluateDecisionNode(ltConfig, { val: 9 }, {}), "lt");
  assertEquals(evaluateDecisionNode(ltConfig, { val: 10 }, {}), "other");

  const lteConfig: DecisionConfig = {
    field: "val",
    numericRules: [{ op: "<=", value: 10, condition: "lte" }],
    default: "other",
  };
  assertEquals(evaluateDecisionNode(lteConfig, { val: 10 }, {}), "lte");
  assertEquals(evaluateDecisionNode(lteConfig, { val: 11 }, {}), "other");

  const gtConfig: DecisionConfig = {
    field: "val",
    numericRules: [{ op: ">", value: 10, condition: "gt" }],
    default: "other",
  };
  assertEquals(evaluateDecisionNode(gtConfig, { val: 11 }, {}), "gt");
  assertEquals(evaluateDecisionNode(gtConfig, { val: 10 }, {}), "other");

  const gteConfig: DecisionConfig = {
    field: "val",
    numericRules: [{ op: ">=", value: 10, condition: "gte" }],
    default: "other",
  };
  assertEquals(evaluateDecisionNode(gteConfig, { val: 10 }, {}), "gte");
  assertEquals(evaluateDecisionNode(gteConfig, { val: 9 }, {}), "other");

  const eqConfig: DecisionConfig = {
    field: "val",
    numericRules: [{ op: "==", value: 42, condition: "eq" }],
    default: "other",
  };
  assertEquals(evaluateDecisionNode(eqConfig, { val: 42 }, {}), "eq");
  assertEquals(evaluateDecisionNode(eqConfig, { val: 43 }, {}), "other");

  const neConfig: DecisionConfig = {
    field: "val",
    numericRules: [{ op: "!=", value: 42, condition: "ne" }],
    default: "other",
  };
  assertEquals(evaluateDecisionNode(neConfig, { val: 43 }, {}), "ne");
  assertEquals(evaluateDecisionNode(neConfig, { val: 42 }, {}), "other");
});

// ---------------------------------------------------------------------------
// 3. Static Graph Validation for Decision Nodes
// ---------------------------------------------------------------------------

function mockNode(
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

function mockEdge(
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

Deno.test("validateGraph - enforces non-empty field and default on decision nodes", () => {
  const nodes = [
    mockNode("start", "start"),
    mockNode("dec", "decision", "Decide", {}),
    mockNode("end", "end"),
  ];
  const edges = [
    mockEdge("e1", "start", "dec"),
    mockEdge("e2", "dec", "end"),
  ];

  const res = validateGraph(nodes, edges);
  assertEquals(res.valid, false);
  assert(res.errors.some((e) => e.includes("requires a non-empty 'field' string")));
  assert(res.errors.some((e) => e.includes("requires a non-empty 'default' string")));
});

Deno.test("validateGraph - detects missing outgoing edge for decision map and numeric rules", () => {
  const nodes = [
    mockNode("start", "start"),
    mockNode("dec", "decision", "Decide", {
      field: "score",
      default: "fallback_cond",
      map: { "pass": "approved_cond" },
      numericRules: [{ op: "<", value: 50, condition: "failing_cond" }],
    }),
    mockNode("end", "end"),
  ];
  // Only providing edge for "fallback_cond", leaving "approved_cond" and "failing_cond" missing
  const edges = [
    mockEdge("e1", "start", "dec"),
    mockEdge("e2", "dec", "end", "fallback_cond"),
    mockEdge("e3", "dec", "end", "extra_unreachable"),
  ];

  const res = validateGraph(nodes, edges);
  assertEquals(res.valid, false);
  assert(res.errors.some((e) => e.includes('target condition "approved_cond" has no matching outgoing edge')));
  assert(res.errors.some((e) => e.includes('target condition "failing_cond" has no matching outgoing edge')));
  assert(res.warnings.some((w) => w.includes('condition "extra_unreachable" that is unreachable from config')));
});

// ---------------------------------------------------------------------------
// 4. findNextNodes & Barrier Join Synchronization
// ---------------------------------------------------------------------------

Deno.test("findNextNodes - condition matching and joinPolicy 'all' barrier holds until all predecessors complete", async () => {
  const nodes: WorkflowNode[] = [
    mockNode("dev-1", "step", "Dev 1"),
    mockNode("dev-2", "step", "Dev 2"),
    {
      ...mockNode("barrier-triage", "decision", "Triage", {
        field: "reviewStatus",
        default: "pass",
        map: { "failed": "retry" },
      }),
      joinPolicy: "all",
    },
    mockNode("qa", "step", "QA"),
  ];

  const edges: WorkflowEdge[] = [
    mockEdge("e1", "dev-1", "barrier-triage"),
    mockEdge("e2", "dev-2", "barrier-triage"),
    mockEdge("e3", "barrier-triage", "qa", "pass"),
  ];

  // Dev 1 completes, but Dev 2 is still pending
  const execution1: WorkflowExecution = {
    id: "ex-1",
    workflowId: "wf-test",
    status: "in_progress",
    nodeStates: {
      "dev-1": { nodeId: "dev-1", status: "completed", error: null, updatedAt: "" },
      "dev-2": { nodeId: "dev-2", status: "pending", error: null, updatedAt: "" },
      "barrier-triage": { nodeId: "barrier-triage", status: "pending", error: null, updatedAt: "" },
    },
    context: {},
    createdAt: "",
    updatedAt: "",
  };

  // Barrier must hold: dev-1 completed, but dev-2 not completed -> triage NOT eligible
  const next1 = await findNextNodes(execution1, "dev-1", undefined, nodes, edges);
  assertEquals(next1.length, 0);

  // Now Dev 2 completes as well
  const execution2: WorkflowExecution = {
    ...execution1,
    nodeStates: {
      ...execution1.nodeStates,
      "dev-2": { nodeId: "dev-2", status: "completed", error: null, updatedAt: "" },
    },
  };

  // Dev 2 completes -> now all inbound predecessors (dev-1, dev-2) are completed -> triage is eligible!
  const next2 = await findNextNodes(execution2, "dev-2", undefined, nodes, edges);
  assertEquals(next2.length, 1);
  assertEquals(next2[0].id, "barrier-triage");
});

Deno.test("findNextNodes - joinPolicy 'm_of_n' barrier threshold", async () => {
  const nodes: WorkflowNode[] = [
    mockNode("rev-1", "step", "Reviewer 1"),
    mockNode("rev-2", "step", "Reviewer 2"),
    mockNode("rev-3", "step", "Reviewer 3"),
    {
      ...mockNode("consensus", "step", "Consensus Step"),
      joinPolicy: "m_of_n",
      joinThreshold: 2,
    },
  ];

  const edges: WorkflowEdge[] = [
    mockEdge("e1", "rev-1", "consensus"),
    mockEdge("e2", "rev-2", "consensus"),
    mockEdge("e3", "rev-3", "consensus"),
  ];

  // Only rev-1 completes -> threshold (2) not met
  const execution1: WorkflowExecution = {
    id: "ex-2",
    workflowId: "wf-test",
    status: "in_progress",
    nodeStates: {
      "rev-1": { nodeId: "rev-1", status: "completed", error: null, updatedAt: "" },
      "rev-2": { nodeId: "rev-2", status: "pending", error: null, updatedAt: "" },
      "rev-3": { nodeId: "rev-3", status: "pending", error: null, updatedAt: "" },
    },
    context: {},
    createdAt: "",
    updatedAt: "",
  };

  const next1 = await findNextNodes(execution1, "rev-1", undefined, nodes, edges);
  assertEquals(next1.length, 0);

  // rev-2 also completes -> 2 of 3 met -> consensus is eligible!
  const execution2: WorkflowExecution = {
    ...execution1,
    nodeStates: {
      ...execution1.nodeStates,
      "rev-2": { nodeId: "rev-2", status: "completed", error: null, updatedAt: "" },
    },
  };

  const next2 = await findNextNodes(execution2, "rev-2", undefined, nodes, edges);
  assertEquals(next2.length, 1);
  assertEquals(next2[0].id, "consensus");
});

Deno.test("findNextNodes - condition-based branching from decision node", async () => {
  const nodes: WorkflowNode[] = [
    mockNode("triage", "decision", "Triage", {
      field: "result",
      default: "qa",
      map: { "fix": "dev_loop", "pass": "qa" },
    }),
    mockNode("dev-loop", "step", "Dev Loop"),
    mockNode("qa", "step", "QA"),
  ];

  const edges: WorkflowEdge[] = [
    mockEdge("e1", "triage", "dev-loop", "dev_loop"),
    mockEdge("e2", "triage", "qa", "qa"),
  ];

  const execution: WorkflowExecution = {
    id: "ex-3",
    workflowId: "wf-test",
    status: "in_progress",
    nodeStates: {
      "triage": { nodeId: "triage", status: "completed", error: null, updatedAt: "" },
    },
    context: {},
    createdAt: "",
    updatedAt: "",
  };

  // Advance with condition "dev_loop" -> routes to dev-loop only
  const nextDev = await findNextNodes(execution, "triage", "dev_loop", nodes, edges);
  assertEquals(nextDev.length, 1);
  assertEquals(nextDev[0].id, "dev-loop");

  // Advance with condition "qa" -> routes to qa only
  const nextQA = await findNextNodes(execution, "triage", "qa", nodes, edges);
  assertEquals(nextQA.length, 1);
  assertEquals(nextQA[0].id, "qa");
});
