# Agent Instructions

This project uses **Workflow MCP** as the primary task tracker, backed by the local KV store.

## Primary Task Tracking: Workflow MCP

All tasks, features, bugs, investigations, and subagent work must be tracked durably using the
**Workflow MCP** tools (`task_create`, `task_claim`, `task_update`, `task_close`, `task_handoff`,
`task_pipeline_*`).

### Invariant: Pre-Created Task Records for All Subagents

- **Every subagent invocation requires a pre-created task record in Workflow MCP.**
- **Research is a Task**: No subagent (including research subagents or one-off helper agents) may be
  spawned without an existing `taskId` in Workflow MCP.
- Subagents must claim their assigned task immediately upon activation via
  `task_claim({ taskId, assignee, role })`.

### Quick Reference (Workflow MCP)

```typescript
task_create({ title: "...", role: "developer", pipelineTemplateId: "dev-qa-arch" })
task_claim({ taskId: "tk-...", assignee: "developer", role: "developer" })
task_handoff({ action: "advance", taskId: "tk-...", reason: "...", ... })
task_close({ taskId: "tk-...", reason: "..." })
journal_write({ role: "developer", entry: "..." })
memory_save({ key: "...", role: "developer", value: ... })
```

## Non-Interactive Shell Commands

**ALWAYS use non-interactive flags** with file operations to avoid hanging on confirmation prompts.

Shell commands like `cp`, `mv`, and `rm` may be aliased to include `-i` (interactive) mode on some
systems, causing the agent to hang indefinitely waiting for y/n input.

**Use these forms instead:**

```bash
# Force overwrite without prompting
cp -f source dest           # NOT: cp source dest
mv -f source dest           # NOT: mv source dest
rm -f file                  # NOT: rm file

# For recursive operations
rm -rf directory            # NOT: rm -r directory
cp -rf source dest          # NOT: cp -r source dest
```

**Other commands that may prompt:**

- `scp` - use `-o BatchMode=yes` for non-interactive
- `ssh` - use `-o BatchMode=yes` to fail instead of prompting
- `apt-get` - use `-y` flag
- `brew` - use `HOMEBREW_NO_AUTO_UPDATE=1` env var

## Secondary / Legacy Issue Tracking (Beads)

Beads (`bd`) is retained for optional git/Dolt issue synchronization if explicitly requested. For
all day-to-day development, feature tracking, pipelines, and subagent orchestration, use **Workflow
MCP**.
