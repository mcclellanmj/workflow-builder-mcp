import { assertEquals } from "@std/assert";
import { withUserContext } from "../auth/context.ts";
import {
  deleteWorkflow,
  getExecution,
  getWorkflow,
  listExecutions,
  listNodes,
  listReferencedChildWorkflowIds,
  listWorkflows,
  saveExecution,
  saveNode,
  saveWorkflow,
  setKv,
} from "./kv.ts";
import type { Workflow, WorkflowExecution, WorkflowNode } from "./types.ts";

Deno.test("User Scoped KV Store - complete isolation between tenants", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    const userAlice = "user_alice_123";
    const userBob = "user_bob_456";

    // 1. Alice creates a workflow
    const aliceWf: Workflow = {
      id: "wf-shared-id",
      name: "Alice Private Pipeline",
      description: "Confidential research",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await withUserContext(userAlice, async () => {
      await saveWorkflow(aliceWf);
      const aliceNode: WorkflowNode = {
        id: "node-1",
        workflowId: aliceWf.id,
        type: "step",
        name: "Alice Step",
        description: "Do secret work",
        runInSubAgent: false,
        config: {},
        status: "pending",
        error: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await saveNode(aliceNode);
    });

    // 2. Bob lists workflows — should see 0
    await withUserContext(userBob, async () => {
      const bobList = await listWorkflows();
      assertEquals(bobList.length, 0);

      const bobGet = await getWorkflow("wf-shared-id");
      assertEquals(bobGet, null);

      const bobNodes = await listNodes("wf-shared-id");
      assertEquals(bobNodes.length, 0);
    });

    // 3. Bob creates a workflow with the SAME ID "wf-shared-id"
    const bobWf: Workflow = {
      id: "wf-shared-id",
      name: "Bob Marketing Pipeline",
      description: "Public campaign",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await withUserContext(userBob, async () => {
      await saveWorkflow(bobWf);
    });

    // 4. Verify Alice still sees her own workflow and Bob sees his
    await withUserContext(userAlice, async () => {
      const aliceGet = await getWorkflow("wf-shared-id");
      assertEquals(aliceGet?.name, "Alice Private Pipeline");
      const aliceNodes = await listNodes("wf-shared-id");
      assertEquals(aliceNodes.length, 1);
    });

    await withUserContext(userBob, async () => {
      const bobGet = await getWorkflow("wf-shared-id");
      assertEquals(bobGet?.name, "Bob Marketing Pipeline");
      const bobNodes = await listNodes("wf-shared-id");
      assertEquals(bobNodes.length, 0);
    });

    // 5. Alice deletes her workflow — Bob's workflow must remain intact
    await withUserContext(userAlice, async () => {
      await deleteWorkflow("wf-shared-id");
      const aliceList = await listWorkflows();
      assertEquals(aliceList.length, 0);
    });

    await withUserContext(userBob, async () => {
      const bobList = await listWorkflows();
      assertEquals(bobList.length, 1);
      assertEquals(bobList[0].name, "Bob Marketing Pipeline");
    });
  } finally {
    kv.close();
  }
});

Deno.test("User Scoped KV Store - Execution run isolation", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    const user1 = "user_1";
    const user2 = "user_2";

    const exec: WorkflowExecution = {
      id: "exec-100",
      workflowId: "wf-1",
      status: "in_progress",
      nodeStates: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await withUserContext(user1, async () => {
      await saveExecution(exec);
      const res = await getExecution("exec-100");
      assertEquals(res?.id, "exec-100");
      const list = await listExecutions();
      assertEquals(list.length, 1);
    });

    await withUserContext(user2, async () => {
      const res = await getExecution("exec-100");
      assertEquals(res, null);
      const list = await listExecutions();
      assertEquals(list.length, 0);
    });
  } finally {
    kv.close();
  }
});

Deno.test("User Scoped KV Store - Subworkflow reference isolation", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    const user1 = "user_1";
    const user2 = "user_2";

    // User 1 creates a subworkflow node referencing child "child-wf-1"
    await withUserContext(user1, async () => {
      const subNode: WorkflowNode = {
        id: "sub-1",
        workflowId: "parent-1",
        type: "subworkflow",
        name: "Run Child",
        description: "Executes child",
        runInSubAgent: false,
        config: { childWorkflowId: "child-wf-1" },
        status: "pending",
        error: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await saveNode(subNode);

      const refs = await listReferencedChildWorkflowIds();
      assertEquals(refs.has("child-wf-1"), true);
    });

    // User 2 should NOT see User 1's subworkflow references
    await withUserContext(user2, async () => {
      const refs = await listReferencedChildWorkflowIds();
      assertEquals(refs.has("child-wf-1"), false);
    });
  } finally {
    kv.close();
  }
});
