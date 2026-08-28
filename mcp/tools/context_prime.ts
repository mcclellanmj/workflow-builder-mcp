import { z } from "zod";
import {
  computeReadyFrontier,
  getHandoffsForTask,
  listMemories,
  type MemorySummary,
  readJournal,
  recallMemory,
} from "../../store/kv.ts";
import type { HandoffRecord, Memory, RoleJournal, Task } from "../../store/types.ts";
import { defineTool, jsonResponse, resolveWorkflow } from "../helpers.ts";
import { resolveTask } from "./task_helpers.ts";

const ContextPrimeSchema = z.object({
  workflow: z.string().optional().describe("Workflow ID, name, or slug to prime context for."),
  workflowId: z.string().optional().describe("Alias for 'workflow'."),
  executionId: z.string().optional().describe("Active execution ID."),
  task: z.string().optional().describe("Task ID to prime context for."),
  taskId: z.string().optional().describe("Alias for 'task'."),
  role: z.string().optional().describe(
    "Role name to prime context for (e.g. 'frontend', 'security-reviewer').",
  ),
  tokenBudget: z.number().int().positive().optional().default(2000).describe(
    "Token budget for formatted context (default 2000 tokens ≈ 8000 characters).",
  ),
}).optional().default({});

export const contextPrimeTool = defineTool({
  name: "context_prime",
  description:
    "Bootstraps an agent session by gathering role journal, relevant memories (workflow, node, role), active task state, handoff history, and unblocked ready frontier into a compact context package within a specified token budget.",
  schema: ContextPrimeSchema,
  execute: async (
    { workflow, workflowId, executionId, task, taskId, role, tokenBudget = 2000 },
  ) => {
    let targetWorkflow = workflow ?? workflowId;
    const targetTaskId = (task ?? taskId)?.trim();
    let targetExecutionId = executionId?.trim();
    let targetRole = role?.trim();
    let targetNodeId: string | undefined;

    // 1. If taskId provided, gather active task details & context
    let taskRecord: Task | null = null;
    if (targetTaskId) {
      taskRecord = await resolveTask(targetTaskId);
      if (taskRecord) {
        if (!targetRole && taskRecord.role) {
          targetRole = taskRecord.role;
        }
        if (!targetWorkflow && taskRecord.workflowId) {
          targetWorkflow = taskRecord.workflowId;
        }
        if (!targetExecutionId && taskRecord.executionId) {
          targetExecutionId = taskRecord.executionId;
        }
        if (taskRecord.nodeId) {
          targetNodeId = taskRecord.nodeId;
        }
      }
    }

    // Resolve workflow identifier if provided
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

    // 2. Role Journal (if role provided or found on task)
    let journalRecord: RoleJournal | null = null;
    let journalLoaded = false;
    if (targetRole && targetRole.trim()) {
      journalRecord = await readJournal(targetRole.trim());
      if (journalRecord) {
        journalLoaded = true;
      }
    }

    // 3. Task handoffs
    let handoffs: HandoffRecord[] = [];
    if (taskRecord) {
      handoffs = await getHandoffsForTask(taskRecord.id);
    }
    const handoffsLoaded = handoffs.length;

    // 4. Gather candidate memories
    const seenMemoryIds = new Set<string>();
    const candidateSummaries: MemorySummary[] = [];

    // 4a. Node memories (if workflow and nodeId known)
    if (resolvedWfId && targetNodeId) {
      const nodeMems = await listMemories({ workflowId: resolvedWfId, nodeId: targetNodeId });
      for (const m of nodeMems) {
        if (!seenMemoryIds.has(m.id)) {
          seenMemoryIds.add(m.id);
          candidateSummaries.push(m);
        }
      }
    }

    // 4b. Workflow memories
    if (resolvedWfId) {
      const wfMems = await listMemories({ workflowId: resolvedWfId });
      for (const m of wfMems) {
        if (!seenMemoryIds.has(m.id)) {
          seenMemoryIds.add(m.id);
          candidateSummaries.push(m);
        }
      }
    }

    // 4c. Role memories
    if (targetRole && targetRole.trim()) {
      const roleMems = await listMemories({ roleId: targetRole.trim() });
      for (const m of roleMems) {
        if (!seenMemoryIds.has(m.id)) {
          seenMemoryIds.add(m.id);
          candidateSummaries.push(m);
        }
      }
    }

    // 5. Ready frontier tasks
    const readyTasks = await computeReadyFrontier({
      workflowId: resolvedWfId,
      executionId: targetExecutionId,
      role: targetRole,
      limit: 10,
    });

    // 6. Assemble Markdown within tokenBudget
    const maxChars = tokenBudget * 4;

    const sections: string[] = ["# 🧭 Session Context Bootstrap\n"];

    if (taskRecord) {
      let taskMd = `## 📌 Active Task: [${taskRecord.id}] ${taskRecord.title}\n`;
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
      if (taskRecord.description) {
        taskMd += `> ${taskRecord.description}\n`;
      }
      if (taskRecord.context && taskRecord.context.trim()) {
        taskMd += `\n### 📝 Accumulated Working Context\n${taskRecord.context.trim()}\n`;
      }
      if (taskRecord.rejectedApproaches && taskRecord.rejectedApproaches.length > 0) {
        taskMd += `\n### ⚠️ Rejected Approaches (Avoid Repeating)\n`;
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
        handoffMd += `- **${h.timestamp.slice(0, 19)}**: from \`${h.fromAssignee}\` ➔ ${toDest}\n`;
        handoffMd += `  - *Reason*: ${h.reason}\n`;
        if (h.contextSummary) {
          handoffMd += `  - *Context*: ${h.contextSummary}\n`;
        }
        if (h.rejectedApproaches && h.rejectedApproaches.length > 0) {
          handoffMd += `  - *Rejected*: ${h.rejectedApproaches.join(", ")}\n`;
        }
      }
      sections.push(handoffMd);
    }

    if (journalRecord) {
      let journalMd = `## 📖 Role Journal: \`${journalRecord.roleId}\`\n`;
      const author = journalRecord.writtenBy ? `by \`${journalRecord.writtenBy}\` ` : "";
      journalMd += `> *Last updated ${author}at ${journalRecord.writtenAt}*\n\n`;
      journalMd += `${journalRecord.entry}\n`;
      sections.push(journalMd);
    }

    // Now recall memories that fit in the remaining budget
    const currentLength = sections.reduce((sum, s) => sum + s.length, 0);
    // Reserve ~400 chars for ready frontier and formatting
    const memoryCharBudget = Math.max(0, maxChars - currentLength - 400);

    const loadedMemories: Memory[] = [];
    let memoryCharsUsed = 0;

    for (const summary of candidateSummaries) {
      if (memoryCharsUsed >= memoryCharBudget) break;

      const recalled = await recallMemory({
        id: summary.id,
        taskId: taskRecord?.id,
        executionId: targetExecutionId,
        accessedBy: targetRole || "context_prime",
      });

      if (recalled) {
        const memSnippet =
          `### [${recalled.scope.toUpperCase()}] ${recalled.key}\n> ${recalled.summary}\n\n${recalled.content}\n\n`;
        if (
          memoryCharsUsed + memSnippet.length <= memoryCharBudget || loadedMemories.length === 0
        ) {
          loadedMemories.push(recalled);
          memoryCharsUsed += memSnippet.length;
        } else {
          break;
        }
      }
    }

    if (loadedMemories.length > 0) {
      let memSectionMd = `## 🧠 Recalled Memories (${loadedMemories.length})\n\n`;
      for (const m of loadedMemories) {
        memSectionMd +=
          `### [${m.scope.toUpperCase()}] ${m.key}\n> ${m.summary}\n\n${m.content}\n\n`;
      }
      sections.push(memSectionMd);
    }

    if (readyTasks.length > 0) {
      let frontierMd = `## 🚀 Ready Frontier (${readyTasks.length} task(s) unblocked)\n`;
      for (const t of readyTasks.slice(0, 5)) {
        const roleLabel = t.role ? `[role: ${t.role}]` : "[any role]";
        const prioLabel = t.priority ? `(${t.priority})` : "";
        frontierMd += `- **\`${t.id}\`**: ${t.title} \`${t.status}\` ${roleLabel} ${prioLabel}\n`;
      }
      sections.push(frontierMd);
    }

    let fullContext = sections.join("\n").trim();
    if (fullContext.length > maxChars) {
      fullContext = fullContext.slice(0, Math.max(0, maxChars - 3)) + "...";
    }

    return jsonResponse({
      context: fullContext,
      memoriesLoaded: loadedMemories.length,
      handoffsLoaded,
      journalLoaded,
    });
  },
});
