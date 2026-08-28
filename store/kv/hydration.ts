/**
 * Hydration engine: transforms workflow templates into executable Epics, Tasks, and Dependencies.
 */

import { resolveUserId } from "./client.ts";
import { addDependency, computeReadyFrontier, createTask } from "./tasks.ts";
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
  task?: Task;
  epic?: Task;
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
 * Recursive helper to hydrate a subworkflow node into a child epic ("an epic in an epic").
 */
async function hydrateSubworkflow(
  subwfNode: WorkflowNode,
  parentEpicId: TaskId,
  rootWorkflowId: string,
  uid: string,
  defaultRole?: string,
  defaultPriority?: TaskPriority,
): Promise<{
  childEpic: Task;
  childEpics: Task[];
  childTasks: Task[];
  childDeps: TaskDependency[];
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

  // Create child epic under parent epic
  const childEpic = await createTask({
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
  }, uid);

  const childEpics: Task[] = [childEpic];
  const childTasks: Task[] = [];
  const childDeps: TaskDependency[] = [];
  const nodeMap = new Map<string, HydratedNodeMapping>();

  // Hydrate nodes of child workflow
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
      const nested = await hydrateSubworkflow(
        node,
        childEpic.id,
        rootWorkflowId,
        uid,
        defaultRole,
        defaultPriority,
      );
      childEpics.push(...nested.childEpics);
      childTasks.push(...nested.childTasks);
      childDeps.push(...nested.childDeps);

      nodeMap.set(node.id, {
        nodeId: node.id,
        nodeType: "subworkflow",
        epic: nested.childEpic,
        entryTaskIds: nested.entryTaskIds,
        exitTaskIds: nested.exitTaskIds,
      });
    } else {
      const taskRole = (node.config?.role as string) ||
        (node.runInSubAgent ? "subagent" : defaultRole);
      const taskPriority = (node.config?.priority as TaskPriority) || defaultPriority || "medium";

      const task = await createTask({
        title: node.name,
        description: buildNodeTaskDescription(node),
        type: "task",
        status: "open",
        parentTaskId: childEpic.id,
        workflowId: rootWorkflowId,
        nodeId: node.id,
        role: taskRole,
        priority: taskPriority,
      }, uid);

      childTasks.push(task);
      nodeMap.set(node.id, {
        nodeId: node.id,
        nodeType: node.type,
        task,
        entryTaskIds: [task.id],
        exitTaskIds: [task.id],
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
          const dep = await addDependency(fromId, toId, depType, uid);
          childDeps.push(dep);
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
  if (entryTaskIds.length === 0 && childTasks.length > 0) {
    entryTaskIds.push(childTasks[0].id);
  }
  if (exitTaskIds.length === 0 && childTasks.length > 0) {
    exitTaskIds.push(childTasks[childTasks.length - 1].id);
  }

  return {
    childEpic,
    childEpics,
    childTasks,
    childDeps,
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

  // 1. Create root Epic task
  const rootEpic = await createTask({
    title: input.title?.trim() || wf.name,
    description: input.description?.trim() || wf.description ||
      `Epic hydrated from workflow "${wf.name}"`,
    type: "epic",
    status: "open",
    parentTaskId: input.parentTaskId,
    workflowId: wf.id,
    priority: input.priority ?? "medium",
    role: input.role,
  }, uid);

  const allEpics: Task[] = [rootEpic];
  const allTasks: Task[] = [];
  const allDependencies: TaskDependency[] = [];
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
      // Nested subworkflow -> epic in an epic!
      const nested = await hydrateSubworkflow(
        node,
        rootEpic.id,
        wf.id,
        uid,
        input.role,
        input.priority,
      );
      allEpics.push(...nested.childEpics);
      allTasks.push(...nested.childTasks);
      allDependencies.push(...nested.childDeps);

      nodeMap.set(node.id, {
        nodeId: node.id,
        nodeType: "subworkflow",
        epic: nested.childEpic,
        entryTaskIds: nested.entryTaskIds,
        exitTaskIds: nested.exitTaskIds,
      });
    } else {
      const taskRole = (node.config?.role as string) ||
        (node.runInSubAgent ? "subagent" : input.role);
      const taskPriority = (node.config?.priority as TaskPriority) || input.priority || "medium";

      const task = await createTask({
        title: node.name,
        description: buildNodeTaskDescription(node),
        type: "task",
        status: "open",
        parentTaskId: rootEpic.id,
        workflowId: wf.id,
        nodeId: node.id,
        role: taskRole,
        priority: taskPriority,
      }, uid);

      allTasks.push(task);
      nodeMap.set(node.id, {
        nodeId: node.id,
        nodeType: node.type,
        task,
        entryTaskIds: [task.id],
        exitTaskIds: [task.id],
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
          const dep = await addDependency(fromId, toId, depType, uid);
          allDependencies.push(dep);
        }
      }
    }

    // If target is a subworkflow epic, also have prerequisite exit tasks block the subworkflow epic
    if (toMapping.epic) {
      for (const fromId of fromMapping.exitTaskIds) {
        if (fromId !== toMapping.epic.id) {
          const dep = await addDependency(fromId, toMapping.epic.id, depType, uid);
          allDependencies.push(dep);
        }
      }
    }

    // If source is a subworkflow epic, also have the child epic block target entry tasks
    if (fromMapping.epic) {
      for (const toId of toMapping.entryTaskIds) {
        if (fromMapping.epic.id !== toId) {
          const dep = await addDependency(fromMapping.epic.id, toId, depType, uid);
          allDependencies.push(dep);
        }
      }
    }
  }

  // 4. Compute ready frontier for tasks created in this hydration
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
    totalDependencies: allDependencies.length,
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
    `Workflow "${wf.name}" successfully hydrated into Epic "${rootEpic.id}" with ${allTasks.length} task(s) and ${allDependencies.length} dependency edge(s).\n\n` +
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
    dependencies: allDependencies,
    readyTasks,
    summary,
    instructions,
    suggestedNextTools,
  };
}
