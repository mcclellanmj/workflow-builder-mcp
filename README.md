# Workflow MCP Server

A Model Context Protocol (MCP) server for designing, validating, executing, and visualizing
structured workflows, Directed Acyclic Graphs (DAGs), gated review-fix loops, subworkflows, and
human-in-the-loop interactions. Powered by Deno and Deno KV for lightweight local persistence.

---

## Features

- **Workflow & Graph Management**: Create, list, inspect, and delete workflow graphs with arbitrary
  node-and-edge topologies.
- **Rich Node Types**: Supports `start`, `step`, `decision`, `subworkflow`, `user_interaction`, and
  `end` nodes.
- **Graph Validation & Heuristics**: Validates graph connectivity, reachability, start/end node
  constraints, and loops. Offers structural suggestions such as loop encapsulation and linear chain
  extraction.
- **Interactive & Multi-Project Execution**: Execute workflows step-by-step with state isolation,
  branch conditions, iteration tracking, and guardrails against infinite loops.
- **Mermaid Visualization**: Export visual Mermaid diagrams of workflow states and graphs.
- **Export & Import Bundles**: Export full workflows with recursive subworkflows and execution runs
  into portable JSON bundles, and import/clone with automatic ID remapping and DAG validation.
- **Multi-Audience Formatting**: Outputs formatted markdown for user review and structured JSON
  payloads for AI assistants.

---

## Prerequisites

- [Deno](https://deno.land/) (v1.40+ or v2.0+) installed and available in your `PATH`.
  ```bash
  # Check your Deno installation
  deno --version
  ```

---

## How to Load in Cursor

You can configure Cursor to connect to this MCP server using either the Cursor Settings UI or a
configuration file.

### Option 1: Using Cursor Settings UI

1. Open **Cursor**.
2. Go to **Settings** (`Cmd + ,` on macOS or `Ctrl + ,` on Windows/Linux) $\rightarrow$ **Features**
   $\rightarrow$ **MCP**.
3. Click **"+ Add New MCP Server"**.
4. Fill in the details:
   - **Name**: `workflow-mcp`
   - **Type**: `command` (stdio)
   - **Command**:
     ```bash
     deno run --unstable-kv --allow-read --allow-write /Users/Shared/workflow-mcp/main.ts
     ```
5. Click **Add** or **Save**. Cursor will start the server over stdio and discover all tools.

---

### Option 2: Using `mcp.json`

Add the server configuration to your global Cursor MCP configuration file (`~/.cursor/mcp.json`) or
to your workspace configuration (`.cursor/mcp.json`):

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
        "/Users/Shared/workflow-mcp/main.ts"
      ]
    }
  }
}
```

> **Tip**: If `deno` is not in Cursor's environment PATH, use the absolute path to your Deno binary
> (e.g. `/Users/<your-user>/.deno/bin/deno` or `/opt/homebrew/bin/deno`).

---

## Setup in Claude Desktop

Add the following to your `claude_desktop_config.json` (located at
`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

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
        "/Users/Shared/workflow-mcp/main.ts"
      ]
    }
  }
}
```

---

## Available MCP Tools

| Tool                           | Description                                                                           |
| :----------------------------- | :------------------------------------------------------------------------------------ |
| `workflow_create`              | Create a new named workflow.                                                          |
| `workflow_list`                | List all workflows with metadata and status.                                          |
| `workflow_get`                 | Retrieve full workflow details (nodes and edges).                                     |
| `workflow_delete`              | Atomically delete a workflow and all associated nodes/edges.                          |
| `node_add`                     | Add a node (`start`, `step`, `decision`, `subworkflow`, `user_interaction`, `end`).   |
| `node_edit`                    | Edit an existing node's name, description, type, or config.                           |
| `node_delete`                  | Delete a node and its attached edges.                                                 |
| `node_get`                     | Retrieve detailed node info.                                                          |
| `node_list`                    | List all nodes in a workflow.                                                         |
| `node_connect`                 | Connect two nodes with an optional branch condition.                                  |
| `node_disconnect`              | Remove an edge between nodes.                                                         |
| `workflow_start`               | Begin an execution run instance and return initial actionable steps.                  |
| `workflow_next`                | Complete a node and advance the execution run along outbound edges.                   |
| `workflow_reset`               | Reset an execution run back to initial state.                                         |
| `workflow_validate`            | Validate workflow DAG integrity, cycle rules, and heuristics.                         |
| `workflow_visualize`           | Generate static Mermaid diagrams or export rich interactive HTML visualizers to file. |
| `workflow_extract_subworkflow` | Extract a chain of nodes into an independent child subworkflow.                       |
| `workflow_export`              | Export a workflow graph as a portable JSON bundle (bundles subworkflows & history).   |
| `workflow_import`              | Import a workflow bundle with ID remapping/cloning, overwrite, and validation.        |

---

## Development

```bash
# Run unit tests
deno task test

# Run tests with code coverage
deno task test:coverage

# Start server in watch mode for development
deno task dev

# Type check, lint, and format check
deno task check
```

---

## License

MIT
