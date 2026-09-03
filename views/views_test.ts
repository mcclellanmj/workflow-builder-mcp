import { assertEquals, assertStringIncludes } from "@std/assert";
import { h } from "preact";
import { renderHtmlResponse } from "./ssr.ts";
import { MemoryCard } from "./memory/MemoryCard.tsx";
import { MemoryVault } from "./memory/MemoryVault.tsx";
import { JournalEntryCard } from "./journal/JournalEntryCard.tsx";
import { JournalView } from "./journal/JournalView.tsx";

Deno.test("MemoryCard - renders key, role badge, timestamp, and actions", async () => {
  const vnode = h(MemoryCard, {
    memory: {
      id: "mem-test-1",
      key: "config.database_url",
      roleId: "developer",
      summary: "Primary PostgreSQL connection string",
      content: JSON.stringify({ host: "localhost", port: 5432 }),
      tags: ["database", "postgres"],
      accessCount: 5,
      createdAt: "2026-09-03T10:00:00.000Z",
    },
  });

  const res = renderHtmlResponse(vnode, { title: "Memory Card Test" });
  assertEquals(res.status, 200);
  const text = await res.text();
  assertStringIncludes(text, "config.database_url");
  assertStringIncludes(text, "@developer");
  assertStringIncludes(text, "Primary PostgreSQL connection string");
  assertStringIncludes(text, "database");
  assertStringIncludes(text, "5");
  assertStringIncludes(text, "Copy");
});

Deno.test("MemoryVault - renders search, filters, metrics, and cards grid", async () => {
  const vnode = h(MemoryVault, {
    memories: [
      {
        id: "mem-test-2",
        key: "system.env",
        roleId: "architect",
        summary: "Environment config",
        content: "production",
        scope: "role",
        accessCount: 12,
      },
    ],
    availableRoles: ["developer", "architect"],
  });

  const res = renderHtmlResponse(vnode, { title: "Memory Vault Test" });
  assertEquals(res.status, 200);
  const text = await res.text();
  assertStringIncludes(text, "Memory Vault &amp; Explorer");
  assertStringIncludes(text, "system.env");
  assertStringIncludes(text, "@architect");
  assertStringIncludes(text, "All Roles");
  assertStringIncludes(text, "New Memory");
});

Deno.test("JournalEntryCard - renders role avatar, timestamp, body, and tags", async () => {
  const vnode = h(JournalEntryCard, {
    entry: {
      id: "entry-1",
      role: "developer",
      writtenBy: "agent-dev",
      entry: "Completed component tests and verified rendering.",
      timestamp: "2026-09-03T11:00:00.000Z",
      tags: ["frontend", "preact"],
    },
  });

  const res = renderHtmlResponse(vnode, { title: "Journal Entry Card Test" });
  assertEquals(res.status, 200);
  const text = await res.text();
  assertStringIncludes(text, "@developer");
  assertStringIncludes(text, "agent-dev");
  assertStringIncludes(text, "Completed component tests and verified rendering.");
  assertStringIncludes(text, "#frontend");
  assertStringIncludes(text, "Copy");
});

Deno.test("JournalView - renders role tabs, search bar, and entries list", async () => {
  const vnode = h(JournalView, {
    entries: [
      {
        id: "entry-2",
        role: "developer",
        entry: "Task tk-d250ed completed successfully.",
        timestamp: "2026-09-03T12:00:00.000Z",
      },
    ],
    roles: [{ name: "developer" }, { name: "reviewer" }],
    activeRoleTab: "all",
  });

  const res = renderHtmlResponse(vnode, { title: "Journal View Test" });
  assertEquals(res.status, 200);
  const text = await res.text();
  assertStringIncludes(text, "Engineering Role Journals");
  assertStringIncludes(text, "All Roles");
  assertStringIncludes(text, "@developer");
  assertStringIncludes(text, "Task tk-d250ed completed successfully.");
  assertStringIncludes(text, "Write Entry");
});
