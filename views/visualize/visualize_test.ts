import { assertEquals, assertStringIncludes } from "@std/assert";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { ErrorCard } from "./ErrorCard.tsx";
import { VisualizerFrame } from "./VisualizerFrame.tsx";
import { renderHtmlResponse } from "../ssr.ts";

Deno.test("ErrorCard - renders expired variant correctly", () => {
  const html = renderToString(h(ErrorCard, { variant: "expired" }));
  assertStringIncludes(html, "Share Link Expired");
  assertStringIncludes(html, "Go to Dashboard");
  assertStringIncludes(html, "This visualization link has reached its expiration time");
});

Deno.test("ErrorCard - renders unauthorized variant correctly", () => {
  const html = renderToString(h(ErrorCard, { variant: "unauthorized" }));
  assertStringIncludes(html, "Access Restricted");
  assertStringIncludes(html, "Sign In with Passkey");
  assertStringIncludes(html, "Viewing this workflow requires a valid share ticket");
});

Deno.test("ErrorCard - renders custom title, description, and action button", () => {
  const html = renderToString(
    h(ErrorCard, {
      variant: "error",
      title: "Custom Failed Title",
      description: "Custom failure details",
      actionHref: "/custom-dash",
      actionText: "Back Home",
    }),
  );
  assertStringIncludes(html, "Custom Failed Title");
  assertStringIncludes(html, "Custom failure details");
  assertStringIncludes(html, "/custom-dash");
  assertStringIncludes(html, "Back Home");
});

Deno.test("VisualizerFrame - renders header, canvas shell, controls, and legend", () => {
  const html = renderToString(
    h(VisualizerFrame, {
      workflowName: "Deploy Pipeline",
      workflowId: "wf-123",
      isStandalone: true,
      ticketInfo: {
        ticketId: "t-abc",
        expiresAt: Date.now() + 3600000,
        isActive: true,
      },
      showLegend: true,
    }),
  );

  // Header & Metadata
  assertStringIncludes(html, "Deploy Pipeline");
  assertStringIncludes(html, 'id="display-title"');
  assertStringIncludes(html, 'id="ticket-badge"');
  assertStringIncludes(html, 'id="ticket-timer"');

  // Controls & Search
  assertStringIncludes(html, 'id="node-search"');
  assertStringIncludes(html, 'id="status-filter"');
  assertStringIncludes(html, 'id="layout-toggle-btn"');
  assertStringIncludes(html, 'id="fit-btn"');
  assertStringIncludes(html, 'id="export-png-btn"');

  // Canvas shell & toolbar
  assertStringIncludes(html, 'id="cy-container"');
  assertStringIncludes(html, 'id="cy"');
  assertStringIncludes(html, 'id="zoom-in-btn"');
  assertStringIncludes(html, 'id="zoom-out-btn"');
  assertStringIncludes(html, 'id="reset-zoom-btn"');
  assertStringIncludes(html, 'id="lock-toggle-btn"');

  // Legend
  assertStringIncludes(html, "Completed");
  assertStringIncludes(html, "Running");
  assertStringIncludes(html, "Pending");
  assertStringIncludes(html, "Failed");

  // Inspector
  assertStringIncludes(html, 'id="inspector"');
  assertStringIncludes(html, 'id="insp-name"');
  assertStringIncludes(html, 'id="toast"');
});

Deno.test("VisualizerFrame - renders with active selected node in inspector", () => {
  const html = renderToString(
    h(VisualizerFrame, {
      workflowName: "Data Ingestion",
      selectedNode: {
        id: "node-1",
        name: "Process Batch",
        type: "agent",
        status: "failed",
        isSubagent: true,
        prompt: "Run ingestion algorithm with batchSize=50",
        error: "Connection timeout to upstream cluster",
        iterationCount: 3,
        history: [{ iteration: 1, status: "running" }, { iteration: 2, status: "failed" }],
        hasSubworkflow: true,
        subworkflowId: "sub-99",
      },
    }),
  );

  assertStringIncludes(html, "Process Batch");
  assertStringIncludes(html, "Run ingestion algorithm with batchSize=50");
  assertStringIncludes(html, "Connection timeout to upstream cluster");
  assertStringIncludes(html, "Drill Down into Subworkflow");
  assertStringIncludes(html, "Iter: 3");
  assertStringIncludes(html, "Sub-Agent");
});

Deno.test("ErrorCard & VisualizerFrame - SSR response integration with BaseLayout", async () => {
  const res = renderHtmlResponse(
    h(ErrorCard, { variant: "expired" }),
    { title: "Expired Link" },
  );
  assertEquals(res.status, 200);
  const text = await res.text();
  assertStringIncludes(text, "<!DOCTYPE html>");
  assertStringIncludes(text, "<title>Expired Link</title>");
  assertStringIncludes(text, "Share Link Expired");
  assertStringIncludes(text, '<style id="__twind">');
});
