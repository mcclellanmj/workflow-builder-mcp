import { assertEquals, assertStringIncludes } from "@std/assert";
import { handleStaticRoutes } from "./static_routes.ts";
import { renderTaskKanbanHtml } from "./task_ui.ts";

Deno.test("Static Routes - Serves static assets correctly", async () => {
  // 1. Valid static file: task_app.js
  const req = new Request("http://localhost:8000/static/js/task_app.js", {
    method: "GET",
  });
  const url = new URL(req.url);
  const res = await handleStaticRoutes(req, url, null);

  assertEquals(res !== null, true);
  assertEquals(res!.status, 200);
  assertEquals(
    res!.headers.get("content-type"),
    "application/javascript; charset=utf-8",
  );
  const text = await res!.text();
  assertStringIncludes(text, "initTaskApp");
  assertStringIncludes(text, "loadTasks");
  assertStringIncludes(text, "loadMemories");
  assertStringIncludes(text, "loadJournals");
  assertStringIncludes(text, "copyMemoryContent");

  // 2. Nonexistent file returns 404
  const missingReq = new Request("http://localhost:8000/static/js/missing.js", {
    method: "GET",
  });
  const missingUrl = new URL(missingReq.url);
  const missingRes = await handleStaticRoutes(missingReq, missingUrl, null);
  assertEquals(missingRes !== null, true);
  assertEquals(missingRes!.status, 404);

  // 3. Path traversal attack returns 403
  const traversalUrl = new URL("http://localhost:8000/static/fake");
  Object.defineProperty(traversalUrl, "pathname", {
    value: "/static/../deno.json",
  });
  const traversalRes = await handleStaticRoutes(
    new Request("http://localhost:8000/static/fake"),
    traversalUrl,
    null,
  );
  assertEquals(traversalRes !== null, true);
  assertEquals(traversalRes!.status, 403);
});

Deno.test("Task UI - Renders modular task_app.js script tag", () => {
  const html = renderTaskKanbanHtml({
    origin: "http://localhost:8000",
    userId: "user_test",
    userName: "Test User",
    initialTab: "tasks",
  });

  assertStringIncludes(html, '<script src="/static/js/task_app.js"></script>');
  assertStringIncludes(html, 'globalThis.ORIGIN = "http://localhost:8000"');
  assertStringIncludes(html, 'globalThis.CURRENT_USER = "Test User"');
  assertStringIncludes(html, 'globalThis.currentTab = "tasks"');
});
