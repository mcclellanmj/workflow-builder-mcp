import { z } from "zod";
import {
  computeReadyFrontier,
  getExecution,
  getHandoffsForTask,
  listEdges,
  listExecutions,
  listMemories,
  listNodes,
  listTasks,
  type MemorySummary,
  recallMemory,
} from "../../store/kv.ts";
import type {
  HandoffRecord,
  JoinPolicy,
  Memory,
  Task,
  WorkflowExecution,
} from "../../store/types.ts";
import { defineTool, jsonResponse, resolveWorkflow } from "../helpers.ts";
import { resolveTask } from "./task_helpers.ts";

const ContextPrimeSchema = z.object({
  workflow: z.string().optional().describe("Workflow ID, name, or slug to prime context for."),
  workflowId: z.string().optional().describe("Alias for 'workflow'."),
  executionId: z.string().optional().describe("Active workflow execution ID."),
  task: z.string().optional().describe("Task ID to prime context for."),
  taskId: z.string().optional().describe("Alias for 'task'."),
  role: z.string().optional().describe(
    "Role name to prime context for (e.g. 'frontend', 'developer', 'qa', 'architect').",
  ),
  tokenBudget: z.number().int().positive().optional().default(2000).describe(
    "Token budget for formatted context (default 2000 tokens ≈ 8000 characters).",
  ),
}).optional().default({});

export const contextPrimeTool = defineTool({
  name: "context_prime",
  description:
    "Bootstraps an agent session by summarizing active workflow executions, barrier-ready nodes, claimed tasks, predecessor handoffs, and workflow-level architecture memories within a token budget.",
  schema: ContextPrimeSchema,
  execute: async (
    { workflow, workflowId, executionId, task, taskId, role, tokenBudget = 2000 },
  ) => {
    let targetWorkflow = workflow ?? workflowId;
    const targetTaskId = (task ?? taskId)?.trim();
    let targetExecutionId = executionId?.trim();
    let targetRole = role?.trim();
    let targetNodeId: string | undefined;

    // 1. Resolve task details if taskId provided
    let taskRecord: Task | null = null;
    if (targetTaskId) {
      taskRecord = await resolveTask(targetTaskId);
      if (taskRecord) {
        if (!targetRole && taskRecord.role) {
          targetRole = taskRecord.role;
        }
        if (!targetWorkflow) {
          targetWorkflow = taskRecord.originWorkflowId ?? taskRecord.workflowId;
        }
        if (!targetExecutionId) {
          targetExecutionId = taskRecord.originExecutionId ?? taskRecord.executionId;
        }
        if (taskRecord.originNodeId || taskRecord.nodeId) {
          targetNodeId = taskRecord.originNodeId ?? taskRecord.nodeId;
        }
      }
    }

    // Resolve workflow identifier
    let resolvedWfId: string | undefined;
    let workflowName: string | undefined;
    if (targetWorkflow && targetWorkflow.trim()) {
      const resolved = await resolveWorkflow(targetWorkflow.trim());
      if (resolved) {
        resolvedWfId = resolved.id;
        workflowName = resolved.name;
      } else {
        resolvedWfId = targetWorkflow.trim();
      }
    }

    // 2. Task handoffs
    let handoffs: HandoffRecord[] = [];
    if (taskRecord) {
      handoffs = await getHandoffsForTask(taskRecord.id);
    }
    const handoffsLoaded = handoffs.length;

    // 3. Active Workflow Executions & Barrier-Ready Nodes
    const activeExecutions: WorkflowExecution[] = [];
    if (targetExecutionId) {
      const exec = await getExecution(targetExecutionId);
      if (exec) activeExecutions.push(exec);
    } else if (resolvedWfId) {
      const execs = await listExecutions(resolvedWfId);
      for (const e of execs) {
        if (e.status === "in_progress") {
          activeExecutions.push(e);
        }
      }
    }

    // Compute barrier-ready and running nodes across active executions
    const executionSummaries: Array<{
      id: string;
      workflowId: string;
      runningNodes: string[];
      barrierReadyNodes: string[];
    }> = [];

    for (const exec of activeExecutions) {
      const [nodes, edges] = await Promise.all([
        listNodes(exec.workflowId),
        listEdges(exec.workflowId),
      ]);

      const running: string[] = [];
      const barrierReady: string[] = [];

      for (const n of nodes) {
        const state = exec.nodeStates[n.id];
        if (state?.status === "running") {
          running.push(n.name ? `${n.name} (${n.id})` : n.id);
        } else if (!state || state.status === "pending") {
          // Check barrier dependencies
          const inbound = edges.filter((e) => e.toNodeId === n.id);
          if (inbound.length > 0) {
            const policy: JoinPolicy = n.joinPolicy ?? "all";
            if (policy === "all") {
              const allDone = inbound.every(
                (edge) => exec.nodeStates[edge.fromNodeId]?.status === "completed",
              );
              if (allDone) {
                barrierReady.push(n.name ? `${n.name} (${n.id})` : n.id);
              }
            } else if (policy === "m_of_n") {
              const threshold = n.joinThreshold ?? 1;
              const count = inbound.filter(
                (edge) => exec.nodeStates[edge.fromNodeId]?.status === "completed",
              ).length;
              if (count >= threshold) {
                barrierReady.push(n.name ? `${n.name} (${n.id})` : n.id);
              }
            }
          }
        }
      }

      executionSummaries.push({
        id: exec.id,
        workflowId: exec.workflowId,
        runningNodes: running,
        barrierReadyNodes: barrierReady,
      });
    }

    // 4. Claimed & Ready Tasks
    const [claimedTasks, readyTasks] = await Promise.all([
      listTasks({
        workflowId: resolvedWfId,
        executionId: targetExecutionId,
        role: targetRole,
        status: "claimed",
        limit: 10,
      }),
      computeReadyFrontier({
        workflowId: resolvedWfId,
        executionId: targetExecutionId,
        role: targetRole,
        limit: 10,
      }),
    ]);

    // 5. Workflow-level Architecture & Step Memories
    let candidateSummaries: MemorySummary[] = [];
    if (resolvedWfId) {
      candidateSummaries = await listMemories({
        workflowId: resolvedWfId,
        limit: 20,
      });
    }

    // Prioritize architecture memories, then step memories
    candidateSummaries.sort((a, b) => {
      const aArch = a.tags.includes("architecture") || a.tags.includes("contract") ? 1 : 0;
      const bArch = b.tags.includes("architecture") || b.tags.includes("contract") ? 1 : 0;
      if (aArch !== bArch) return bArch - aArch;
      if (targetNodeId) {
        const aNode = a.nodeId === targetNodeId ? 1 : 0;
        const bNode = b.nodeId === targetNodeId ? 1 : 0;
        if (aNode !== bNode) return bNode - aNode;
      }
      return (b.accessCount ?? 0) - (a.accessCount ?? 0);
    });

    // Assemble markdown context within tokenBudget
    const maxChars = tokenBudget * 4;
    const sections: string[] = ["# 🧭 Session Context Bootstrap\n"];

    if (taskRecord) {
      let taskMd = `## 📌 Current Task: [${taskRecord.id}] ${taskRecord.title}\n`;
      taskMd += `- **Status**: \`${taskRecord.status}\` | **Priority**: \`${
        taskRecord.priority || "medium"
      }\` | **Role**: \`${taskRecord.role || "none"}\`\n`;
      if (taskRecord.assignee) {
        taskMd += `- **Assignee**: \`${taskRecord.assignee}\`\n`;
      }
      if (resolvedWfId) {
        taskMd += `- **Workflow**: ${
          workflowName ? `**${workflowName}** (\`${resolvedWfId}\`)` : `\`${resolvedWfId}\``
        }${targetNodeId ? ` | **Node**: \`${targetNodeId}\`` : ""}\n`;
      }
      if (taskRecord.assignedWorkflowId) {
        taskMd += `- **Assigned Subworkflow**: \`${taskRecord.assignedWorkflowId}\`\n`;
      }
      if (taskRecord.rejectionCount && taskRecord.rejectionCount > 0) {
        taskMd += `- **Rejection Count**: ${taskRecord.rejectionCount}\n`;
      }
      if (taskRecord.description) {
        taskMd += `> ${taskRecord.description}\n`;
      }
      if (taskRecord.context && taskRecord.context.trim()) {
        taskMd += `\n### 📝 Accumulated Working Context\n${taskRecord.context.trim()}\n`;
      }
      if (taskRecord.rejectedApproaches && taskRecord.rejectedApproaches.length > 0) {
        taskMd += `\n### ⚠️ Rejected Approaches (Do Not Repeat)\n`;
        for (const ra of taskRecord.rejectedApproaches) {
          taskMd += `- ❌ ${ra}\n`;
        }
      }
      sections.push(taskMd);
    }

    if (handoffs.length > 0) {
      let handoffMd = `## 🔄 Recent Task Handoffs (${handoffs.length})\n`;
      for (const h of handoffs.slice(-3)) {
        const toDest = h.toAssignee
          ? `agent \`${h.toAssignee}\``
          : (h.toRole ? `role \`${h.toRole}\`` : "queue");
        handoffMd += `- **${h.timestamp.slice(0, 19)}**: [${h.action.toUpperCase()}] from \`${h.fromAssignee}\` ➔ ${toDest}\n`;
        handoffMd += `  - *Reason*: ${h.reason}\n`;
        if (h.contextSummary) {
          handoffMd += `  - *Context*: ${h.contextSummary}\n`;
        }
        if (h.feedback && h.feedback.length > 0) {
          handoffMd += `  - *Feedback*: ${h.feedback.join("; ")}\n`;
        }
      }
      sections.push(handoffMd);
    }

    if (executionSummaries.length > 0) {
      let execMd = `## ⚙️ Active Workflow Executions (${executionSummaries.length})\n`;
      for (const ex of executionSummaries) {
        execMd += `- **Run**: \`${ex.id}\` (Workflow: \`${ex.workflowId}\`)\n`;
        if (ex.runningNodes.length > 0) {
          execMd += `  - **Running Steps**: ${ex.runningNodes.join(", ")}\n`;
        }
        if (ex.barrierReadyNodes.length > 0) {
          execMd += `  - **Barrier-Ready Steps (Unblocked)**: ${ex.barrierReadyNodes.join(", ")}\n`;
        }
      }
      sections.push(execMd);
    }

    if (claimedTasks.length > 0) {
      let claimedMd = `## 📋 Claimed Tasks In Progress (${claimedTasks.length})\n`;
      for (const t of claimedTasks.slice(0, 5)) {
        const assigneeStr = t.assignee ? ` [assignee: ${t.assignee}]` : "";
        claimedMd += `- **\`${t.id}\`**: ${t.title} (\`${t.role || "no role"}\`)${assigneeStr}\n`;
      }
      sections.push(claimedMd);
    }

    if (readyTasks.length > 0) {
      let frontierMd = `## 🚀 Ready Frontier (${readyTasks.length} task(s) unblocked)\n`;
      for (const t of readyTasks.slice(0, 5)) {
        const roleLabel = t.role ? `[role: ${t.role}]` : "[any role]";
        frontierMd += `- **\`${t.id}\`**: ${t.title} ${roleLabel}\n`;
      }
      sections.push(frontierMd);
    }

    // Recall top memories fitting in remaining budget
    const currentLength = sections.reduce((sum, s) => sum + s.length, 0);
    const memoryCharBudget = Math.max(0, maxChars - currentLength - 200);

    const loadedMemories: Memory[] = [];
    let memoryCharsUsed = 0;

    const recalledMemories = await Promise.all(
      candidateSummaries.slice(0, 5).map((summary) =>
        recallMemory({
          id: summary.id,
          taskId: taskRecord?.id,
          executionId: targetExecutionId,
          accessedBy: targetRole || "context_prime",
        })
      ),
    );

    for (const recalled of recalledMemories) {
      if (!recalled) continue;
      if (memoryCharsUsed >= memoryCharBudget) break;

      const memSnippet =
        `### [${recalled.key}] ${recalled.summary}\n${recalled.content}\n\n`;
      if (
        memoryCharsUsed + memSnippet.length <= memoryCharBudget || loadedMemories.length === 0
      ) {
        loadedMemories.push(recalled);
        memoryCharsUsed += memSnippet.length;
      } else {
        break;
      }
    }

    if (loadedMemories.length > 0) {
      let memSectionMd = `## 🧠 Architecture & Project Memories (${loadedMemories.length})\n\n`;
      for (const m of loadedMemories) {
        const anchor = m.nodeId ? ` (Step: \`${m.nodeId}\`)` : (m.taskId ? ` (Task: \`${m.taskId}\`)` : "");
        memSectionMd += `### **${m.key}**${anchor}\n> ${m.summary}\n\n${m.content}\n\n`;
      }
      sections.push(memSectionMd);
    }

    let fullContext = sections.join("\n").trim();
    if (fullContext.length > maxChars) {
      fullContext = fullContext.slice(0, Math.max(0, maxChars - 3)) + "...";
    }

    return jsonResponse({
      context: fullContext,
      memoriesLoaded: loadedMemories.length,
      handoffsLoaded,
      activeExecutionsCount: activeExecutions.length,
      readyTasksCount: readyTasks.length,
    });
  },
});
