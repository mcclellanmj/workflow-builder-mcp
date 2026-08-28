import { assertEquals } from "@std/assert";
import { withUserContext } from "../../auth/context.ts";
import { setKv } from "./client.ts";
import { deleteNodes, getNodes, saveNodes } from "./nodes.ts";
import { deleteEdges, getEdges, saveEdges } from "./edges.ts";
import { addDependencies, createTasks, getTasks } from "./tasks.ts";
import type { WorkflowEdge, WorkflowNode } from "../types.ts";

Deno.test("Bulk Operations - Nodes and Edges CRUD in bulk", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    const userId = "user_bulk_test";
    const wfId = "wf-bulk-test";

    await withUserContext(userId, async () => {
      // 1. Bulk Save Nodes
      const now = new Date().toISOString();
      const nodes: WorkflowNode[] = [
        {
          id: "node-1",
          workflowId: wfId,
          type: "start",
          name: "Start Node",
          description: "Start of bulk test",
          runInSubAgent: false,
          config: {},
          status: "pending",
          error: null,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "node-2",
          workflowId: wfId,
          type: "step",
          name: "Processing Step",
          description: "Process items in bulk",
          runInSubAgent: true,
          config: {},
          status: "pending",
          error: null,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "node-3",
          workflowId: wfId,
          type: "end",
          name: "End Node",
          description: "End of bulk test",
          runInSubAgent: false,
          config: {},
          status: "pending",
          error: null,
          createdAt: now,
          updatedAt: now,
        },
      ];

      await saveNodes(nodes);

      // 2. Bulk Get Nodes
      const fetchedNodes = await getNodes(wfId, ["node-1", "node-2", "node-3", "non-existent"]);
      assertEquals(fetchedNodes.length, 3);
      assertEquals(fetchedNodes.map((n) => n.id).sort(), ["node-1", "node-2", "node-3"]);

      // 3. Bulk Save Edges
      const edges: WorkflowEdge[] = [
        {
          id: "edge-1",
          workflowId: wfId,
          fromNodeId: "node-1",
          toNodeId: "node-2",
        },
        {
          id: "edge-2",
          workflowId: wfId,
          fromNodeId: "node-2",
          toNodeId: "node-3",
        },
      ];

      await saveEdges(edges);

      // 4. Bulk Get Edges
      const fetchedEdges = await getEdges(wfId, ["edge-1", "edge-2", "edge-nonexistent"]);
      assertEquals(fetchedEdges.length, 2);
      assertEquals(fetchedEdges.map((e) => e.id).sort(), ["edge-1", "edge-2"]);

      // 5. Bulk Delete Edges
      await deleteEdges(wfId, ["edge-1", "edge-2"]);
      const remainingEdges = await getEdges(wfId, ["edge-1", "edge-2"]);
      assertEquals(remainingEdges.length, 0);

      // 6. Bulk Delete Nodes
      await deleteNodes(wfId, ["node-1", "node-2", "node-3"]);
      const remainingNodes = await getNodes(wfId, ["node-1", "node-2", "node-3"]);
      assertEquals(remainingNodes.length, 0);
    });
  } finally {
    kv.close();
  }
});

Deno.test("Bulk Operations - Tasks and Dependencies CRUD in bulk", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    const userId = "user_bulk_tasks";

    await withUserContext(userId, async () => {
      // 1. Bulk Create Tasks
      const created = await createTasks([
        {
          id: "tk-b1",
          title: "Setup infrastructure",
          role: "infra-engineer",
          priority: "high",
        },
        {
          id: "tk-b2",
          title: "Build backend services",
          role: "developer",
          priority: "high",
        },
        {
          id: "tk-b3",
          title: "Run security audit",
          role: "security specialist",
          priority: "medium",
        },
      ]);

      assertEquals(created.length, 3);
      assertEquals(created.map((t) => t.id), ["tk-b1", "tk-b2", "tk-b3"]);

      // 2. Bulk Get Tasks
      const fetched = await getTasks(["tk-b1", "tk-b2", "tk-b3", "tk-missing"]);
      assertEquals(fetched.length, 3);
      assertEquals(fetched[0].role, "infra-engineer");
      assertEquals(fetched[1].role, "developer");

      // 3. Bulk Add Dependencies (b1 blocks b2, b2 blocks b3)
      const deps = await addDependencies([
        { fromTaskId: "tk-b1", toTaskId: "tk-b2", type: "blocks" },
        { fromTaskId: "tk-b2", toTaskId: "tk-b3", type: "blocks" },
      ]);

      assertEquals(deps.length, 2);

      // Verify b2 and b3 transitioned to blocked because b1 and b2 are open
      const updatedTasks = await getTasks(["tk-b1", "tk-b2", "tk-b3"]);
      assertEquals(updatedTasks[0].status, "open");
      assertEquals(updatedTasks[1].status, "blocked");
      assertEquals(updatedTasks[2].status, "blocked");
    });
  } finally {
    kv.close();
  }
});
