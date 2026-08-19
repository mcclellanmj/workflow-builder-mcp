# Workflow MCP Server

A Model Context Protocol (MCP) server for designing, validating, executing, and visualizing
structured workflows, Directed Acyclic Graphs (DAGs), gated review-fix loops, subworkflows, and
human-in-the-loop interactions.

Equipped with **multi-tenant user-scoped persistence**, **Passkey (Touch ID / Face ID / Windows
Hello) biometric authentication (0 third-party setup required)**, and **serverless HTTP / SSE
transports** ready for deployment on Deno Deploy or any serverless runtime.

---

## Features

- **Zero 3rd-Party Biometric Authentication (Passkeys / WebAuthn)**:
  - Sign in or register in 1-click using native **Touch ID, Face ID, Windows Hello, or hardware
    security keys** in the browser.
  - Zero developer consoles, zero client secrets, zero 3rd-party dependencies.
  - Generates persistent **Bearer API Tokens** (`wf_...`) in 1-click to connect Claude Desktop,
    Cursor, and CLI agents to your scoped workflows.
- **Serverless-First HTTP Transports**:
  - **Stateless HTTP JSON-RPC (`POST /mcp` / `POST /`)**: Designed specifically for serverless
    architectures (Deno Deploy, Cloudflare, Lambda) with no persistent socket overhead.
  - **Streamable SSE (`GET /sse` + `POST /message`)**: Standard MCP Server-Sent Events transport.
- **Multi-Tenant User Isolation**: All workflows, nodes, edges, and executions are scoped by
  `userId` in Deno KV (`["users", userId, ...]`).
- **Optional OAuth 2.0 Fallback**: Supports standard OAuth (GitHub / Google) via `@deno/kv-oauth` if
  external OAuth is desired.
- **Workflow & Graph Management**: Create, list, inspect, and delete workflow graphs with arbitrary
  topologies.
- **Rich Node Types**: Supports `start`, `step`, `decision`, `subworkflow`, `user_interaction`, and
  `end` nodes.
- **Graph Validation & Heuristics**: Validates graph connectivity, reachability, start/end node
  constraints, and loops. Offers structural suggestions such as loop encapsulation and linear chain
  extraction.
- **Interactive & Multi-Project Execution**: Execute workflows step-by-step with state isolation,
  branch conditions, iteration tracking, and guardrails against infinite loops.
- **Mermaid & Interactive HTML Visualization**: Export visual Mermaid diagrams of workflow states
  and interactive HTML dashboards.
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

### 1. Generate Your API Token

1. Open your deployed URL in your browser (`https://your-domain.deno.dev`).
2. Register or Sign In with your **Touch ID / Face ID / Passkey**.
3. Click **"⚡ Generate New API Token"** and copy your token (`wf_...`).

### 2. Connect Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "workflow-mcp": {
      "url": "https://your-domain.deno.dev/mcp",
      "headers": {
        "Authorization": "Bearer wf_your_api_token"
      }
    }
  }
}
```

### 3. Connect Cursor

In `.cursor/mcp.json` or Cursor Settings $\rightarrow$ Features $\rightarrow$ MCP:

```json
{
  "mcpServers": {
    "workflow-mcp": {
      "url": "https://your-domain.deno.dev/mcp",
      "headers": {
        "Authorization": "Bearer wf_your_api_token"
      }
    }
  }
}
```

---

## API & Endpoints

| Endpoint                         | Method   | Description                                         |
| :------------------------------- | :------- | :-------------------------------------------------- |
| `/`                              | `GET`    | Discovery & Passkey Authentication Dashboard.       |
| `/health`                        | `GET`    | Health probe.                                       |
| `/auth/passkey/register-options` | `POST`   | WebAuthn registration options.                      |
| `/auth/passkey/register-verify`  | `POST`   | Verify WebAuthn registration & create session.      |
| `/auth/passkey/login-options`    | `POST`   | WebAuthn authentication options.                    |
| `/auth/passkey/login-verify`     | `POST`   | Verify WebAuthn signature & create session.         |
| `/mcp` or `/`                    | `POST`   | Stateless JSON-RPC 2.0 MCP protocol endpoint.       |
| `/sse`                           | `GET`    | Server-Sent Events stream for standard MCP clients. |
| `/message`                       | `POST`   | Message receiver for active SSE sessions.           |
| `/api/me`                        | `GET`    | Current user profile and auth status.               |
| `/api/token`                     | `POST`   | Generate a new Bearer API token.                    |
| `/api/tokens`                    | `GET`    | List active Bearer API tokens.                      |
| `/api/tokens/:id`                | `DELETE` | Revoke a Bearer API token.                          |

---

## Available MCP Tools

| Tool                           | Description                                                                         |
| :----------------------------- | :---------------------------------------------------------------------------------- |
| `workflow_create`              | Create a new named workflow in the user's scope.                                    |
| `workflow_list`                | List all workflows with metadata and status for current user.                       |
| `workflow_get`                 | Retrieve full workflow details (nodes and edges).                                   |
| `workflow_delete`              | Atomically delete a workflow and all associated nodes/edges.                        |
| `node_add`                     | Add a node (`start`, `step`, `decision`, `subworkflow`, `user_interaction`, `end`). |
| `node_edit`                    | Edit an existing node's name, description, type, or config.                         |
| `node_delete`                  | Delete a node and its attached edges.                                               |
| `node_get`                     | Retrieve detailed node info.                                                        |
| `node_list`                    | List all nodes in a workflow.                                                       |
| `node_connect`                 | Connect two nodes with an optional branch condition.                                |
| `node_disconnect`              | Remove an edge between nodes.                                                       |
| `workflow_start`               | Begin an execution run instance and return initial actionable steps.                |
| `workflow_next`                | Complete a node and advance the execution run along outbound edges.                 |
| `workflow_reset`               | Reset an execution run back to initial state.                                       |
| `workflow_validate`            | Validate workflow DAG integrity, cycle rules, and heuristics.                       |
| `workflow_visualize`           | Generate static Mermaid diagrams or export rich interactive HTML visualizers.       |
| `workflow_extract_subworkflow` | Extract a chain of nodes into an independent child subworkflow.                     |
| `workflow_export`              | Export a workflow graph as a portable JSON bundle.                                  |
| `workflow_import`              | Import a workflow bundle with ID remapping/cloning, overwrite, and validation.      |

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
