import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { setKv } from "./client.ts";
import { claimTask, closeTask, createTask, getTask, handoffTask, updateTask } from "./tasks.ts";
import {
  ERR_PIPELINE_MISSING_MANDATORY_NOTES,
  ERR_PIPELINE_PREMATURE_CLOSE,
  ERR_PIPELINE_REJECTION_LIMIT_EXCEEDED,
  ERR_PIPELINE_ROLE_MUTATION_RESTRICTED,
  ERR_PIPELINE_STAGE_ROLE_MISMATCH,
} from "../types.ts";
import { claimTaskTool } from "../../mcp/tools/task_claim.ts";
import { closeTaskTool } from "../../mcp/tools/task_close.ts";
import { updateTaskTool } from "../../mcp/tools/task_update.ts";
import { taskHandoffTool } from "../../mcp/tools/task_handoff.ts";
import { taskPipelineStatusTool } from "../../mcp/tools/task_pipeline_status.ts";
import { taskPipelineOverrideTool } from "../../mcp/tools/task_pipeline_override.ts";
import { taskPipelineAttachTool } from "../../mcp/tools/task_pipeline_attach.ts";
import type { ToolCallResponse } from "../../mcp/registry.ts";

// deno-lint-ignore no-explicit-any
const parseToolResponse = (res: ToolCallResponse): Record<string, any> => {
  if (res.isError) {
    const errorText = res.content.map((c) => c.text).join("; ");
    throw new Error(`Tool returned error: ${errorText}`);
  }
  const item = res.content.find((c) => c.annotations?.audience?.includes("assistant")) ??
    res.content.find((c) => c.type === "text" && c.text.startsWith("{")) ??
    res.content[res.content.length - 1];
  return JSON.parse(item.text);
};

// ---------------------------------------------------------------------------
// 1. Full Multi-Stage Pathway Progression (Developer -> Reviewer -> Security Audit)
// ---------------------------------------------------------------------------
Deno.test("Pipeline E2E - 1. Full Multi-Stage Pathway Progression to Terminal Close", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    // 1. Create task with code-review-audit pipeline
    const task = await createTask({
      title: "Implement High-Security Payment Gateway",
      description: "Integrate Stripe and Apple Pay with end-to-end token encryption.",
      pipelineTemplateId: "code-review-audit",
    });

    assertEquals(task.status, "open");
    assertEquals(task.role, "developer");
    assert(task.pipeline !== undefined);
    assertEquals(task.pipeline.templateId, "code-review-audit");
    assertEquals(task.pipeline.currentStageIndex, 0);
    assertEquals(task.pipeline.currentStageId, "dev");
    assertEquals(task.pipeline.stages[0].status, "active");
    assertEquals(task.pipeline.stages[1].status, "pending");
    assertEquals(task.pipeline.stages[2].status, "pending");

    // 2. Stage 0 (dev): Developer claims and executes work
    const devClaim = await claimTaskTool.execute({
      task: task.id,
      assignee: "alice-dev",
      role: "developer",
    });
    assert(!devClaim.isError);
    const devClaimedData = parseToolResponse(devClaim);
    assertEquals(devClaimedData.task.status, "claimed");
    assertEquals(devClaimedData.task.assignee, "alice-dev");

    // Developer advances to stage 1 (review) with rich handoff context
    const devHandoffRes = await taskHandoffTool.execute({
      task: task.id,
      action: "advance",
      reason: "Feature code complete with unit test coverage of 98%",
      contextSummary: "Implemented AES-256 payload encryption with hardware enclave keys.",
      acceptanceNotes: [
        "All unit tests pass",
        "PCI-DSS mock harness passes without errors",
      ],
    });
    assert(!devHandoffRes.isError);
    const devHandoffData = parseToolResponse(devHandoffRes);

    assertEquals(devHandoffData.task.status, "open");
    assertEquals(devHandoffData.task.role, "reviewer");
    assertEquals(devHandoffData.task.pipeline.currentStageIndex, 1);
    assertEquals(devHandoffData.task.pipeline.currentStageId, "review");
    assertEquals(devHandoffData.task.pipeline.stages[0].status, "completed");
    assertEquals(devHandoffData.task.pipeline.stages[1].status, "active");
    assert(devHandoffData.task.acceptanceNotes.includes("All unit tests pass"));

    // 3. Stage 1 (review): Reviewer claims and advances to stage 2 (audit)
    const revClaim = await claimTaskTool.execute({
      task: task.id,
      assignee: "bob-reviewer",
      role: "reviewer",
    });
    assert(!revClaim.isError);
    const revClaimData = parseToolResponse(revClaim);
    assertEquals(revClaimData.task.status, "claimed");
    assertEquals(revClaimData.task.assignee, "bob-reviewer");

    const revHandoffRes = await taskHandoffTool.execute({
      task: task.id,
      action: "advance",
      reason: "Peer review signed off. Architecture and code clean.",
      acceptanceNotes: [
        "Code review approved by principal engineer",
        "Lint and formatting checks clean",
      ],
    });
    assert(!revHandoffRes.isError);
    const revHandoffData = parseToolResponse(revHandoffRes);

    assertEquals(revHandoffData.task.status, "open");
    assertEquals(revHandoffData.task.role, "security-auditor");
    assertEquals(revHandoffData.task.pipeline.currentStageIndex, 2);
    assertEquals(revHandoffData.task.pipeline.currentStageId, "audit");
    assertEquals(revHandoffData.task.pipeline.stages[1].status, "completed");
    assertEquals(revHandoffData.task.pipeline.stages[2].status, "active");

    // 4. Stage 2 (audit): Security Auditor claims and terminates task
    const auditClaim = await claimTaskTool.execute({
      task: task.id,
      assignee: "carol-auditor",
      role: "security-auditor",
    });
    assert(!auditClaim.isError);
    const auditClaimData = parseToolResponse(auditClaim);
    assertEquals(auditClaimData.task.status, "claimed");
    assertEquals(auditClaimData.task.assignee, "carol-auditor");

    const closeRes = await closeTaskTool.execute({
      task: task.id,
      reason: "Security audit passed. Zero vulnerabilities detected.",
    });
    assert(!closeRes.isError);
    const closeData = parseToolResponse(closeRes);

    assertEquals(closeData.task.status, "closed");
    assertEquals(closeData.task.pipeline.stages[2].status, "completed");
    assertEquals(closeData.task.pipeline.history.length, 2);
    assert(
      closeData.task.acceptanceNotes.includes(
        "Security audit passed. Zero vulnerabilities detected.",
      ),
    );

    // Verify stored task state via getTask
    const finalTask = await getTask(task.id);
    assert(finalTask !== null);
    assertEquals(finalTask.status, "closed");
    assertEquals(finalTask.pipeline?.currentStageIndex, 2);
  } finally {
    await kv.close();
  }
});

// ---------------------------------------------------------------------------
// 2. Premature task_close Prevention on Non-Terminal Stages (Bypass Vector 1)
// ---------------------------------------------------------------------------
Deno.test("Pipeline E2E - 2. Premature task_close Prevention on Non-Terminal Stages", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    const task = await createTask({
      title: "Critical Database Migration",
      pipelineTemplateId: "code-review-audit",
    });

    // Attempting premature close at Stage 0 (dev) via KV direct call
    await assertRejects(
      () => closeTask(task.id, "Attempting to skip review and audit"),
      Error,
      ERR_PIPELINE_PREMATURE_CLOSE,
    );

    // Attempting premature close at Stage 0 (dev) via MCP Tool call
    const prematureCloseRes = await closeTaskTool.execute({
      task: task.id,
      reason: "Trying to close directly from dev stage",
    });
    assert(prematureCloseRes.isError);
    const errorText = prematureCloseRes.content.map((c) => c.text).join(" ");
    assertStringIncludes(errorText, ERR_PIPELINE_PREMATURE_CLOSE);

    // Advance to Stage 1 (review)
    await claimTask(task.id, "dev-1", undefined, "developer");
    await handoffTask({
      taskId: task.id,
      action: "advance",
      reason: "Code written",
    });

    // Attempting premature close at Stage 1 (review) via KV call
    await assertRejects(
      () => closeTask(task.id, "Trying to close from review stage"),
      Error,
      ERR_PIPELINE_PREMATURE_CLOSE,
    );

    // Attempting premature close at Stage 1 (review) via MCP Tool
    const prematureCloseStage1Res = await closeTaskTool.execute({
      task: task.id,
      reason: "Trying to close from review stage via MCP",
    });
    assert(prematureCloseStage1Res.isError);
    assertStringIncludes(
      prematureCloseStage1Res.content.map((c) => c.text).join(" "),
      ERR_PIPELINE_PREMATURE_CLOSE,
    );
  } finally {
    await kv.close();
  }
});

// ---------------------------------------------------------------------------
// 3. Unauthorized Role Claim Prevention in task_claim (Bypass Vector 2)
// ---------------------------------------------------------------------------
Deno.test("Pipeline E2E - 3. Unauthorized Role Claim Prevention in task_claim", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    const task = await createTask({
      title: "Kernel Network Stack Refactor",
      pipelineTemplateId: "code-review-audit", // Stages: dev (developer) -> review (reviewer) -> audit (security-auditor)
    });

    // Stage 0 requires "developer". Claiming with "reviewer" or "security-auditor" must fail.
    await assertRejects(
      () => claimTask(task.id, "bob-reviewer", undefined, "reviewer"),
      Error,
      ERR_PIPELINE_STAGE_ROLE_MISMATCH,
    );

    // Testing via MCP Tool
    const unauthorizedClaim = await claimTaskTool.execute({
      task: task.id,
      assignee: "carol-auditor",
      role: "security-auditor",
    });
    assert(unauthorizedClaim.isError);
    assertStringIncludes(
      unauthorizedClaim.content.map((c) => c.text).join(" "),
      ERR_PIPELINE_STAGE_ROLE_MISMATCH,
    );

    // Valid claim as "developer" succeeds
    const validClaim = await claimTaskTool.execute({
      task: task.id,
      assignee: "alice-dev",
      role: "developer",
    });
    assert(!validClaim.isError);

    // Advance to Stage 1 (reviewer)
    await handoffTask({
      taskId: task.id,
      action: "advance",
      reason: "Kernel patch ready for review",
    });

    // Previous developer role cannot claim stage 1 (reviewer)
    const staleDevClaim = await claimTaskTool.execute({
      task: task.id,
      assignee: "alice-dev",
      role: "developer",
    });
    assert(staleDevClaim.isError);
    assertStringIncludes(
      staleDevClaim.content.map((c) => c.text).join(" "),
      ERR_PIPELINE_STAGE_ROLE_MISMATCH,
    );
  } finally {
    await kv.close();
  }
});

// ---------------------------------------------------------------------------
// 4. Direct Role Mutation Restriction in task_update (Bypass Vector 3)
// ---------------------------------------------------------------------------
Deno.test("Pipeline E2E - 4. Direct Role Mutation Restriction in task_update", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    const task = await createTask({
      title: "Smart Contract Deployment",
      pipelineTemplateId: "code-review-audit",
    });

    // Direct role mutation attempt via KV store must be blocked
    await assertRejects(
      () => updateTask(task.id, { role: "security-auditor" }),
      Error,
      ERR_PIPELINE_ROLE_MUTATION_RESTRICTED,
    );

    // Direct role mutation attempt via MCP tool must return tool error
    const roleMutationRes = await updateTaskTool.execute({
      task: task.id,
      role: "security-auditor",
    });
    assert(roleMutationRes.isError);
    assertStringIncludes(
      roleMutationRes.content.map((c) => c.text).join(" "),
      ERR_PIPELINE_ROLE_MUTATION_RESTRICTED,
    );

    // Non-role updates (title, priority, context) should succeed cleanly
    const safeUpdateRes = await updateTaskTool.execute({
      task: task.id,
      title: "Smart Contract Deployment v2",
      priority: "critical",
      context: "Added testnet deployment transaction hash.",
    });
    assert(!safeUpdateRes.isError);
    const safeUpdateData = parseToolResponse(safeUpdateRes);
    assertEquals(safeUpdateData.task.title, "Smart Contract Deployment v2");
    assertEquals(safeUpdateData.task.priority, "critical");
    assertEquals(safeUpdateData.task.role, "developer"); // Role preserved unmodified
  } finally {
    await kv.close();
  }
});

// ---------------------------------------------------------------------------
// 5. Mandatory Notes, Reasons, and Acceptance Criteria in task_handoff (Bypass Vector 4)
// ---------------------------------------------------------------------------
Deno.test("Pipeline E2E - 5. Mandatory Notes and Reasons in task_handoff", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    const task = await createTask({
      title: "Unity Physics Ragdoll System",
      pipelineTemplateId: "unity-dev-playtest-qa",
    });

    // Advance to playtest
    await claimTask(task.id, "dev-ragdoll", undefined, "developer");
    await handoffTask({
      taskId: task.id,
      action: "advance",
      reason: "Ragdoll physics integrated with character skeleton",
    });

    // Playtest rejection missing required rejectedApproaches should fail
    await assertRejects(
      () =>
        handoffTask({
          taskId: task.id,
          action: "reject",
          reason: "Ragdoll flails uncontrollably on collision",
          // missing rejectedApproaches
        }),
      Error,
      ERR_PIPELINE_MISSING_MANDATORY_NOTES,
    );

    // Same via MCP task_handoff tool
    const missingNotesRes = await taskHandoffTool.execute({
      task: task.id,
      action: "reject",
      reason: "Ragdoll collision glitch",
      // missing rejectedApproaches
    });
    assert(missingNotesRes.isError);
    assertStringIncludes(
      missingNotesRes.content.map((c) => c.text).join(" "),
      ERR_PIPELINE_MISSING_MANDATORY_NOTES,
    );

    // Proper rejection with reason and rejectedApproaches succeeds
    const validRejectRes = await taskHandoffTool.execute({
      task: task.id,
      action: "reject",
      reason: "Joint angular velocity exceeds simulation threshold",
      rejectedApproaches: ["Increased solver iterations without dampening"],
      rejectionReasons: ["Excessive jitter on low framerates"],
    });
    assert(!validRejectRes.isError);
    const validRejectData = parseToolResponse(validRejectRes);
    assertEquals(validRejectData.task.role, "developer");
    assertEquals(validRejectData.task.pipeline.currentStageIndex, 0);
  } finally {
    await kv.close();
  }
});

// ---------------------------------------------------------------------------
// 6. Rejection Loopbacks and Circuit Breaker Escalation (Bypass Vector 5)
// ---------------------------------------------------------------------------
Deno.test("Pipeline E2E - 6. Rejection Loopbacks and Circuit Breaker Escalation", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    const task = await createTask({
      title: "Audio Spatializer Engine",
      pipelineTemplateId: "unity-dev-playtest-qa", // maxRejections: 3
    });

    // Iteration 1
    await claimTask(task.id, "dev-1", undefined, "developer");
    await handoffTask({ taskId: task.id, action: "advance", reason: "Build 1 ready" });

    const rej1 = await handoffTask({
      taskId: task.id,
      action: "reject",
      reason: "Audio clipping in reverb zone",
      rejectedApproaches: ["Approach 1"],
    });
    assertEquals(rej1.task.pipeline?.rejectionCount, 1);
    assertEquals(rej1.task.pipeline?.currentStageIndex, 0);

    // Iteration 2
    await handoffTask({ taskId: task.id, action: "advance", reason: "Build 2 ready" });
    const rej2 = await handoffTask({
      taskId: task.id,
      action: "reject",
      reason: "High CPU usage on 3D spatializer",
      rejectedApproaches: ["Approach 2"],
    });
    assertEquals(rej2.task.pipeline?.rejectionCount, 2);

    // Iteration 3
    await handoffTask({ taskId: task.id, action: "advance", reason: "Build 3 ready" });
    const rej3 = await handoffTask({
      taskId: task.id,
      action: "reject",
      reason: "Doppler distortion artifact",
      rejectedApproaches: ["Approach 3"],
    });
    assertEquals(rej3.task.pipeline?.rejectionCount, 3);

    // Advance once more to playtest
    await handoffTask({ taskId: task.id, action: "advance", reason: "Build 4 ready" });

    // Iteration 4: Exceeds defaultMaxRejections (3) -> Circuit breaker trips
    await assertRejects(
      () =>
        handoffTask({
          taskId: task.id,
          action: "reject",
          reason: "Still failing quality threshold",
          rejectedApproaches: ["Approach 4"],
        }),
      Error,
      ERR_PIPELINE_REJECTION_LIMIT_EXCEEDED,
    );

    // MCP task_handoff tool also returns circuit breaker error
    const tripToolRes = await taskHandoffTool.execute({
      task: task.id,
      action: "reject",
      reason: "Exceeding limit via MCP",
      rejectedApproaches: ["Approach 4"],
    });
    assert(tripToolRes.isError);
    assertStringIncludes(
      tripToolRes.content.map((c) => c.text).join(" "),
      ERR_PIPELINE_REJECTION_LIMIT_EXCEEDED,
    );
  } finally {
    await kv.close();
  }
});

// ---------------------------------------------------------------------------
// 7. Manager Overrides (skip_stage, force_advance, reset_rejections)
// ---------------------------------------------------------------------------
Deno.test("Pipeline E2E - 7. Manager Overrides (skip_stage, force_advance, reset_rejections)", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    const task = await createTask({
      title: "Fast-Track Security Patch",
      pipelineTemplateId: "code-review-audit",
    });

    // 1. Manager skips current stage (dev -> review)
    const skipRes = await taskPipelineOverrideTool.execute({
      task: task.id,
      action: "skip_stage",
      justification: "Approved existing external patch directly.",
      managerId: "eng-director",
    });
    assert(!skipRes.isError);
    const skipData = parseToolResponse(skipRes);
    assertEquals(skipData.task.pipeline.currentStageIndex, 1);
    assertEquals(skipData.task.pipeline.currentStageId, "review");
    assertEquals(skipData.task.role, "reviewer");
    assertEquals(skipData.task.pipeline.stages[0].status, "skipped");
    assertEquals(skipData.task.pipeline.stages[1].status, "active");

    // 2. Manager force advances directly to terminal stage (audit)
    const forceAdvanceRes = await taskPipelineOverrideTool.execute({
      task: task.id,
      action: "force_advance",
      targetStageId: "audit",
      justification: "Emergency expedited review for critical CVE.",
      managerId: "eng-director",
    });
    assert(!forceAdvanceRes.isError);
    const forceData = parseToolResponse(forceAdvanceRes);
    assertEquals(forceData.task.pipeline.currentStageIndex, 2);
    assertEquals(forceData.task.pipeline.currentStageId, "audit");
    assertEquals(forceData.task.role, "security-auditor");

    // 3. Manager resets rejection counter
    const resetRes = await taskPipelineOverrideTool.execute({
      task: task.id,
      action: "reset_rejections",
      justification: "Resetting rejection counter following audit scope adjustment.",
      managerId: "eng-director",
    });
    assert(!resetRes.isError);
    const resetData = parseToolResponse(resetRes);
    assertEquals(resetData.task.pipeline.rejectionCount, 0);
  } finally {
    await kv.close();
  }
});

// ---------------------------------------------------------------------------
// 8. Diagnostic Status Inspection via task_pipeline_status
// ---------------------------------------------------------------------------
Deno.test("Pipeline E2E - 8. Diagnostic Status Inspection via task_pipeline_status", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    // 1. Unpipelined task inspection
    const unpipelined = await createTask({
      title: "Ad-hoc Maintenance Script",
    });

    const unpipelinedStatusRes = await taskPipelineStatusTool.execute({
      task: unpipelined.id,
      format: "both",
    });
    assert(!unpipelinedStatusRes.isError);
    const unpipelinedData = parseToolResponse(unpipelinedStatusRes);
    assertEquals(unpipelinedData.isPipelined, false);
    assertEquals(unpipelinedData.pipeline, null);

    const unpipelinedMd = unpipelinedStatusRes.content.find((c) =>
      c.type === "text" && c.text.includes("unpipelined")
    )?.text;
    assert(unpipelinedMd !== undefined);
    assertStringIncludes(unpipelinedMd, "unpipelined");

    // 2. Attach pipeline to task
    const attachRes = await taskPipelineAttachTool.execute({
      task: unpipelined.id,
      templateId: "hotfix-fast-track",
      justification: "Elevating task to hotfix pipeline",
    });
    assert(!attachRes.isError);

    // 3. Pipelined task status inspection
    const pipelinedStatusRes = await taskPipelineStatusTool.execute({
      task: unpipelined.id,
      format: "both",
    });
    assert(!pipelinedStatusRes.isError);
    const pipelinedData = parseToolResponse(pipelinedStatusRes);
    assertEquals(pipelinedData.isPipelined, true);
    assertEquals(pipelinedData.pipeline.templateId, "hotfix-fast-track");
    assertEquals(pipelinedData.pipeline.currentStageIndex, 0);
    assertEquals(pipelinedData.pipeline.totalStages, 2);
    assertEquals(pipelinedData.pipeline.completedStages, 0);
    assertEquals(pipelinedData.pipeline.progressPercent, 0);

    const pipelinedMd = pipelinedStatusRes.content.find((c) =>
      c.type === "text" && c.text.includes("## 🔄 Pipeline Status")
    )?.text;
    assert(pipelinedMd !== undefined);
    assertStringIncludes(pipelinedMd, "hotfix-fast-track");
    assertStringIncludes(pipelinedMd, "Hotfix Implementation");
    assertStringIncludes(pipelinedMd, "Stages Matrix");
  } finally {
    await kv.close();
  }
});

// ---------------------------------------------------------------------------
// 9. Unpipelined Tasks Backward Compatibility
// ---------------------------------------------------------------------------
Deno.test("Pipeline E2E - 9. Unpipelined Tasks Full Backward Compatibility", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    // 1. Create standard unpipelined task
    const task = await createTask({
      title: "Ad-hoc Refactoring Task",
      role: "general-engineer",
    });

    assertEquals(task.pipeline, undefined);

    // 2. Any role can claim without restriction
    const claimRes = await claimTaskTool.execute({
      task: task.id,
      assignee: "worker-specialist",
      role: "specialist-role",
    });
    assert(!claimRes.isError);
    const claimData = parseToolResponse(claimRes);
    assertEquals(claimData.task.status, "claimed");
    assertEquals(claimData.task.assignee, "worker-specialist");

    // 3. Direct role mutation is allowed on unpipelined tasks
    const updateRes = await updateTaskTool.execute({
      task: task.id,
      role: "infrastructure-lead",
      priority: "high",
    });
    assert(!updateRes.isError);
    const updateData = parseToolResponse(updateRes);
    assertEquals(updateData.task.role, "infrastructure-lead");

    // 4. Flexible handoff between arbitrary assignees & roles
    const handoffRes = await taskHandoffTool.execute({
      task: task.id,
      toAssignee: "worker-infra",
      toRole: "site-reliability",
      reason: "Transferring task for overnight infra monitoring",
    });
    assert(!handoffRes.isError);
    const handoffData = parseToolResponse(handoffRes);
    assertEquals(handoffData.task.assignee, "worker-infra");
    assertEquals(handoffData.task.role, "site-reliability");

    // 5. Close task immediately without premature close error
    const closeRes = await closeTaskTool.execute({
      task: task.id,
      reason: "Refactoring completed successfully",
    });
    assert(!closeRes.isError);
    const closeData = parseToolResponse(closeRes);
    assertEquals(closeData.task.status, "closed");
  } finally {
    await kv.close();
  }
});
