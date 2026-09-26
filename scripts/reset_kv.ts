/**
 * Safe, scoped script to purge only workflow-builder-mcp entries from Deno KV.
 *
 * Guarantees that other applications sharing the same KV database are untouched.
 *
 * Usage:
 *   deno task reset:kv [url] [--token=<token>]
 *
 * Examples:
 *   # Local KV reset:
 *   deno task reset:kv
 *
 *   # Remote Deno Deploy KV with token flag:
 *   deno task reset:kv https://api.deno.com/databases/<db-id>/connect --token=ddp_xxxx
 *
 *   # Or via environment variables:
 *   # PowerShell: $env:DENO_KV_ACCESS_TOKEN="ddp_xxxx"
 *   # Bash:       export DENO_KV_ACCESS_TOKEN="ddp_xxxx"
 *   deno task reset:kv https://api.deno.com/databases/<db-id>/connect
 */

import { purgeWorkflowMcpData } from "../store/kv/admin_reset.ts";

function printHelp(): void {
  console.log(`
Workflow Builder MCP - Safe Database Reset Tool

Usage:
  deno task reset:kv [options] [database_url]

Arguments:
  [database_url]              Path or URL to the Deno KV database.
                              Defaults to local KV or DENO_KV_URL env var.

Options:
  --token, -t <token>         Deno Deploy Personal Access Token (starts with 'ddp_').
                              Alternatively set the DENO_KV_ACCESS_TOKEN env var.
  --url, -u <url>             Database URL (alternative to positional argument).
  --help, -h                  Show this help guide.

Examples:
  # Reset local development KV:
  deno task reset:kv

  # Reset remote Deno Deploy KV directly with token flag:
  deno task reset:kv "https://api.deno.com/databases/<id>/connect" --token=ddp_xxxx

Safety:
  This script ONLY purges keys belonging to workflow-builder-mcp.
  Other applications sharing the same Deno KV database are completely safe and untouched.
`);
}

function cleanValue(val: string | undefined): string | undefined {
  if (!val) return undefined;
  let cleaned = val.trim();
  // Strip outer quotes if passed through shell literally (e.g. '"val"' or "'val'")
  while (
    (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
    (cleaned.startsWith("'") && cleaned.endsWith("'"))
  ) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  return cleaned.length > 0 ? cleaned : undefined;
}

// 1. Parse Command Line Arguments
let targetUrl: string | undefined = undefined;
let token: string | undefined = undefined;

for (let i = 0; i < Deno.args.length; i++) {
  const arg = Deno.args[i];

  if (arg === "--help" || arg === "-h") {
    printHelp();
    Deno.exit(0);
  } else if (arg.startsWith("--token=")) {
    token = arg.slice("--token=".length);
  } else if (arg === "--token" || arg === "-t") {
    token = Deno.args[++i];
  } else if (arg.startsWith("--url=")) {
    targetUrl = arg.slice("--url=".length);
  } else if (arg === "--url" || arg === "-u") {
    targetUrl = Deno.args[++i];
  } else if (!arg.startsWith("-") && !targetUrl) {
    targetUrl = arg;
  }
}

// 2. Resolve & Clean Target URL and Access Token
targetUrl = cleanValue(targetUrl) || cleanValue(Deno.env.get("DENO_KV_URL"));
token = cleanValue(token) || cleanValue(Deno.env.get("DENO_KV_ACCESS_TOKEN"));

if (token) {
  Deno.env.set("DENO_KV_ACCESS_TOKEN", token);
}

const isRemote = Boolean(
  targetUrl && (targetUrl.startsWith("https://") || targetUrl.startsWith("http://")),
);

// 3. Pre-flight Validation for Remote Deno Deploy KV
if (isRemote) {
  if (!token) {
    console.error(`
================================================================================
❌ MISSING DENO_KV_ACCESS_TOKEN
================================================================================
You are attempting to connect to a remote Deno KV database:
  ${targetUrl}

Remote connections to Deno Deploy KV require an access token.

How to fix:
1. Generate a Personal Access Token:
   👉 Open: https://dash.deno.com/user/access-tokens
   👉 Click: "+ New Access Token"
   👉 Copy the token (it begins with "ddp_")
   ⚠️  IMPORTANT: Must be a Personal Access Token from user settings,
      NOT a project-scoped token from project settings.

2. Run with the --token flag:
   deno task reset:kv "${targetUrl}" --token=ddp_your_token_here

3. Or set the environment variable in your shell:
   PowerShell:  $env:DENO_KV_ACCESS_TOKEN="ddp_your_token_here"
   Bash:        export DENO_KV_ACCESS_TOKEN="ddp_your_token_here"
================================================================================
`);
    Deno.exit(1);
  }

  if (!token.startsWith("ddp_")) {
    console.warn(`
⚠️  WARNING: The provided token does not start with "ddp_".
Deno Deploy KV remote access requires a Personal Access Token created at:
  https://dash.deno.com/user/access-tokens

Tokens from project settings or deploy tokens will fail with "Invalid token".
`);
  }
}

function printConnectionTroubleshooting(errMsg: string, url: string | undefined): void {
  console.error(`
================================================================================
❌ DENO KV CONNECTION / AUTHENTICATION FAILED
================================================================================
Error details: ${errMsg}

Troubleshooting "Invalid token" or Connection Failure:
1. Did you use a Personal Access Token?
   KV remote access strictly requires a Personal Access Token created at:
   👉 https://dash.deno.com/user/access-tokens
   (Project tokens from project settings do NOT have KV connection permissions)

2. Token prefix check:
   Personal access tokens always start with "ddp_".

3. Passing via PowerShell:
   Pass the token directly with --token:
   deno task reset:kv "${url || "https://api.deno.com/databases/<id>/connect"}" --token=ddp_your_token

4. Database URL check:
   Ensure the URL matches the connection string from your project's KV dashboard:
   https://api.deno.com/databases/<database-id>/connect
================================================================================
`);
}

// 4. Open KV Connection
console.log(`Connecting to: ${targetUrl || "local default KV"}...`);
let kv: Deno.Kv;

try {
  kv = await Deno.openKv(targetUrl);
} catch (err: unknown) {
  const errMsg = err instanceof Error ? err.message : String(err);
  if (isRemote) {
    printConnectionTroubleshooting(errMsg, targetUrl);
  } else {
    console.error(`\n❌ Failed to open KV: ${errMsg}`);
  }
  Deno.exit(1);
}

// 5. Execute Safe Purge
console.log("Safely purging only Workflow Builder MCP keys...");
console.log("(Other applications sharing this KV database are strictly preserved)\n");

try {
  const result = await purgeWorkflowMcpData(kv);
  try {
    kv.close();
  } catch {
    // Ignore close errors
  }

  console.log(`================================================================================`);
  console.log(`✅ RESET COMPLETE`);
  console.log(`================================================================================`);
  console.log(`Deleted ${result.deletedCount} workflow-builder-mcp keys.`);
  if (result.prefixesPurged.length > 0) {
    console.log(`Purged prefixes: ${result.prefixesPurged.join(", ")}`);
  } else {
    console.log(`Database was already clean (0 workflow keys found).`);
  }
  console.log(`All other application data in this database remains intact.`);
  console.log(`================================================================================\n`);
} catch (err: unknown) {
  try {
    kv.close();
  } catch {
    // Ignore close errors
  }
  const errMsg = err instanceof Error ? err.message : String(err);
  if (isRemote) {
    printConnectionTroubleshooting(errMsg, targetUrl);
  } else {
    console.error(`\n❌ Error during purge: ${errMsg}`);
  }
  Deno.exit(1);
}

