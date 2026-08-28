import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { createTask, getMemoryAccessLog, saveMemory, setKv } from "../../store/kv.ts";
import { roleCreateTool } from "./role_create.ts";
import { roleListTool } from "./role_list.ts";
import { journalWriteTool } from "./journal_write.ts";
import { journalReadTool } from "./journal_read.ts";
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
    // 1. Create first role
    const createRes1 = await roleCreateTool.execute({
      name: "qa-lead",
      description: "Responsible for QA strategy and end-to-end tests",
    });
    assert(!createRes1.isError, "role_create should succeed");
    const data1 = parseJsonContent(createRes1);
    assertEquals(data1.role.name, "qa-lead");
    assertEquals(data1.role.description, "Responsible for QA strategy and end-to-end tests");
    assert(data1.role.id, "Role should have an ID");

    // 2. Create second role without description
    const createRes2 = await roleCreateTool.execute({
      name: "devops",
    });
    assert(!createRes2.isError);
    const data2 = parseJsonContent(createRes2);
    assertEquals(data2.role.name, "devops");

    // 3. List roles as JSON
    const listResJson = await roleListTool.execute({ format: "json" });
    assert(!listResJson.isError);
    const listJson = parseJsonContent(listResJson);
    assertEquals(listJson.roles.length, 2);
    const roleNames = listJson.roles.map((r: { name: string }) => r.name);
    assert(roleNames.includes("qa-lead"));
    assert(roleNames.includes("devops"));

    // 4. List roles as Markdown
    const listResMd = await roleListTool.execute({ format: "markdown" });
    assert(!listResMd.isError);
    const mdText = listResMd.content[0].text;
    assertStringIncludes(mdText, "## 👥 Roles (2)");
    assertStringIncludes(mdText, "qa-lead");
    assertStringIncludes(mdText, "Responsible for QA strategy");

    // 5. List roles with default format 'both'
    const listResBoth = await roleListTool.execute({});
    assert(!listResBoth.isError);
    assertEquals(listResBoth.content.length, 2);
  } finally {
    kv.close();
  }
});

Deno.test("Journal MCP Tools - journal_write, journal_read, and overwrite behavior", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    // 1. Reading nonexistent journal returns null
    const initialRead = await journalReadTool.execute({ role: "security-auditor" });
    assert(!initialRead.isError);
    const initialData = parseJsonContent(initialRead);
    assertEquals(initialData.journal, null);

    // 2. Write initial journal entry
    const writeRes1 = await journalWriteTool.execute({
      role: "security-auditor",
      entry: "Reviewed auth service endpoints; found unvalidated token expiration on /refresh.",
      writtenBy: "agent-alpha",
    });
    assert(!writeRes1.isError);
    const writeData1 = parseJsonContent(writeRes1);
    assertEquals(writeData1.journal.roleId, "security-auditor");
    assertEquals(writeData1.journal.writtenBy, "agent-alpha");
    assertStringIncludes(writeData1.journal.entry, "Reviewed auth service endpoints");

    // 3. Read back written journal entry
    const readRes1 = await journalReadTool.execute({ role: "security-auditor" });
    assert(!readRes1.isError);
    const readData1 = parseJsonContent(readRes1);
    assertEquals(readData1.journal.roleId, "security-auditor");
    assertEquals(readData1.journal.entry, writeData1.journal.entry);
    assertEquals(readData1.journal.writtenBy, "agent-alpha");

    // 4. Write new entry - must overwrite previous entry (single entry snapshot)
    const writeRes2 = await journalWriteTool.execute({
      role: "security-auditor",
      entry:
        "Token expiration bug patched in commit 4f1a2b. Next step is penetration testing /oauth/token.",
      writtenBy: "agent-beta",
    });
    assert(!writeRes2.isError);

    // 5. Read again and verify overwritten content
    const readRes2 = await journalReadTool.execute({ role: "security-auditor" });
    const readData2 = parseJsonContent(readRes2);
    assertEquals(readData2.journal.writtenBy, "agent-beta");
    assertEquals(
      readData2.journal.entry,
      "Token expiration bug patched in commit 4f1a2b. Next step is penetration testing /oauth/token.",
    );
    assert(!readData2.journal.entry.includes("Reviewed auth service endpoints"));
  } finally {
    kv.close();
  }
});

Deno.test("Task Handoff Tool - context preservation, rejected approaches, and assignee/role transfer", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    // 1. Create a task with existing context and rejected approaches
    const task = await createTask({
      title: "Implement OAuth2 Flow",
      description: "Implement OAuth authorization code flow with PKCE",
      role: "backend",
      assignee: "alice",
      status: "in_progress",
      context: "Discovered existing OAuth provider metadata at /.well-known/openid-configuration.",
      rejectedApproaches: ["Client secret in query parameters"],
    });

    // 2. Perform handoff to bob with new role 'security-reviewer'
    const handoffRes1 = await taskHandoffTool.execute({
      taskId: task.id,
      reason: "Need security audit on PKCE code verifier generation",
      contextSummary: "Added cryptographic random verifier, ready for security review.",
      rejectedApproaches: ["Math.random for code_challenge"],
      toAssignee: "bob",
      toRole: "security-reviewer",
    });

    assert(!handoffRes1.isError);
    const handoffData1 = parseJsonContent(handoffRes1);
    const updatedTask1 = handoffData1.task;
    const record1 = handoffData1.handoffRecord;

    // Check handoff record
    assertEquals(record1.taskId, task.id);
    assertEquals(record1.fromAssignee, "alice");
    assertEquals(record1.toAssignee, "bob");
    assertEquals(record1.toRole, "security-reviewer");
    assertEquals(record1.reason, "Need security audit on PKCE code verifier generation");
    assertEquals(
      record1.contextSummary,
      "Added cryptographic random verifier, ready for security review.",
    );
    assertEquals(record1.rejectedApproaches, ["Math.random for code_challenge"]);

    // Check task state updates
    assertEquals(updatedTask1.assignee, "bob");
    assertEquals(updatedTask1.role, "security-reviewer");
    assertEquals(updatedTask1.status, "claimed");
    assertStringIncludes(updatedTask1.context, "Discovered existing OAuth provider metadata");
    assertStringIncludes(updatedTask1.context, "Added cryptographic random verifier");
    assertEquals(updatedTask1.rejectedApproaches, [
      "Client secret in query parameters",
      "Math.random for code_challenge",
    ]);

    // 3. Perform second handoff: release to queue (no toAssignee) with new role 'qa'
    const handoffRes2 = await taskHandoffTool.execute({
      task: task.id,
      reason: "Security approved, releasing to QA team queue",
      contextSummary: "PKCE generation passed entropy and timing audit.",
      toRole: "qa",
    });

    assert(!handoffRes2.isError);
    const handoffData2 = parseJsonContent(handoffRes2);
    const updatedTask2 = handoffData2.task;
    const record2 = handoffData2.handoffRecord;

    assertEquals(record2.fromAssignee, "bob");
    assertEquals(record2.toAssignee, undefined);
    assertEquals(record2.toRole, "qa");
    assertEquals(updatedTask2.assignee, undefined);
    assertEquals(updatedTask2.role, "qa");
    assertEquals(updatedTask2.status, "open");
    assertStringIncludes(updatedTask2.context, "PKCE generation passed entropy");

    // 4. Test handoff on non-existent task errors gracefully
    const invalidRes = await taskHandoffTool.execute({
      taskId: "tk-nonexistent",
      reason: "Test fail",
    });
    assert(invalidRes.isError);
    assertStringIncludes(invalidRes.content[0].text, "Task not found");
  } finally {
    kv.close();
  }
});

Deno.test("Context Prime Tool - bootstrap session with journal, memories, handoffs, and ready frontier", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    const workflowId = "wf-auth-flow";
    const nodeId = "node-verify-token";
    const role = "security-auditor";

    // 1. Setup role journal
    await journalWriteTool.execute({
      role,
      entry: "Prior auditor checked crypto primitives. Current focus is JWT expiration handling.",
      writtenBy: "auditor-1",
    });

    // 2. Setup workflow, node, and role memories
    const memWf = await saveMemory({
      key: "jwt-spec",
      summary: "JWT RS256 Spec",
      content: "All access tokens must be RS256 signed with key ID matching JWKS.",
      scope: "workflow",
      workflowId,
    });

    const memNode = await saveMemory({
      key: "replay-prevention",
      summary: "Token Replay Prevention",
      content: "Ensure jti claim is validated against replay cache with 5-minute TTL.",
      scope: "node",
      workflowId,
      nodeId,
    });

    const memRole = await saveMemory({
      key: "auth-audit-checklist",
      summary: "Standard Auth Audit Checklist",
      content: "1. Clock skew <= 60s\n2. Issuer strict equality\n3. Audience validation",
      scope: "role",
      roleId: role,
    });

    // 3. Create active task with handoff
    const activeTask = await createTask({
      title: "Audit Token Verification Node",
      description: "Verify claims validation in node-verify-token",
      role,
      assignee: "auditor-1",
      workflowId,
      nodeId,
      status: "in_progress",
      context: "Initial inspection of node code completed.",
      rejectedApproaches: ["Bypassing signature validation in tests"],
    });

    // Add a handoff
    await taskHandoffTool.execute({
      taskId: activeTask.id,
      reason: "Shift change to night auditor",
      contextSummary: "Discovered clock skew issue when validating 'nbf' claim.",
      rejectedApproaches: ["Disabling 'nbf' check"],
      toAssignee: "auditor-2",
    });

    // 4. Create another open unblocked task for the ready frontier
    const readyTask = await createTask({
      title: "Configure JWKS Caching",
      workflowId,
      role,
      status: "open",
    });

    // 5. Call context_prime
    const primeRes = await contextPrimeTool.execute({
      taskId: activeTask.id,
      tokenBudget: 2000,
    });

    assert(!primeRes.isError, "context_prime should succeed");
    const primeData = parseJsonContent(primeRes);

    assertEquals(primeData.journalLoaded, true);
    assertEquals(primeData.handoffsLoaded, 1);
    assert(primeData.memoriesLoaded >= 1, "At least one memory should be loaded");

    const md = primeData.context;
    // Active task details
    assertStringIncludes(md, activeTask.id);
    assertStringIncludes(md, "Audit Token Verification Node");
    assertStringIncludes(md, "Initial inspection of node code completed");
    assertStringIncludes(md, "Bypassing signature validation in tests");
    assertStringIncludes(md, "Disabling 'nbf' check");

    // Handoff details
    assertStringIncludes(md, "Recent Task Handoffs");
    assertStringIncludes(md, "Shift change to night auditor");

    // Journal details
    assertStringIncludes(md, "Role Journal");
    assertStringIncludes(md, "Prior auditor checked crypto primitives");

    // Recalled memories
    assertStringIncludes(md, "Recalled Memories");

    // Ready frontier
    assertStringIncludes(md, "Ready Frontier");
    assertStringIncludes(md, readyTask.id);

    // 6. Verify that recallMemory logged access in the access log!
    const wfLog = await getMemoryAccessLog(memWf.memory.id);
    const nodeLog = await getMemoryAccessLog(memNode.memory.id);
    const roleLog = await getMemoryAccessLog(memRole.memory.id);
    const totalLogged = wfLog.length + nodeLog.length + roleLog.length;
    assertEquals(
      totalLogged,
      primeData.memoriesLoaded,
      "Access logs count should match memoriesLoaded count",
    );

    // 7. Verify token budget constraint
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

    // 8. Verify context_prime with no parameters runs cleanly
    const emptyRes = await contextPrimeTool.execute({});
    assert(!emptyRes.isError);
    const emptyData = parseJsonContent(emptyRes);
    assertEquals(emptyData.journalLoaded, false);
    assertEquals(emptyData.handoffsLoaded, 0);
    assertEquals(emptyData.memoriesLoaded, 0);
  } finally {
    kv.close();
  }
});

Deno.test("Role and Context Prime Edge Cases", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    // 1. Role update updates existing role
    await roleCreateTool.execute({ name: "data-eng", description: "V1 description" });
    const updateRes = await roleCreateTool.execute({
      name: "data-eng",
      description: "V2 description",
    });
    assert(!updateRes.isError);
    const updatedRoleData = parseJsonContent(updateRes);
    assertEquals(updatedRoleData.role.description, "V2 description");

    // 2. Task handoff with minimal arguments (no optional contextSummary or rejectedApproaches)
    const task = await createTask({
      title: "Clean database records",
      role: "data-eng",
      assignee: "alice",
    });

    const minimalHandoffRes = await taskHandoffTool.execute({
      task: task.id,
      reason: "Handing off for next shift",
      toAssignee: "bob",
    });
    assert(!minimalHandoffRes.isError);
    const minHandoffData = parseJsonContent(minimalHandoffRes);
    assertEquals(minHandoffData.task.assignee, "bob");
    assertEquals(minHandoffData.handoffRecord.reason, "Handing off for next shift");
    assertEquals(minHandoffData.handoffRecord.contextSummary, "");
    assertEquals(minHandoffData.handoffRecord.rejectedApproaches, []);

    // 3. context_prime with role and workflow without taskId
    await journalWriteTool.execute({
      role: "data-eng",
      entry: "Pipeline migration 60% complete.",
      writtenBy: "bob",
    });

    await saveMemory({
      key: "pipeline-db",
      summary: "Database connection pool",
      content: "Max 50 connections to Postgres replica.",
      scope: "role",
      roleId: "data-eng",
    });

    const rolePrimeRes = await contextPrimeTool.execute({
      role: "data-eng",
      tokenBudget: 1500,
    });
    assert(!rolePrimeRes.isError);
    const rolePrimeData = parseJsonContent(rolePrimeRes);
    assertEquals(rolePrimeData.journalLoaded, true);
    assertEquals(rolePrimeData.memoriesLoaded, 1);
    assertStringIncludes(rolePrimeData.context, "Pipeline migration 60% complete.");
    assertStringIncludes(rolePrimeData.context, "Database connection pool");
  } finally {
    kv.close();
  }
});
