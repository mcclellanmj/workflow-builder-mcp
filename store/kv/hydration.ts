/**
 * Hydration engine: transforms workflow templates into executable Epics, Tasks, and Dependencies.
 */

import { resolveUserId } from "./client.ts";
import {
  addDependencies,
  computeReadyFrontier,
  type CreateTaskInput,
  createTasks,
  generateTaskId,
} from "./tasks.ts";
import { listNodes } from "./nodes.ts";
import { listEdges } from "./edges.ts";
import { resolveWorkflow } from "../../mcp/resolvers.ts";
import { validateGraph } from "../../validation/graph.ts";
import type {
  DependencyType,
  NodeType,
  Task,
  TaskDependency,
  TaskId,
  TaskPriority,
  WorkflowEdge,
  WorkflowNode,
} from "../types.ts";

export interface HydrateWorkflowInput {
  workflow: string;
  title?: string;
  description?: string;
  parentTaskId?: string;
  role?: string;
  priority?: TaskPriority;
  userId?: string;
}

export interface HydratedNodeMapping {
  nodeId: string;
  nodeType: NodeType;
  taskId?: string;
  epicId?: string;
  entryTaskIds: string[];
  exitTaskIds: string[];
}

export interface HydrateWorkflowResult {
  epic: Task;
  epics: Task[];
  tasks: Task[];
  dependencies: TaskDependency[];
  readyTasks: Task[];
  summary: {
    totalEpics: number;
    totalTasks: number;
    totalDependencies: number;
    readyTasksCount: number;
  };
  instructions: string;
  suggestedNextTools: Array<{
    tool: string;
    description: string;
    arguments: Record<string, unknown>;
  }>;
}

/**
 * Detects back-edges (feedback loops) in a directed graph starting from startNode.
 * Back-edges represent cycles (e.g. review-fix loops) and must not be hard-blocking
 * dependencies at hydration time to avoid circular deadlocks.
 */
function findBackEdges(
  startNodeId: string,
  edges: WorkflowEdge[],
): Set<string> {
  const backEdges = new Set<string>();
  const adj = new Map<string, Array<{ toNodeId: string; edgeId: string }>>();
  for (const e of edges) {
    if (!adj.has(e.fromNodeId)) adj.set(e.fromNodeId, []);
    adj.get(e.fromNodeId)!.push({ toNodeId: e.toNodeId, edgeId: e.id });
  }

  const visited = new Set<string>();
  const inStack = new Set<string>();

  function dfs(curr: string): void {
    visited.add(curr);
    inStack.add(curr);

    const neighbors = adj.get(curr) || [];
    for (const { toNodeId, edgeId } of neighbors) {
      if (inStack.has(toNodeId)) {
        backEdges.add(edgeId);
      } else if (!visited.has(toNodeId)) {
        dfs(toNodeId);
      }
    }

    inStack.delete(curr);
  }

  dfs(startNodeId);
  return backEdges;
}

/**
 * Formats task description incorporating node configuration (prompts, decision options).
 */
function buildNodeTaskDescription(node: WorkflowNode): string {
  let desc = node.description || "";
  if (node.type === "decision") {
    const opts = Array.isArray(node.config?.options)
      ? (node.config.options as string[]).join(", ")
      : "";
    if (opts) {
      desc = desc ? `${desc}\n\n**Decision Options**: ${opts}` : `**Decision Options**: ${opts}`;
    }
  } else if (node.type === "user_interaction") {
    const prompt = typeof node.config?.prompt === "string" ? node.config.prompt : "";
    const hint = typeof node.config?.contextHint === "string" ? node.config.contextHint : "";
    if (prompt) {
      desc = desc ? `${desc}\n\n**User Prompt**: ${prompt}` : `**User Prompt**: ${prompt}`;
    }
    if (hint) {
      desc += `\n**Context Hint**: ${hint}`;
    }
  }
  return desc;
}

/**
 * Recursive helper to plan subworkflow hydration into child epics and tasks.
 */
async function planSubworkflow(
  subwfNode: WorkflowNode,
  parentEpicId: TaskId,
  rootWorkflowId: string,
  uid: string,
  taskAccumulator: CreateTaskInput[],
  depAccumulator: Array<{ fromTaskId: TaskId; toTaskId: TaskId; type?: DependencyType }>,
  defaultRole?: string,
  defaultPriority?: TaskPriority,
): Promise<{
  childEpicId: string;
  epicIds: string[];
  taskIds: string[];
  entryTaskIds: string[];
  exitTaskIds: string[];
}> {
  const childWfId = String(subwfNode.config?.childWorkflowId || "").trim();
  if (!childWfId) {
    throw new Error(
      `Subworkflow node "${subwfNode.name}" (${subwfNode.id}) is missing childWorkflowId in config.`,
    );
  }

  const childWf = await resolveWorkflow(childWfId, uid);
  if (!childWf) {
    throw new Error(
      `Referenced child workflow "${childWfId}" for node "${subwfNode.name}" was not found.`,
    );
  }

  const [nodes, edges] = await Promise.all([
    listNodes(childWf.id, { userId: uid }),
    listEdges(childWf.id, { userId: uid }),
  ]);

  const validation = validateGraph(nodes, edges);
  if (!validation.valid) {
    throw new Error(
      `Child workflow "${childWf.name}" validation failed: ${validation.errors.join("; ")}`,
    );
  }

  const startNode = nodes.find((n: WorkflowNode) => n.type === "start");
  const endNodes = nodes.filter((n: WorkflowNode) => n.type === "end");
  const endNodeIds = new Set(endNodes.map((n: WorkflowNode) => n.id));
  const backEdges = startNode ? findBackEdges(startNode.id, edges) : new Set<string>();

  const childEpicId = generateTaskId(subwfNode.name || childWf.name);
  taskAccumulator.push({
    id: childEpicId,
    title: subwfNode.name || childWf.name,
    description: subwfNode.description || childWf.description ||
      `Subworkflow epic for "${childWf.name}"`,
    type: "epic",
    status: "open",
    parentTaskId: parentEpicId,
    workflowId: rootWorkflowId,
    nodeId: subwfNode.id,
    priority: defaultPriority ?? "medium",
    role: (subwfNode.config?.role as string) ?? defaultRole,
  });

  const epicIds: string[] = [childEpicId];
  const taskIds: string[] = [];
  const nodeMap = new Map<string, HydratedNodeMapping>();

  for (const node of nodes) {
    if (node.type === "start" || node.type === "end") {
      nodeMap.set(node.id, {
        nodeId: node.id,
        nodeType: node.type,
        entryTaskIds: [],
        exitTaskIds: [],
      });
      continue;
    }

    if (node.type === "subworkflow") {
      const nested = await planSubworkflow(
        node,
        childEpicId,
        rootWorkflowId,
        uid,
        taskAccumulator,
        depAccumulator,
        defaultRole,
        defaultPriority,
      );
      epicIds.push(...nested.epicIds);
      taskIds.push(...nested.taskIds);

      nodeMap.set(node.id, {
        nodeId: node.id,
        nodeType: "subworkflow",
        epicId: nested.childEpicId,
        entryTaskIds: nested.entryTaskIds,
        exitTaskIds: nested.exitTaskIds,
      });
    } else {
      const taskRole = (node.config?.role as string) ||
        (node.runInSubAgent ? "subagent" : defaultRole);
      const taskPriority = (node.config?.priority as TaskPriority) || defaultPriority || "medium";
      const taskId = generateTaskId(node.name);

      taskAccumulator.push({
        id: taskId,
        title: node.name,
        description: buildNodeTaskDescription(node),
        type: "task",
        status: "open",
        parentTaskId: childEpicId,
        workflowId: rootWorkflowId,
        nodeId: node.id,
        role: taskRole,
        priority: taskPriority,
      });

      taskIds.push(taskId);
      nodeMap.set(node.id, {
        nodeId: node.id,
        nodeType: node.type,
        taskId,
        entryTaskIds: [taskId],
        exitTaskIds: [taskId],
      });
    }
  }

  // Wire internal dependencies in child workflow
  for (const edge of edges) {
    if (edge.fromNodeId === startNode?.id || endNodeIds.has(edge.toNodeId)) {
      continue;
    }

    const fromMapping = nodeMap.get(edge.fromNodeId);
    const toMapping = nodeMap.get(edge.toNodeId);
    if (!fromMapping || !toMapping) continue;

    const isBackEdge = backEdges.has(edge.id);
    const depType: DependencyType = isBackEdge ? "conditional-blocks" : "blocks";

    for (const fromId of fromMapping.exitTaskIds) {
      for (const toId of toMapping.entryTaskIds) {
        if (fromId !== toId) {
          depAccumulator.push({ fromTaskId: fromId, toTaskId: toId, type: depType });
        }
      }
    }
  }

  // Identify entry task IDs (connected from startNode)
  const entryTaskIds: string[] = [];
  if (startNode) {
    const startEdges = edges.filter((e: WorkflowEdge) => e.fromNodeId === startNode.id);
    for (const e of startEdges) {
      const mapping = nodeMap.get(e.toNodeId);
      if (mapping) {
        entryTaskIds.push(...mapping.entryTaskIds);
      }
    }
  }

  // Identify exit task IDs (connected to end nodes or with out-degree 0)
  const exitTaskIds: string[] = [];
  const edgesToEnd = edges.filter((e: WorkflowEdge) => endNodeIds.has(e.toNodeId));
  for (const e of edgesToEnd) {
    const mapping = nodeMap.get(e.fromNodeId);
    if (mapping) {
      exitTaskIds.push(...mapping.exitTaskIds);
    }
  }

  // Fallback for entry/exit if not directly connected to start/end
  if (entryTaskIds.length === 0 && taskIds.length > 0) {
    entryTaskIds.push(taskIds[0]);
  }
  if (exitTaskIds.length === 0 && taskIds.length > 0) {
    exitTaskIds.push(taskIds[taskIds.length - 1]);
  }

  return {
    childEpicId,
    epicIds,
    taskIds,
    entryTaskIds,
    exitTaskIds,
  };
}

/**
 * Hydrates a workflow DAG into an Epic containing actionable tasks and dependencies.
 * Nested subworkflows hydrate into nested Epics ("an epic in an epic").
 * Retires traversal and stepping; returns the epic and immediate ready frontier for agent work.
 */
export async function hydrateWorkflowToEpic(
  input: HydrateWorkflowInput,
): Promise<HydrateWorkflowResult> {
  const uid = resolveUserId(input.userId);

  const wf = await resolveWorkflow(input.workflow, uid);
  if (!wf) {
    throw new Error(
      `Workflow "${input.workflow}" not found. You can specify a workflow UUID, exact name, or slug.`,
    );
  }

  const [nodes, edges] = await Promise.all([
    listNodes(wf.id, { userId: uid }),
    listEdges(wf.id, { userId: uid }),
  ]);

  const validation = validateGraph(nodes, edges);
  if (!validation.valid) {
    throw new Error(
      `Workflow "${wf.name}" validation failed: ${validation.errors.join("; ")}`,
    );
  }

  const startNode = nodes.find((n: WorkflowNode) => n.type === "start");
  const endNodes = nodes.filter((n: WorkflowNode) => n.type === "end");
  const endNodeIds = new Set(endNodes.map((n: WorkflowNode) => n.id));
  const backEdges = startNode ? findBackEdges(startNode.id, edges) : new Set<string>();

  const allTaskInputs: CreateTaskInput[] = [];
  const allDepInputs: Array<{ fromTaskId: TaskId; toTaskId: TaskId; type?: DependencyType }> = [];

  // 1. Plan root Epic task
  const rootEpicId = generateTaskId(input.title?.trim() || wf.name);
  allTaskInputs.push({
    id: rootEpicId,
    title: input.title?.trim() || wf.name,
    description: input.description?.trim() || wf.description ||
      `Epic hydrated from workflow "${wf.name}"`,
    type: "epic",
    status: "open",
    parentTaskId: input.parentTaskId,
    workflowId: wf.id,
    priority: input.priority ?? "medium",
    role: input.role,
  });

  const epicIds: string[] = [rootEpicId];
  const taskIds: string[] = [];
  const nodeMap = new Map<string, HydratedNodeMapping>();

  // 2. Hydrate actionable nodes into tasks or nested epics
  for (const node of nodes) {
    if (node.type === "start" || node.type === "end") {
      nodeMap.set(node.id, {
        nodeId: node.id,
        nodeType: node.type,
        entryTaskIds: [],
        exitTaskIds: [],
      });
      continue;
    }

    if (node.type === "subworkflow") {
      const nested = await planSubworkflow(
        node,
        rootEpicId,
        wf.id,
        uid,
        allTaskInputs,
        allDepInputs,
        input.role,
        input.priority,
      );
      epicIds.push(...nested.epicIds);
      taskIds.push(...nested.taskIds);

      nodeMap.set(node.id, {
        nodeId: node.id,
        nodeType: "subworkflow",
        epicId: nested.childEpicId,
        entryTaskIds: nested.entryTaskIds,
        exitTaskIds: nested.exitTaskIds,
      });
    } else {
      const taskRole = (node.config?.role as string) ||
        (node.runInSubAgent ? "subagent" : input.role);
      const taskPriority = (node.config?.priority as TaskPriority) || input.priority || "medium";
      const taskId = generateTaskId(node.name);

      allTaskInputs.push({
        id: taskId,
        title: node.name,
        description: buildNodeTaskDescription(node),
        type: "task",
        status: "open",
        parentTaskId: rootEpicId,
        workflowId: wf.id,
        nodeId: node.id,
        role: taskRole,
        priority: taskPriority,
      });

      taskIds.push(taskId);
      nodeMap.set(node.id, {
        nodeId: node.id,
        nodeType: node.type,
        taskId,
        entryTaskIds: [taskId],
        exitTaskIds: [taskId],
      });
    }
  }

  // 3. Wire directional dependencies across edges
  for (const edge of edges) {
    if (edge.fromNodeId === startNode?.id || endNodeIds.has(edge.toNodeId)) {
      continue;
    }

    const fromMapping = nodeMap.get(edge.fromNodeId);
    const toMapping = nodeMap.get(edge.toNodeId);
    if (!fromMapping || !toMapping) continue;

    const isBackEdge = backEdges.has(edge.id);
    const depType: DependencyType = isBackEdge ? "conditional-blocks" : "blocks";

    for (const fromId of fromMapping.exitTaskIds) {
      for (const toId of toMapping.entryTaskIds) {
        if (fromId !== toId) {
          allDepInputs.push({ fromTaskId: fromId, toTaskId: toId, type: depType });
        }
      }
    }

    // If target is a subworkflow epic, also have prerequisite exit tasks block the subworkflow epic
    if (toMapping.epicId) {
      for (const fromId of fromMapping.exitTaskIds) {
        if (fromId !== toMapping.epicId) {
          allDepInputs.push({ fromTaskId: fromId, toTaskId: toMapping.epicId, type: depType });
        }
      }
    }

    // If source is a subworkflow epic, also have the child epic block target entry tasks
    if (fromMapping.epicId) {
      for (const toId of toMapping.entryTaskIds) {
        if (fromMapping.epicId !== toId) {
          allDepInputs.push({ fromTaskId: fromMapping.epicId, toTaskId: toId, type: depType });
        }
      }
    }
  }

  // 4. Persist all tasks and dependencies in bulk atomic batches
  const createdTasks = await createTasks(allTaskInputs, uid);
  const createdTaskMap = new Map<string, Task>(createdTasks.map((t) => [t.id, t]));

  const createdDeps = await addDependencies(allDepInputs, uid);

  const rootEpic = createdTaskMap.get(rootEpicId)!;
  const allEpics = epicIds.map((id) => createdTaskMap.get(id)!).filter(Boolean);
  const allTasks = taskIds.map((id) => createdTaskMap.get(id)!).filter(Boolean);

  // 5. Compute ready frontier for tasks created in this hydration
  const taskIdsSet = new Set(allTasks.map((t) => t.id));
  const rawReady = await computeReadyFrontier({
    workflowId: wf.id,
    userId: uid,
  });
  const readyTasks = rawReady.filter((t: Task) => taskIdsSet.has(t.id));

  // 5. Build summary and instructions for LLM
  const summary = {
    totalEpics: allEpics.length,
    totalTasks: allTasks.length,
    totalDependencies: createdDeps.length,
    readyTasksCount: readyTasks.length,
  };

  const firstReadyTask = readyTasks[0];
  const suggestedNextTools: Array<{
    tool: string;
    description: string;
    arguments: Record<string, unknown>;
  }> = [
    {
      tool: "task_ready",
      description: "Inspect all tasks ready to be worked on across this epic",
      arguments: { workflowId: wf.id },
    },
  ];

  if (firstReadyTask) {
    suggestedNextTools.push({
      tool: "task_claim",
      description: `Claim the first ready task ("${firstReadyTask.title}")`,
      arguments: { task: firstReadyTask.id, assignee: "<your-agent-id>" },
    });
  }

  const instructions =
    `Workflow "${wf.name}" successfully hydrated into Epic "${rootEpic.id}" with ${allTasks.length} task(s) and ${createdDeps.length} dependency edge(s).\n\n` +
    `🚀 **Ready to work immediately**: ${readyTasks.length} task(s) unblocked in the ready frontier.\n\n` +
    `**Recommended Next Steps for LLM**:\n` +
    `1. Call \`task_ready({ workflowId: "${wf.id}" })\` to inspect available work (or pick from \`readyTasks\` below).\n` +
    (firstReadyTask
      ? `2. Call \`task_claim({ task: "${firstReadyTask.id}", assignee: "<agent-id>" })\` to claim work atomically.\n`
      : `2. Call \`task_claim({ task: "<taskId>", assignee: "<agent-id>" })\` to claim work atomically.\n`) +
    `3. After executing work, call \`task_close({ task: "<taskId>", reason: "<done>" })\` to automatically unblock downstream tasks in the DAG.\n` +
    `4. As tasks complete, parent Epics will auto-close when all their child tasks finish!`;

  return {
    epic: rootEpic,
    epics: allEpics,
    tasks: allTasks,
    dependencies: createdDeps,
    readyTasks,
    summary,
    instructions,
    suggestedNextTools,
  };
}
