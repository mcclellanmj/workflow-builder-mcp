import { assertEquals, assertStringIncludes } from "@std/assert";
import { h } from "preact";
import { renderHtmlResponse } from "./ssr.ts";
import { MemoryCard } from "./memory/MemoryCard.tsx";
import { MemoryVault } from "./memory/MemoryVault.tsx";

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
