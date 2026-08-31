import {
  assert,
  assertEquals,
  assertRejects,
} from "@std/assert";
import { setKv } from "./client.ts";
import {
  attachPipelineToTask,
  claimTask,
  closeTask,
  createTask,
  handoffTask,
  overrideTaskPipeline,
  updateTask,
} from "./tasks.ts";
import {
  ERR_PIPELINE_INVALID_TRANSITION,
  ERR_PIPELINE_MISSING_MANDATORY_NOTES,
  ERR_PIPELINE_PREMATURE_CLOSE,
  ERR_PIPELINE_REJECTION_LIMIT_EXCEEDED,
  ERR_PIPELINE_ROLE_MUTATION_RESTRICTED,
  ERR_PIPELINE_STAGE_ROLE_MISMATCH,
} from "../types.ts";

Deno.test("Task Pipeline - Task Creation with pipelineTemplateId and initial role", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);
  try {
    const userId = `tenant_${crypto.randomUUID().slice(0, 8)}`;

    const task = await createTask({
      title: "Implement Game Feature",
      pipelineTemplateId: "unity-dev-playtest-qa",
    }, userId);

    assert(task.pipeline !== undefined);
    assertEquals(task.pipeline.templateId, "unity-dev-playtest-qa");
    assertEquals(task.pipeline.currentStageIndex, 0);
    assertEquals(task.pipeline.currentStageId, "dev");
    assertEquals(task.role, "developer");
    assertEquals(task.pipeline.stages[0].status, "active");
  } finally {
    await kv.close();
  }
});

Deno.test("Task Pipeline - Claim Role Guard (ERR_PIPELINE_STAGE_ROLE_MISMATCH)", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);
  try {
    const userId = `tenant_${crypto.randomUUID().slice(0, 8)}`;

    const task = await createTask({
      title: "Code Review Task",
      pipelineTemplateId: "code-review-audit",
    }, userId);

    // Active stage 0 is "dev" requiring role "developer"
    // Trying to claim with mismatched role "qa" should reject with ERR_PIPELINE_STAGE_ROLE_MISMATCH
    await assertRejects(
      () => claimTask(task.id, "qa-agent", userId, "qa"),
      Error,
      ERR_PIPELINE_STAGE_ROLE_MISMATCH,
    );

    // Claiming with matching role "developer" succeeds
    const claimed = await claimTask(task.id, "dev-agent", userId, "developer");
    assertEquals(claimed.status, "claimed");
    assertEquals(claimed.assignee, "dev-agent");
    assertEquals(claimed.pipeline?.stages[0].assignee, "dev-agent");
  } finally {
    await kv.close();
  }
});

Deno.test("Task Pipeline - Premature Close Guard (ERR_PIPELINE_PREMATURE_CLOSE)", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);
  try {
    const userId = `tenant_${crypto.randomUUID().slice(0, 8)}`;

    const task = await createTask({
      title: "Hotfix Production Issue",
      pipelineTemplateId: "hotfix-fast-track",
    }, userId);

    // Stage 0 / 2: Non-terminal stage close should fail with ERR_PIPELINE_PREMATURE_CLOSE
    await assertRejects(
      () => closeTask(task.id, "Completed early", userId),
      Error,
      ERR_PIPELINE_PREMATURE_CLOSE,
    );
  } finally {
    await kv.close();
  }
});

Deno.test("Task Pipeline - Direct Role Mutation Guard (ERR_PIPELINE_ROLE_MUTATION_RESTRICTED)", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);
  try {
    const userId = `tenant_${crypto.randomUUID().slice(0, 8)}`;

    const task = await createTask({
      title: "Research Specification",
      pipelineTemplateId: "research-spec-impl",
    }, userId);

    // Attempting to directly mutate role without pipeline handoff or manager override must fail
    await assertRejects(
      () => updateTask(task.id, { role: "architect" }, userId),
      Error,
      ERR_PIPELINE_ROLE_MUTATION_RESTRICTED,
    );
  } finally {
    await kv.close();
  }
});

Deno.test("Task Pipeline - Multi-Stage Lifecycle: Advance, Acceptance Notes, and Terminal Close", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);
  try {
    const userId = `tenant_${crypto.randomUUID().slice(0, 8)}`;

    // 1. Create task with code-review-audit pipeline
    const task = await createTask({
      title: "Implement Secure Token Storage",
      pipelineTemplateId: "code-review-audit",
    }, userId);

    assertEquals(task.role, "developer");
    assertEquals(task.pipeline?.currentStageIndex, 0);

    // 2. Developer claims and advances to stage 1 (review)
    await claimTask(task.id, "alice-dev", userId, "developer");

    const handoff1 = await handoffTask({
      taskId: task.id,
      action: "advance",
      fromAssignee: "alice-dev",
      toAssignee: "bob-reviewer",
      reason: "PR opened with 100% test coverage",
      contextSummary: "Implemented cryptographic token storage in keychain.",
      acceptanceNotes: ["All unit tests pass", "CI pipeline green"],
    }, userId);

    assertEquals(handoff1.task.role, "reviewer");
    assertEquals(handoff1.task.pipeline?.currentStageIndex, 1);
    assertEquals(handoff1.task.pipeline?.currentStageId, "review");
    assertEquals(handoff1.task.pipeline?.stages[0].status, "completed");
    assertEquals(handoff1.task.pipeline?.stages[1].status, "active");
    assertEquals(handoff1.task.acceptanceNotes?.length, 2);
    assertEquals(handoff1.auditRecord?.action, "advance");

    // 3. Reviewer advances to stage 2 (audit)
    const handoff2 = await handoffTask({
      taskId: task.id,
      action: "advance",
      fromAssignee: "bob-reviewer",
      toAssignee: "carol-auditor",
      reason: "Code review approved without blocking comments",
      acceptanceNotes: ["Code review approved by lead"],
    }, userId);

    assertEquals(handoff2.task.role, "security-auditor");
    assertEquals(handoff2.task.pipeline?.currentStageIndex, 2);
    assertEquals(handoff2.task.pipeline?.stages[1].status, "completed");
    assertEquals(handoff2.task.pipeline?.stages[2].status, "active");

    // 4. Auditor closes terminal task
    const { task: closedTask } = await closeTask(
      task.id,
      "Security audit sign-off complete. No CVEs found.",
      userId,
    );

    assertEquals(closedTask.status, "closed");
    assertEquals(closedTask.pipeline?.stages[2].status, "completed");
    assert(closedTask.acceptanceNotes?.includes("Security audit sign-off complete. No CVEs found."));
  } finally {
    await kv.close();
  }
});

Deno.test("Task Pipeline - Rejection Loopback, Validation Rules, and Circuit Breaker", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);
  try {
    const userId = `tenant_${crypto.randomUUID().slice(0, 8)}`;

    const task = await createTask({
      title: "Feature with QA verification",
      pipelineTemplateId: "unity-dev-playtest-qa",
    }, userId);

    // Stage 0: Dev -> Advance to Playtest
    await claimTask(task.id, "dev1", userId, "developer");
    await handoffTask({
      taskId: task.id,
      action: "advance",
      reason: "First build ready for playtest",
    }, userId);

    // Stage 1 (playtest) requires rejected approaches when rejecting
    await assertRejects(
      () =>
        handoffTask({
          taskId: task.id,
          action: "reject",
          reason: "Physics jitter in jumping",
          // missing rejectedApproaches
        }, userId),
      Error,
      ERR_PIPELINE_MISSING_MANDATORY_NOTES,
    );

    // Successful Rejection 1 (loops back to stage 0: dev)
    const rej1 = await handoffTask({
      taskId: task.id,
      action: "reject",
      reason: "Physics jitter in jumping",
      rejectedApproaches: ["Increased fixed timestep directly"],
      rejectionReasons: ["Jumping clip causes stutter"],
    }, userId);

    assertEquals(rej1.task.role, "developer");
    assertEquals(rej1.task.pipeline?.currentStageIndex, 0);
    assertEquals(rej1.task.pipeline?.rejectionCount, 1);
    assertEquals(rej1.task.pipeline?.stages[0].status, "active");
    assertEquals(rej1.task.pipeline?.stages[1].status, "rejected");

    // Advance again (dev -> playtest)
    await handoffTask({
      taskId: task.id,
      action: "advance",
      reason: "Fixed jump physics with interpolation",
    }, userId);

    // Rejection 2
    await handoffTask({
      taskId: task.id,
      action: "reject",
      reason: "Hitbox offset on crouch",
      rejectedApproaches: ["Scaled collider directly"],
    }, userId);

    // Advance again (dev -> playtest)
    await handoffTask({
      taskId: task.id,
      action: "advance",
      reason: "Fixed collider hierarchy",
    }, userId);

    // Rejection 3
    await handoffTask({
      taskId: task.id,
      action: "reject",
      reason: "Sound effect delay on landing",
      rejectedApproaches: ["Instant sound trigger on animation frame"],
    }, userId);

    // Advance again (dev -> playtest)
    await handoffTask({
      taskId: task.id,
      action: "advance",
      reason: "Fixed landing audio latency",
    }, userId);

    // Rejection 4: Exceeds defaultMaxRejections (3) -> Circuit breaker trips with ERR_PIPELINE_REJECTION_LIMIT_EXCEEDED
    await assertRejects(
      () =>
        handoffTask({
          taskId: task.id,
          action: "reject",
          reason: "Another issue found",
          rejectedApproaches: ["Tried approach X"],
        }, userId),
      Error,
      ERR_PIPELINE_REJECTION_LIMIT_EXCEEDED,
    );
  } finally {
    await kv.close();
  }
});

Deno.test("Task Pipeline - Invalid Transition Guard (ERR_PIPELINE_INVALID_TRANSITION)", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);
  try {
    const userId = `tenant_${crypto.randomUUID().slice(0, 8)}`;

    const task = await createTask({
      title: "Feature with specific transitions",
      pipelineTemplateId: "unity-dev-playtest-qa",
    }, userId);

    // Stage 0 (dev) cannot jump directly to "qa" (allowed advance target is only "playtest")
    await assertRejects(
      () =>
        handoffTask({
          taskId: task.id,
          action: "advance",
          targetStageId: "qa",
          reason: "Skipping playtest directly to QA",
        }, userId),
      Error,
      ERR_PIPELINE_INVALID_TRANSITION,
    );
  } finally {
    await kv.close();
  }
});

Deno.test("Task Pipeline - Manager Interventions (attachPipelineToTask and overrideTaskPipeline)", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);
  try {
    const userId = `tenant_${crypto.randomUUID().slice(0, 8)}`;

    // 1. Create an unpipelined task
    const unpipelined = await createTask({
      title: "Ad-hoc bug fix",
    }, userId);
    assertEquals(unpipelined.pipeline, undefined);

    // 2. Manager attaches hotfix pipeline
    const attached = await attachPipelineToTask(
      unpipelined.id,
      "hotfix-fast-track",
      userId,
      "Escalated to critical production hotfix pipeline",
    );
    assert(attached.pipeline !== undefined);
    assertEquals(attached.pipeline.templateId, "hotfix-fast-track");
    assertEquals(attached.role, "developer");
    assert(attached.pipeline.history && attached.pipeline.history.length > 0);

    // 3. Manager overrides pipeline: jump to stage 1 and reset rejection count
    const overridden = await overrideTaskPipeline(
      attached.id,
      {
        targetStageIndex: 1,
        skipCurrentStage: true,
        resetRejectionCount: true,
        justification: "Manager approved fast-track staging deployment directly",
        managerId: "mgr-lead",
      },
      userId,
    );

    assertEquals(overridden.pipeline?.currentStageIndex, 1);
    assertEquals(overridden.role, "release-lead");
    assertEquals(overridden.pipeline?.stages[0].status, "skipped");
    assertEquals(overridden.pipeline?.stages[1].status, "active");
    assertEquals(overridden.pipeline?.rejectionCount, 0);
  } finally {
    await kv.close();
  }
});

Deno.test("Task Pipeline - 100% Backward Compatibility for Unpipelined Tasks", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);
  try {
    const userId = `tenant_${crypto.randomUUID().slice(0, 8)}`;

    // Create unpipelined task
    const task = await createTask({
      title: "Standard Independent Work Item",
      role: "general",
    }, userId);

    // Claim without role guard restrictions
    const claimed = await claimTask(task.id, "worker-1", userId);
    assertEquals(claimed.status, "claimed");

    // Update role directly without restriction
    const updated = await updateTask(task.id, { role: "frontend" }, userId);
    assertEquals(updated.role, "frontend");

    // Standard handoff
    const handoff = await handoffTask({
      taskId: task.id,
      fromAssignee: "worker-1",
      toAssignee: "worker-2",
      reason: "Shift handoff",
      contextSummary: "Finished initial prototype",
    }, userId);
    assertEquals(handoff.task.assignee, "worker-2");
    assertEquals(handoff.handoffRecord.reason, "Shift handoff");

    // Close task immediately without premature close error
    const { task: closed } = await closeTask(task.id, "Work completed", userId);
    assertEquals(closed.status, "closed");
  } finally {
    await kv.close();
  }
});
