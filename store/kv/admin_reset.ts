/**
 * Safe scoped purge of Workflow Builder MCP data from Deno KV.
 * Only deletes keys belonging to workflow-builder-mcp prefixes.
 * Guarantees other applications sharing the same KV database are untouched.
 */

import { safeGetEnv } from "../../env.ts";
import { invalidateWorkflowCache } from "../resolvers.ts";
import { getKv } from "./client.ts";
import { clearRoleCache } from "./roles.ts";

// Top-level prefixes belonging strictly to workflow-builder-mcp
export const WORKFLOW_MCP_PREFIXES: Deno.KvKey[] = [
  ["workflows"],
  ["executions"],
  ["executions_by_parent"],
  ["executions_by_task"],
  ["memories"],
  ["memories_by_workflow"],
  ["memories_by_node"],
  ["memories_by_task"],
  ["memories_by_role"],
  ["memory_keys"],
  ["memory_accesses"],
  ["memory_access_log"],
  ["roles"],
  ["roles_by_name"],
  ["role_journals"],
  ["handoffs"],
  ["handoffs_by_task"],
  ["view_tickets"],
  ["closedTasks"],
  ["task_deps"],
  ["task_deps_rev"],
  ["pipeline_templates"], // legacy
  ["journals"], // legacy
];

// App-specific subkeys under ["users", userId, ...]
export const WORKFLOW_USER_SUBKEYS = new Set([
  "workflows",
  "nodes",
  "edges",
  "subworkflow_refs",
  "subworkflow_refs_indexed",
  "executions",
  "executions_by_workflow",
  "tasks",
  "closedTasks",
  "tasks_by_status",
  "tasks_by_assignee",
  "tasks_by_role",
  "tasks_by_type",
  "tasks_by_workflow",
  "tasks_by_execution",
  "tasks_by_node",
  "tasks_by_assigned_workflow",
  "tasks_by_parent",
  "parent_children",
  "task_deps",
  "task_deps_rev",
  "task_dependencies",
  "task_dependents",
  "memories",
  "memory_keys",
  "memories_by_workflow",
  "memories_by_node",
  "memories_by_task",
  "memories_by_role",
  "memory_access_log",
  "memory_accesses",
  "roles",
  "roles_by_name",
  "role_journals",
  "handoffs",
  "view_tickets",
  "cache",
  "pipeline_templates",
  "journals",
]);

export interface PurgeResult {
  deletedCount: number;
  prefixesPurged: string[];
}

/**
 * Safely purges only Workflow Builder MCP keys from the given KV database.
 */
export async function purgeWorkflowMcpData(kv: Deno.Kv): Promise<PurgeResult> {
  let count = 0;
  const prefixesPurged: string[] = [];

  // Clear in-memory caches
  try {
    clearRoleCache();
    invalidateWorkflowCache();
  } catch {
    // Ignore cache clear failures in non-standard environments
  }

  // 1. Delete top-level workflow prefixes
  for (const prefix of WORKFLOW_MCP_PREFIXES) {
    let prefixCount = 0;
    for await (const entry of kv.list({ prefix })) {
      await kv.delete(entry.key);
      count++;
      prefixCount++;
    }
    if (prefixCount > 0) {
      prefixesPurged.push(String(prefix[0]));
    }
  }

  // 2. Delete user-scoped workflow keys without touching other app user data
  for await (const entry of kv.list({ prefix: ["users"] })) {
    if (entry.key.length >= 3 && typeof entry.key[2] === "string") {
      const subkey = entry.key[2];
      if (WORKFLOW_USER_SUBKEYS.has(subkey)) {
        await kv.delete(entry.key);
        count++;
      }
    }
  }

  return { deletedCount: count, prefixesPurged };
}

let _startupResetChecked = false;

/**
 * Reset startup check flag (primarily for unit tests).
 */
export function resetStartupCheckForTesting(): void {
  _startupResetChecked = false;
}

/**
 * Checks for RESET_WORKFLOW_DATA_ONCE environment variable on startup.
 * If present and not previously executed, safely purges workflow-builder-mcp data once.
 * Other applications sharing the same KV database are strictly preserved.
 */
export async function checkAndPerformStartupReset(): Promise<void> {
  if (_startupResetChecked) return;
  _startupResetChecked = true;

  const flag = safeGetEnv("RESET_WORKFLOW_DATA_ONCE");
  if (!flag) {
    return;
  }
  const cleanFlag = flag.trim().toLowerCase();
  if (cleanFlag !== "1" && cleanFlag !== "true" && cleanFlag !== "force") {
    return;
  }

  try {
    const kv = await getKv();
    const isForce = cleanFlag === "force";

    if (!isForce) {
      const marker = await kv.get<boolean>(["workflow_system", "reset_done_v2"]);
      if (marker.value) {
        console.log(
          "[WORKFLOW_MCP] RESET_WORKFLOW_DATA_ONCE detected, but reset was already completed previously. Skipping.",
        );
        return;
      }
    }

    console.log(
      "[WORKFLOW_MCP] RESET_WORKFLOW_DATA_ONCE detected. Starting one-time safe purge of workflow-builder-mcp data...",
    );
    const result = await purgeWorkflowMcpData(kv);
    await kv.set(["workflow_system", "reset_done_v2"], true);
    await kv.set(["workflow_system", "reset_done"], true);

    console.log(
      `[WORKFLOW_MCP] ✅ Startup purge complete. Safely deleted ${result.deletedCount} workflow keys.`,
    );
    if (result.prefixesPurged.length > 0) {
      console.log(`[WORKFLOW_MCP] Purged prefixes: ${result.prefixesPurged.join(", ")}`);
    }
    console.log(
      "[WORKFLOW_MCP] All other application data in this database remains completely untouched.",
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[WORKFLOW_MCP] ❌ Failed to execute startup reset: ${msg}`);
  }
}
