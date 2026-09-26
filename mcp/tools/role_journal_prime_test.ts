import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { createTask, saveExecution, saveMemory, setKv } from "../../store/kv.ts";
import { roleCreateTool } from "./role_create.ts";
import { roleListTool } from "./role_list.ts";
import { taskHandoffTool } from "./task_handoff.ts";
import { contextPrimeTool } from "./context_prime.ts";

const parseJsonContent = (res: {
  content: Array<{ type: string; text: string; annotations?: { audience?: string[] } }>;
}) => {
  const jsonItem = res.content.find((c) => c.annotations?.audience?.includes("assistant")) ??
    res.content[res.content.length - 1];
  return JSON.parse(jsonItem.text);
};

Deno.test("Role MCP Tools - role_create and role_list", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    const workflowId = "wf-role-test";

    // 1. Create first role
    const createRes1 = await roleCreateTool.execute({
      workflowId,
      name: "qa-lead",
      description: "Responsible for QA strategy and end-to-end tests",
    });
    assert(!createRes1.isError, "role_create should succeed");
    const data1 = parseJsonContent(createRes1);
    assertEquals(data1.role.name, "qa-lead");
    assertEquals(data1.role.description, "Responsible for QA strategy and end-to-end tests");
    assertEquals(data1.role.workflowId, workflowId);
    assert(data1.role.id, "Role should have an ID");

    // 2. Create second role without description
    const createRes2 = await roleCreateTool.execute({
      workflowId,
      name: "devops",
    });
    assert(!createRes2.isError);
    const data2 = parseJsonContent(createRes2);
    assertEquals(data2.role.name, "devops");

    // 3. List roles as JSON
    const listResJson = await roleListTool.execute({ workflowId, format: "json" });
    assert(!listResJson.isError);
    const listJson = parseJsonContent(listResJson);
    assertEquals(listJson.roles.length, 2);
    const roleNames = listJson.roles.map((r: { name: string }) => r.name);
    assert(roleNames.includes("qa-lead"));
    assert(roleNames.includes("devops"));

    // 4. List roles as Markdown
    const listResMd = await roleListTool.execute({ workflowId, format: "markdown" });
    assert(!listResMd.isError);
    const mdText = listResMd.content[0].text;
    assertStringIncludes(mdText, `## 👥 Roles for Workflow \`${workflowId}\` (2)`);
    assertStringIncludes(mdText, "qa-lead");
    assertStringIncludes(mdText, "Responsible for QA strategy");

    // 5. List roles with default format 'both'
    const listResBoth = await roleListTool.execute({ workflowId });
    assert(!listResBoth.isError);
    assertEquals(listResBoth.content.length, 2);

    // 6. Role create validation: <= 500 chars succeeds, > 500 chars fails
    const valid500 = "a".repeat(500);
    const validRes = await roleCreateTool.execute({
      workflowId,
      name: "valid-desc-role",
      description: valid500,
    });
    assert(!validRes.isError);
    const validData = parseJsonContent(validRes);
    assertEquals(validData.role.description.length, 500);

    const invalid501 = "a".repeat(501);
    const invalidRes = await roleCreateTool.execute({
      workflowId,
      name: "invalid-desc-role",
      description: invalid501,
    });
    assert(invalidRes.isError, "role_create with description > 500 chars should fail");
    assertStringIncludes(invalidRes.content[0].text, "500 characters");
  } finally {
    kv.close();
  }
});

Deno.test("Task Handoff Tool - role-to-role advance, reject (rejectionCount), and escalate", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    // 1. Create a task
    const task = await createTask({
      title: "Implement OAuth2 Flow",
      description: "Implement OAuth authorization code flow with PKCE",
      role: "backend",
      assignee: "alice",
      status: "in_progress",
      context: "Discovered existing OAuth provider metadata at /.well-known/openid-configuration.",
      rejectedApproaches: ["Client secret in query parameters"],
    });

    // 2. Perform handoff to bob with new role 'reviewer' using action: 'advance'
    const handoffRes1 = await taskHandoffTool.execute({
      taskId: task.id,
      action: "advance",
      reason: "Need security audit on PKCE code verifier generation",
      contextSummary: "Added cryptographic random verifier, ready for security review.",
      rejectedApproaches: ["Math.random for code_challenge"],
      toAssignee: "bob",
      toRole: "reviewer",
    });

    assert(!handoffRes1.isError);
    const handoffData1 = parseJsonContent(handoffRes1);
    const updatedTask1 = handoffData1.task;
    const record1 = handoffData1.handoffRecord;

    assertEquals(record1.taskId, task.id);
    assertEquals(record1.action, "advance");
    assertEquals(record1.fromAssignee, "alice");
    assertEquals(record1.toAssignee, "bob");
    assertEquals(record1.toRole, "reviewer");
    assertEquals(updatedTask1.assignee, "bob");
    assertEquals(updatedTask1.role, "reviewer");
    assertStringIncludes(updatedTask1.context, "Discovered existing OAuth provider metadata");
    assertStringIncludes(updatedTask1.context, "Added cryptographic random verifier");

    // 3. Reject handoff back to alice
    const handoffRes2 = await taskHandoffTool.execute({
      taskId: task.id,
      action: "reject",
      reason: "Missing edge case tests and entropy check",
      contextSummary: "Code verifier does not validate length limits.",
      feedback: ["Add test for verifier length > 128", "Check base64url encoding"],
      toAssignee: "alice",
      toRole: "backend",
    });

    assert(!handoffRes2.isError);
    const handoffData2 = parseJsonContent(handoffRes2);
    const updatedTask2 = handoffData2.task;
    const record2 = handoffData2.handoffRecord;

    assertEquals(record2.action, "reject");
    assertEquals(updatedTask2.rejectionCount, 1);
    assertEquals(updatedTask2.status, "open");
    assertEquals(updatedTask2.role, "backend");
    assert(updatedTask2.comments.some((c: { content: string }) => c.content.includes("base64url encoding")));

    // 4. Test handoff on non-existent task errors gracefully
    const invalidRes = await taskHandoffTool.execute({
      taskId: "tk-nonexistent",
      action: "advance",
      toRole: "qa",
      reason: "Test fail",
      contextSummary: "None",
    });
    assert(invalidRes.isError);
    assertStringIncludes(invalidRes.content[0].text, "Task not found");
  } finally {
    kv.close();
  }
});

Deno.test("Context Prime Tool - bootstrap session with active executions, memories, handoffs, and ready frontier", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    const workflowId = "wf-auth-flow";
    const role = "developer";

    // 1. Setup workflow architecture memories
    await saveMemory({
      workflowId,
      key: "jwt-spec",
      summary: "JWT RS256 Spec",
      content: "All access tokens must be RS256 signed with key ID matching JWKS.",
      tags: ["architecture", "security"],
    });

    await saveMemory({
      workflowId,
      key: "replay-prevention",
      summary: "Token Replay Prevention",
      content: "Ensure jti claim is validated against replay cache with 5-minute TTL.",
      tags: ["architecture"],
    });

    // 2. Setup active workflow execution
    await saveExecution({
      id: "exec-auth-001",
      workflowId,
      status: "in_progress",
      context: { initialized: true },
      nodeStates: {
        "node-start": {
          nodeId: "node-start",
          status: "completed",
          error: null,
          iteration: 1,
          iterationHistory: [],
          updatedAt: new Date().toISOString(),
        },
        "node-dev": {
          nodeId: "node-dev",
          status: "running",
          error: null,
          iteration: 1,
          iterationHistory: [],
          updatedAt: new Date().toISOString(),
        },
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // 3. Create active task with handoff
    const activeTask = await createTask({
      title: "Audit Token Verification Node",
      description: "Verify claims validation in node-verify-token",
      role,
      assignee: "alice",
      workflowId,
      status: "claimed",
      context: "Initial inspection of node code completed.",
      rejectedApproaches: ["Bypassing signature validation in tests"],
    });

    await taskHandoffTool.execute({
      taskId: activeTask.id,
      action: "advance",
      toRole: "reviewer",
      toAssignee: "bob",
      reason: "Shift change to reviewer",
      contextSummary: "Discovered clock skew issue when validating nbf claim.",
      feedback: ["Check nbf skew"],
      rejectedApproaches: ["Disabling nbf check"],
    });

    // 4. Create another open unblocked task for the ready frontier
    const readyTask = await createTask({
      title: "Configure JWKS Caching",
      workflowId,
      role: "reviewer",
      status: "open",
    });

    // 5. Call context_prime
    const primeRes = await contextPrimeTool.execute({
      taskId: activeTask.id,
      tokenBudget: 2000,
    });

    assert(!primeRes.isError, "context_prime should succeed");
    const primeData = parseJsonContent(primeRes);

    assertEquals(primeData.handoffsLoaded, 1);
    assert(primeData.memoriesLoaded >= 1, "At least one memory should be loaded");

    const md = primeData.context;
    assertStringIncludes(md, activeTask.id);
    assertStringIncludes(md, "Audit Token Verification Node");
    assertStringIncludes(md, "Recent Task Handoffs");
    assertStringIncludes(md, "Shift change to reviewer");
    assertStringIncludes(md, "Active Workflow Executions");
    assertStringIncludes(md, "exec-auth-001");
    assertStringIncludes(md, "Architecture & Project Memories");
    assertStringIncludes(md, "jwt-spec");
    assertStringIncludes(md, "Ready Frontier");
    assertStringIncludes(md, readyTask.id);

    // 6. Verify token budget constraint
    const smallBudgetRes = await contextPrimeTool.execute({
      taskId: activeTask.id,
      tokenBudget: 50, // 50 tokens * 4 = 200 chars
    });
    assert(!smallBudgetRes.isError);
    const smallBudgetData = parseJsonContent(smallBudgetRes);
    assert(
      smallBudgetData.context.length <= 200,
      `Context length ${smallBudgetData.context.length} exceeds 200 chars budget`,
    );

    // 7. Verify context_prime with no parameters runs cleanly
    const emptyRes = await contextPrimeTool.execute({});
    assert(!emptyRes.isError);
    const emptyData = parseJsonContent(emptyRes);
    assertEquals(emptyData.handoffsLoaded, 0);
    assertEquals(emptyData.memoriesLoaded, 0);
  } finally {
    kv.close();
  }
});
