# Workflow MCP Server

A Model Context Protocol (MCP) server for designing, validating, executing, and visualizing
structured workflows, Directed Acyclic Graphs (DAGs), gated review-fix loops, subworkflows, and
human-in-the-loop interactions.

Equipped with **multi-tenant user-scoped persistence**, **Passkey (Touch ID / Face ID / Windows
Hello) biometric authentication (0 third-party setup required)**, and **stateless serverless HTTP
transport** ready for deployment on Deno Deploy or any serverless runtime.

---

## Features

- **Zero UUID Lookup Overhead (Name, Slug, & Path Resolution)**:
  - Reference workflows and nodes by **UUID**, **Name**, **Slug**, or **Hierarchical Path** (e.g.
    `workflow_get({ workflow: "review-workflow/security" })`,
    `node_edit({ workflow: "review-workflow", node: "Step 5-web", ... })`).
- **Cross-Workflow Search (`workflow_search`)**:
  - Instantly search across all standalone workflows and nested subworkflows for keywords, phrases,
    or boolean expressions (`authentication OR passkey`) with contextual line excerpts.
- **Atomic Multi-Node Updates (`workflow_patch`)**:
  - Batch edit multiple nodes in a single atomic tool call, eliminating sequential roundtrip tool
    call overhead.
- **Recursive Hierarchical View (`workflow_tree`)**:
  - Recursively expand and display complete subworkflow hierarchies up to configurable depth in
    formatted ASCII diagrams and structured JSON.
- **Standard MCP OAuth 2.1 Authorization & Discovery (Zero Bearer Token Config)**:
  - Full implementation of official Model Context Protocol (MCP) OAuth 2.1 authorization standard
    (**RFC 9728 Protected Resource Metadata, RFC 8414 Authorization Server Metadata, RFC 7591
    Dynamic Client Registration, and RFC 7636 PKCE**).
  - Connect Claude Desktop, Cursor, Antigravity, and AI agents by specifying only the server URL —
    zero manual copy-pasting of API tokens into configuration files.
- **Zero 3rd-Party Biometric Authentication (Passkeys / WebAuthn)**:
  - Sign in or register in 1-click using native **Touch ID, Face ID, Windows Hello, or hardware
    security keys** in the browser.
  - Zero developer consoles, zero client secrets, zero 3rd-party dependencies.
  - Generates persistent **Bearer API Tokens** (`wf_...`) for headless scripts and CI/CD pipelines.
- **Serverless-First Stateless HTTP Transport**:
  - **Stateless HTTP JSON-RPC (`POST /mcp` / `POST /`)**: Designed specifically for serverless
    architectures (Deno Deploy, Cloudflare, Lambda) with no persistent socket or connection state
    overhead.
- **Multi-Tenant User Isolation**: All workflows, nodes, edges, and executions are scoped by
  `userId` in Deno KV (`["users", userId, ...]`).
- **Workflow & Graph Management**: Create, list, inspect, patch, search, tree, and delete workflow
  graphs with arbitrary topologies.
- **Rich Node Types**: Supports `start`, `step`, `decision`, `subworkflow`, `user_interaction`, and
  `end` nodes.
- **Graph Validation & Heuristics**: Validates graph connectivity, reachability, start/end node
  constraints, and loops. Offers structural suggestions such as loop encapsulation and linear chain
  extraction.
- **Interactive & Multi-Project Execution**: Execute workflows step-by-step with state isolation,
  branch conditions, iteration tracking, and guardrails against infinite loops.
- **Mermaid & Interactive HTML Visualization**: Export visual Mermaid diagrams of workflow states
  and interactive HTML dashboards with Server-Side Rendered (SSR) vector graphics and zero external
  CDN scripts.
- **Export & Import Bundles**: Export full workflows with recursive subworkflows and execution runs
  into portable JSON bundles with automatic ID remapping.

---

## Quick Start (Local Development)

### 1. Run Local HTTP Server

```bash
# Start the HTTP serverless MCP server on port 8000
deno task serve

# Or in watch mode for development
deno task dev:server
```

Visit `http://localhost:8000` in your browser to test Passkey biometric sign-in and token
generation!

### 2. Run Local Stdio CLI Mode (for local IDEs)

```bash
deno task dev
```

---

## Serverless Remote Deployment (Deno Deploy)

Deploying to [Deno Deploy](https://deno.com/deploy) takes just seconds with built-in zero-config
Deno KV.

### 1. Deploy via GitHub or `deployctl`

```bash
# Install deployctl if needed
deno install -Arf jsr:@deno/deployctl

# Deploy directly
deployctl deploy --project=workflow-mcp --entrypoint=http_server.ts
```

### 2. Environment Variables

| Variable               | Description                                                            |
| :--------------------- | :--------------------------------------------------------------------- |
| `PORT`                 | HTTP port (defaults to `8000`).                                        |
| `ALLOW_HEADER_AUTH`    | Set to `1` to enable `X-User-Id` header authentication in testing/dev. |
| `GITHUB_CLIENT_ID`     | (Optional) GitHub OAuth App Client ID.                                 |
| `GITHUB_CLIENT_SECRET` | (Optional) GitHub OAuth App Client Secret.                             |
| `GOOGLE_CLIENT_ID`     | (Optional) Google OAuth Client ID.                                     |
| `GOOGLE_CLIENT_SECRET` | (Optional) Google OAuth Client Secret.                                 |

---

## Client Configuration

You can connect your AI assistant (Claude Desktop, Cursor, Antigravity, Windsurf, Roo Code, etc.)
using either **Remote Serverless HTTP Mode** or **Local CLI / Stdio Mode**.

---

### Option A: Remote Serverless Mode (Standard OAuth 2.1 / Zero Config)

Connect Claude Desktop, Cursor, Antigravity, or other MCP clients to your remote instance. **No
manual Bearer tokens or headers are required in your config file!**

The server natively implements the **Model Context Protocol OAuth 2.1 Specification** (RFC 9728
Protected Resource Metadata, RFC 8414 Authorization Server Metadata, RFC 7591 Dynamic Client
Registration, and RFC 7636 PKCE).

When you first connect, your MCP client will automatically trigger the standard browser
authorization flow. Authenticate in 1 click using your **Passkey (Touch ID / Face ID / Windows
Hello)** and grant access instantly.

#### 1. Claude Desktop (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "workflow-mcp": {
      "url": "https://your-domain.deno.dev/mcp"
    }
  }
}
```

#### 2. Cursor (`.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "workflow-mcp": {
      "url": "https://your-domain.deno.dev/mcp"
    }
  }
}
```

#### 3. Antigravity / Gemini CLI (`mcp_config.json`)

```json
{
  "mcpServers": {
    "workflow-mcp": {
      "url": "https://your-domain.deno.dev/mcp"
    }
  }
}
```

> [!TIP]
> **CLI Scripts & CI/CD Pipelines (Manual API Tokens)**: If configuring headless automation or CI/CD
> pipelines without a browser, you can still generate static Bearer tokens (`wf_...`) via the web
> dashboard at `https://your-domain.deno.dev` and pass
> `"headers": { "Authorization": "Bearer wf_your_token" }`.

---

### Option B: Local CLI / Stdio Mode

Run the MCP server directly on your local machine over standard I/O (stdio) with local Deno KV
storage. Zero server deployment or network setup required.

#### 1. Claude Desktop (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "workflow-mcp": {
      "command": "deno",
      "args": [
        "run",
        "--unstable-kv",
        "--allow-read",
        "--allow-write",
        "--allow-env",
        "/absolute/path/to/workflow-mcp/main.ts"
      ]
    }
  }
}
```

#### 2. Cursor (`.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "workflow-mcp": {
      "command": "deno",
      "args": [
        "run",
        "--unstable-kv",
        "--allow-read",
        "--allow-write",
        "--allow-env",
        "/absolute/path/to/workflow-mcp/main.ts"
      ]
    }
  }
}
```

#### 3. Antigravity / Gemini CLI (`mcp_config.json`)

```json
{
  "mcpServers": {
    "workflow-mcp": {
      "command": "deno",
      "args": [
        "run",
        "--unstable-kv",
        "--allow-read",
        "--allow-write",
        "--allow-env",
        "/absolute/path/to/workflow-mcp/main.ts"
      ]
    }
  }
}
```

---

## Available MCP Tools

| Tool                           | Description                                                                                          |
| :----------------------------- | :--------------------------------------------------------------------------------------------------- |
| `workflow_create`              | Create a new named workflow in the user's scope.                                                     |
| `workflow_list`                | List all workflows with metadata and status for current user.                                        |
| `workflow_get`                 | Retrieve full workflow details (nodes and edges), with optional subworkflow bundle.                  |
| `workflow_search`              | Cross-workflow keyword/boolean search across names, prompts, descriptions, configs.                  |
| `workflow_patch`               | Batch atomic updates for multiple nodes in a workflow graph in one call.                             |
| `workflow_tree`                | Recursive hierarchical ASCII and JSON view of nested child subworkflows.                             |
| `workflow_delete`              | Atomically delete a workflow and all associated nodes/edges.                                         |
| `node_add`                     | Add a node (`start`, `step`, `decision`, `subworkflow`, `user_interaction`, `end`).                  |
| `node_edit`                    | Edit an existing node's name, description, type, or config.                                          |
| `node_delete`                  | Delete a node and its attached edges.                                                                |
| `node_get`                     | Retrieve detailed node info.                                                                         |
| `node_list`                    | List all nodes in a workflow.                                                                        |
| `node_connect`                 | Connect two nodes with an optional branch condition.                                                 |
| `node_disconnect`              | Remove an edge between nodes.                                                                        |
| `workflow_hydrate`             | Hydrate workflow template into an actionable Epic and Task DAG with ready frontier.                  |
| `workflow_validate`            | Validate workflow DAG integrity, cycle rules, and heuristics.                                        |
| `workflow_visualize`           | Generate static Mermaid diagrams or export rich interactive HTML visualizers.                        |
| `workflow_extract_subworkflow` | Extract a chain of nodes into an independent child subworkflow.                                      |
| `workflow_export`              | Export a workflow graph as a portable JSON bundle.                                                   |
| `workflow_import`              | Import a workflow bundle with ID remapping/cloning, overwrite, and validation.                       |
| `task_ready`                   | Compute the claimable ready frontier of tasks with zero unresolved blockers.                         |
| `task_claim`                   | Atomically claim a ready task to prevent duplicate concurrent work.                                  |
| `task_create`                  | Create assignable tasks or epics with roles, priorities, parent-child nesting, and pipelines.        |
| `task_create_batch`            | Batch create multiple tasks and wire internal dependencies in one atomic call with pipeline support. |
| `task_list`                    | List tasks filtered by workflow, role, assignee, or status.                                          |
| `task_get`                     | Retrieve full task details, blocking dependencies, and child subtasks.                               |
| `task_update`                  | Update task details, status, or append progress notes.                                               |
| `task_close`                   | Complete a task and automatically unblock downstream tasks in the DAG.                               |
| `task_depend`                  | Wire or remove dependency edges (`blocks`, `waits-for`, `conditional-blocks`).                       |
| `task_comment`                 | Append a lightweight log comment (max 256 characters) to a task.                                     |
| `pipeline_template_create`     | Create a reusable multi-stage flow template with role transitions and validation.                    |
| `pipeline_template_list`       | List registered flow templates.                                                                      |
| `pipeline_template_get`        | Retrieve full pipeline template details.                                                             |
| `task_pipeline_attach`         | Attach a pipeline template to an existing task.                                                      |
| `task_pipeline_override`       | Manually override stage transition on a task pipeline.                                               |
| `task_pipeline_status`         | Inspect current pipeline stage and allowed transitions.                                              |
| `role_create`                  | Define a user-defined role with description.                                                         |
| `role_list`                    | List all registered user-defined roles for the current user.                                         |
| `journal_write`                | Save single-entry role shutdown snapshot and next steps.                                             |
| `journal_read`                 | Read the role's latest journal entry on session wakeup.                                              |
| `memory_save`                  | Save persistent memory scoped to a workflow, node, or role.                                          |
| `memory_list`                  | List memory summaries with lastAccessed and accessCount tracking.                                    |
| `memory_recall`                | Retrieve full content and log a memory access record.                                                |
| `memory_delete`                | Delete a memory and return its lifetime access count.                                                |
| `memory_search`                | Full-text search across memories with BM25 vector ranking.                                           |
| `task_handoff`                 | Transfer task between agents preserving context and rejected approaches.                             |
| `context_prime`                | Bootstrap session with role journal, scoped memories, and ready frontier tasks.                      |

---

## Development & Testing

```bash
# Run full unit and integration test suite
deno task test

# Run tests with code coverage
deno task test:coverage

# Type check, lint, and format check
deno task check
```

---

## License

MIT
