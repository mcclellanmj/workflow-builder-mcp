import { assert, assertEquals } from "@std/assert";
import { getTask, setKv } from "../../store/kv.ts";
import { addNodeTool } from "./add_node.ts";
import { connectNodesTool } from "./connect_nodes.ts";
import { createWorkflowTool } from "./create_workflow.ts";
import { workflowHydrateTool } from "./hydrate_workflow.ts";
import { readyTasksTool } from "./task_ready.ts";
import { claimTaskTool } from "./task_claim.ts";
import { closeTaskTool } from "./task_close.ts";

const parseJson = (
  res: { content: Array<{ type: string; text: string; annotations?: { audience?: string[] } }> },
) => {
  const item = res.content.find((c) => c.annotations?.audience?.includes("assistant")) ??
    res.content[res.content.length - 1];
  return JSON.parse(item.text);
};

Deno.test("Workflow Hydration - Linear Workflow into Epic and Task DAG", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    // 1. Create linear workflow: Start -> Lint -> Build -> Deploy -> End
    const wfRes = await createWorkflowTool.execute({
      name: "Release Pipeline",
      description: "Build and deploy application",
    });
    const { workflow, startNode } = parseJson(wfRes);
    const workflowId = workflow.id;

    const lintNode = parseJson(
      await addNodeTool.execute({
        workflowId,
        type: "step",
        name: "Lint Code",
        description: "Run linter and typecheck",
      }),
    );

    const buildNode = parseJson(
      await addNodeTool.execute({
        workflowId,
        type: "step",
        name: "Build App",
        description: "Compile and bundle assets",
      }),
    );

    const deployNode = parseJson(
      await addNodeTool.execute({
        workflowId,
        type: "step",
        name: "Deploy Production",
        description: "Deploy artifacts to prod",
      }),
    );

    const endNode = parseJson(
      await addNodeTool.execute({
        workflowId,
        type: "end",
        name: "Done",
        description: "Pipeline completed",
      }),
    );

    await connectNodesTool.execute({ workflowId, fromNodeId: startNode.id, toNodeId: lintNode.id });
    await connectNodesTool.execute({ workflowId, fromNodeId: lintNode.id, toNodeId: buildNode.id });
    await connectNodesTool.execute({
      workflowId,
      fromNodeId: buildNode.id,
      toNodeId: deployNode.id,
    });
    await connectNodesTool.execute({ workflowId, fromNodeId: deployNode.id, toNodeId: endNode.id });

    // 2. Hydrate workflow into Epic and Task DAG
    const hydrateRes = await workflowHydrateTool.execute({ workflow: "release-pipeline" });
    assert(!hydrateRes.isError);
    const hydrateData = parseJson(hydrateRes);

    assertEquals(hydrateData.epic.title, "Release Pipeline");
    assertEquals(hydrateData.epic.type, "epic");
    assertEquals(hydrateData.summary.totalEpics, 1);
    assertEquals(hydrateData.summary.totalTasks, 3);
    assertEquals(hydrateData.summary.totalDependencies, 2);
    assertEquals(hydrateData.readyTasks.length, 1);
    assertEquals(hydrateData.readyTasks[0].title, "Lint Code");

    const rootEpicId = hydrateData.epic.id;
    const lintTaskId = hydrateData.readyTasks[0].id;
    const buildTask = hydrateData.tasks.find((t: { title: string }) => t.title === "Build App");
    const deployTask = hydrateData.tasks.find((t: { title: string }) =>
      t.title === "Deploy Production"
    );
    assert(buildTask);
    assert(deployTask);

    // Verify all tasks have parentTaskId set to rootEpicId
    assertEquals(hydrateData.readyTasks[0].parentTaskId, rootEpicId);
    assertEquals(buildTask.parentTaskId, rootEpicId);
    assertEquals(deployTask.parentTaskId, rootEpicId);

    // 3. Ready Frontier: Only Lint is ready
    const ready1Res = await readyTasksTool.execute({ workflowId });
    const ready1Data = parseJson(ready1Res);
    assertEquals(ready1Data.frontierSize, 1);
    assertEquals(ready1Data.readyTasks[0].id, lintTaskId);

    // 4. Claim and Close Lint -> Unblocks Build
    const claimRes = await claimTaskTool.execute({ task: lintTaskId, assignee: "agent-ci" });
    assert(!claimRes.isError);

    const closeLintRes = await closeTaskTool.execute({ task: lintTaskId, reason: "Lint passed" });
    assert(!closeLintRes.isError);
    const closeLintData = parseJson(closeLintRes);
    assertEquals(closeLintData.unblockedTasks.length, 1);
    assertEquals(closeLintData.unblockedTasks[0].id, buildTask.id);

    // Verify Build is now ready
    const ready2Data = parseJson(await readyTasksTool.execute({ workflowId }));
    assertEquals(ready2Data.frontierSize, 1);
    assertEquals(ready2Data.readyTasks[0].id, buildTask.id);

    // 5. Close Build -> Unblocks Deploy
    const closeBuildRes = await closeTaskTool.execute({
      task: buildTask.id,
      reason: "Build complete",
    });
    assert(!closeBuildRes.isError);
    const closeBuildData = parseJson(closeBuildRes);
    assertEquals(closeBuildData.unblockedTasks.length, 1);
    assertEquals(closeBuildData.unblockedTasks[0].id, deployTask.id);

    // 6. Close Deploy -> All child tasks closed -> Root Epic automatically closes!
    const closeDeployRes = await closeTaskTool.execute({
      task: deployTask.id,
      reason: "Deploy succeeded",
    });
    assert(!closeDeployRes.isError);

    const rootEpic = await getTask(rootEpicId);
    assert(rootEpic);
    assertEquals(rootEpic.status, "closed");
    assert(rootEpic.closedReason?.includes("All child tasks completed"));
  } finally {
    kv.close();
  }
});

Deno.test("Workflow Hydration - Nested Subworkflows ('An Epic in an Epic')", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    // 1. Create Child Workflow: Data Pipeline
    const childWfRes = await createWorkflowTool.execute({
      name: "ETL Processing",
      description: "Extract, transform and validate",
      intendedForIndependentRun: false,
    });
    const { workflow: childWf, startNode: childStart } = parseJson(childWfRes);

    const extractNode = parseJson(
      await addNodeTool.execute({
        workflowId: childWf.id,
        type: "step",
        name: "Extract Records",
        description: "Pull raw records from S3",
      }),
    );

    const transformNode = parseJson(
      await addNodeTool.execute({
        workflowId: childWf.id,
        type: "step",
        name: "Transform Records",
        description: "Normalize records",
      }),
    );

    const childEnd = parseJson(
      await addNodeTool.execute({
        workflowId: childWf.id,
        type: "end",
        name: "Child End",
        description: "ETL complete",
      }),
    );

    await connectNodesTool.execute({
      workflowId: childWf.id,
      fromNodeId: childStart.id,
      toNodeId: extractNode.id,
    });
    await connectNodesTool.execute({
      workflowId: childWf.id,
      fromNodeId: extractNode.id,
      toNodeId: transformNode.id,
    });
    await connectNodesTool.execute({
      workflowId: childWf.id,
      fromNodeId: transformNode.id,
      toNodeId: childEnd.id,
    });

    // 2. Create Parent Workflow: Master Orchestrator
    const parentWfRes = await createWorkflowTool.execute({
      name: "Master Orchestrator",
      description: "Main data workflow",
    });
    const { workflow: parentWf, startNode: parentStart } = parseJson(parentWfRes);

    const initNode = parseJson(
      await addNodeTool.execute({
        workflowId: parentWf.id,
        type: "step",
        name: "Init Run",
        description: "Prepare credentials and clusters",
      }),
    );

    const subwfNode = parseJson(
      await addNodeTool.execute({
        workflowId: parentWf.id,
        type: "subworkflow",
        name: "Run ETL Subworkflow",
        description: "Execute child data pipeline",
        config: { childWorkflowId: childWf.id },
      }),
    );

    const publishNode = parseJson(
      await addNodeTool.execute({
        workflowId: parentWf.id,
        type: "step",
        name: "Publish Summary",
        description: "Post metrics to dashboard",
      }),
    );

    const parentEnd = parseJson(
      await addNodeTool.execute({
        workflowId: parentWf.id,
        type: "end",
        name: "Parent End",
        description: "Orchestration complete",
      }),
    );

    await connectNodesTool.execute({
      workflowId: parentWf.id,
      fromNodeId: parentStart.id,
      toNodeId: initNode.id,
    });
    await connectNodesTool.execute({
      workflowId: parentWf.id,
      fromNodeId: initNode.id,
      toNodeId: subwfNode.id,
    });
    await connectNodesTool.execute({
      workflowId: parentWf.id,
      fromNodeId: subwfNode.id,
      toNodeId: publishNode.id,
    });
    await connectNodesTool.execute({
      workflowId: parentWf.id,
      fromNodeId: publishNode.id,
      toNodeId: parentEnd.id,
    });

    // 3. Hydrate Parent Workflow
    const hydrateRes = await workflowHydrateTool.execute({ workflow: parentWf.id });
    assert(!hydrateRes.isError);
    const data = parseJson(hydrateRes);

    // Verify Epics: Root Epic + Child Epic ("epic in an epic")
    assertEquals(data.summary.totalEpics, 2);
    assertEquals(data.epics.length, 2);
    const rootEpic = data.epic;
    const childEpic = data.epics.find((e: { id: string }) => e.id !== rootEpic.id);
    assert(childEpic);
    assertEquals(childEpic.type, "epic");
    assertEquals(childEpic.parentTaskId, rootEpic.id);
    assertEquals(childEpic.title, "Run ETL Subworkflow");

    // Verify Tasks: Init Run, Extract Records, Transform Records, Publish Summary
    assertEquals(data.summary.totalTasks, 4);
    const initTask = data.tasks.find((t: { title: string }) => t.title === "Init Run");
    const extractTask = data.tasks.find((t: { title: string }) => t.title === "Extract Records");
    const transformTask = data.tasks.find((t: { title: string }) =>
      t.title === "Transform Records"
    );
    const publishTask = data.tasks.find((t: { title: string }) => t.title === "Publish Summary");
    assert(initTask && extractTask && transformTask && publishTask);

    // Child task parentage
    assertEquals(initTask.parentTaskId, rootEpic.id);
    assertEquals(extractTask.parentTaskId, childEpic.id);
    assertEquals(transformTask.parentTaskId, childEpic.id);
    assertEquals(publishTask.parentTaskId, rootEpic.id);

    // 4. Initial Ready Frontier: Only Init Run
    assertEquals(data.readyTasks.length, 1);
    assertEquals(data.readyTasks[0].id, initTask.id);

    // 5. Complete Init Run -> Unblocks Extract Records
    const closeInit = parseJson(await closeTaskTool.execute({ task: initTask.id }));
    assert(closeInit.unblockedTasks.some((t: { id: string }) => t.id === extractTask.id));

    // Ready frontier now contains Extract Records
    const ready2 = parseJson(await readyTasksTool.execute({ workflowId: parentWf.id }));
    assertEquals(ready2.frontierSize, 1);
    assertEquals(ready2.readyTasks[0].id, extractTask.id);

    // 6. Complete Extract Records -> Unblocks Transform Records
    const closeExtract = parseJson(await closeTaskTool.execute({ task: extractTask.id }));
    assert(closeExtract.unblockedTasks.some((t: { id: string }) => t.id === transformTask.id));

    // 7. Complete Transform Records -> All children of Child Epic closed -> Child Epic closes -> Unblocks Publish Summary!
    const closeTransform = parseJson(await closeTaskTool.execute({ task: transformTask.id }));
    assert(closeTransform.unblockedTasks.some((t: { id: string }) => t.id === publishTask.id));

    const checkedChildEpic = await getTask(childEpic.id);
    assert(checkedChildEpic);
    assertEquals(checkedChildEpic.status, "closed");

    // 8. Complete Publish Summary -> Root Epic auto-closes!
    await closeTaskTool.execute({ task: publishTask.id });
    const checkedRootEpic = await getTask(rootEpic.id);
    assert(checkedRootEpic);
    assertEquals(checkedRootEpic.status, "closed");
  } finally {
    kv.close();
  }
});

Deno.test("Workflow Hydration - Decision, User Interaction & Gated Loop Handling", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    const wfRes = await createWorkflowTool.execute({
      name: "Interactive Loop Flow",
      description: "Decision and feedback loop",
    });
    const { workflow, startNode } = parseJson(wfRes);

    const reviewNode = parseJson(
      await addNodeTool.execute({
        workflowId: workflow.id,
        type: "step",
        name: "Review Code",
        description: "Analyze code changes",
      }),
    );

    const decNode = parseJson(
      await addNodeTool.execute({
        workflowId: workflow.id,
        type: "decision",
        name: "Pass Quality Gate",
        description: "Evaluate test coverage",
        config: { options: ["approved", "needs_fixes"] },
      }),
    );

    const userNode = parseJson(
      await addNodeTool.execute({
        workflowId: workflow.id,
        type: "user_interaction",
        name: "Request Human Feedback",
        description: "Ask user for confirmation",
        config: { prompt: "Do you approve deploying to prod?", contextHint: "Verify changelog" },
      }),
    );

    const endNode = parseJson(
      await addNodeTool.execute({
        workflowId: workflow.id,
        type: "end",
        name: "Finished",
        description: "End",
      }),
    );

    await connectNodesTool.execute({
      workflowId: workflow.id,
      fromNodeId: startNode.id,
      toNodeId: reviewNode.id,
    });
    await connectNodesTool.execute({
      workflowId: workflow.id,
      fromNodeId: reviewNode.id,
      toNodeId: decNode.id,
    });
    await connectNodesTool.execute({
      workflowId: workflow.id,
      fromNodeId: decNode.id,
      toNodeId: userNode.id,
      condition: "needs_fixes",
    });
    // Back-edge from userNode -> reviewNode
    await connectNodesTool.execute({
      workflowId: workflow.id,
      fromNodeId: userNode.id,
      toNodeId: reviewNode.id,
    });
    await connectNodesTool.execute({
      workflowId: workflow.id,
      fromNodeId: decNode.id,
      toNodeId: endNode.id,
      condition: "approved",
    });

    // Hydrate
    const hydRes = await workflowHydrateTool.execute({ workflow: workflow.id });
    assert(!hydRes.isError);
    const data = parseJson(hydRes);

    // Verify Review Code task is open and ready immediately (back-edge didn't deadlock)
    assertEquals(data.readyTasks.length, 1);
    assertEquals(data.readyTasks[0].title, "Review Code");

    // Verify Decision task description contains options
    const decTask = data.tasks.find((t: { title: string }) => t.title === "Pass Quality Gate");
    assert(decTask);
    assert(decTask.description.includes("Decision Options"));
    assert(decTask.description.includes("approved, needs_fixes"));

    // Verify User Interaction task description contains prompt & hint
    const userTask = data.tasks.find((t: { title: string }) =>
      t.title === "Request Human Feedback"
    );
    assert(userTask);
    assert(userTask.description.includes("Do you approve deploying to prod?"));
    assert(userTask.description.includes("Verify changelog"));
  } finally {
    kv.close();
  }
});
