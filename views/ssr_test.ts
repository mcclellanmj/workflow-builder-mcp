import { assertEquals, assertStringIncludes } from "@std/assert";
import { h } from "preact";
import { renderHtmlResponse } from "./ssr.ts";
import { BaseLayout } from "./layouts/BaseLayout.tsx";

Deno.test("renderHtmlResponse - renders component wrapped in BaseLayout", () => {
  const vnode = h("div", { class: "text-red-500 font-bold" }, "Hello Preact Twind");
  const res = renderHtmlResponse(vnode, { title: "Test Page" });

  assertEquals(res.status, 200);
  assertEquals(res.headers.get("content-type"), "text/html; charset=utf-8");
  assertEquals(res.headers.get("x-content-type-options"), "nosniff");
  assertEquals(res.headers.get("x-frame-options"), "SAMEORIGIN");
  assertEquals(res.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
});

Deno.test("renderHtmlResponse - extracts CSS and includes doctype", async () => {
  const vnode = h(BaseLayout, { title: "Custom Layout" }, [
    h("span", { class: "bg-blue-600 text-white p-2" }, "Extracted Content"),
  ]);
  const res = renderHtmlResponse(vnode, { status: 201 });

  assertEquals(res.status, 201);
  const text = await res.text();
  assertStringIncludes(text, "<!DOCTYPE html>");
  assertStringIncludes(text, '<html lang="en" class="dark">');
  assertStringIncludes(text, "<title>Custom Layout</title>");
  assertStringIncludes(text, '<style id="__twind">');
  assertStringIncludes(text, "Extracted Content");
});
