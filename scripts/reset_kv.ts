/**
 * Standalone script to safely purge only workflow-builder-mcp entries from Deno KV.
 * Usage: deno run --unstable-kv --allow-read --allow-write --allow-env scripts/reset_kv.ts [path]
 */

const path = Deno.args[0] || Deno.env.get("DENO_KV_URL") || undefined;
const kv = await Deno.openKv(path);


// Top-level prefixes belonging strictly to workflow-builder-mcp
const WORKFLOW_MCP_PREFIXES = [
  ["workflows"],
  ["executions"],
  ["executions_by_parent"],
  ["executions_by_task"],
  ["memories"],
  ["memories_by_workflow"],
  ["memories_by_node"],
  ["memories_by_task"],
  ["memory_accesses"],
  ["roles"],
  ["roles_by_name"],
  ["handoffs"],
  ["handoffs_by_task"],
  ["view_tickets"],
  ["pipeline_templates"], // legacy
  ["journals"],           // legacy
];

// App-specific subkeys under ["users", userId, ...]
const WORKFLOW_USER_SUBKEYS = new Set([
  "workflows",
  "nodes",
  "edges",
  "tasks",
  "tasks_by_status",
  "tasks_by_assignee",
  "tasks_by_workflow",
  "tasks_by_execution",
  "tasks_by_node",
  "tasks_by_parent",
  "task_dependencies",
  "roles",
  "handoffs",
  "cache",
]);

console.log("Safely purging only Workflow Builder MCP keys from Deno KV (other apps will NOT be touched)...");
let count = 0;

// 1. Delete top-level workflow prefixes
for (const prefix of WORKFLOW_MCP_PREFIXES) {
  for await (const entry of kv.list({ prefix })) {
    await kv.delete(entry.key);
    count++;
  }
}

// 2. Delete user-scoped workflow keys without touching other app user data
for await (const entry of kv.list({ prefix: ["users"] })) {
  // Key format: ["users", userId, subkey, ...]
  if (entry.key.length >= 3 && typeof entry.key[2] === "string") {
    const subkey = entry.key[2];
    if (WORKFLOW_USER_SUBKEYS.has(subkey)) {
      await kv.delete(entry.key);
      count++;
    }
  }
}

await kv.close();
console.log(`Reset complete. Safely deleted ${count} workflow-builder-mcp keys.`);

