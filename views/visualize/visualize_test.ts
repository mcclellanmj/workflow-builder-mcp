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

Deno.test("VisualizerFrame - renders barrier join badge, decision rules, subworkflow references and waiting_for_children", () => {
  const html = renderToString(
    h(VisualizerFrame, {
      workflowName: "Decision & Barrier Workflow",
      selectedNode: {
        id: "node-dec-1",
        name: "Route Quality Gate",
        type: "decision",
        status: "waiting_for_children",
        joinPolicy: "m_of_n",
        joinThreshold: 2,
        hasSubworkflow: true,
        subworkflowId: "sub-audit-flow",
        decisionConfig: {
          field: "reviewStatus",
          map: { approved: "prod-deploy", rejected: "rework" },
          numericRules: [{ op: ">", value: 80, condition: "fast-track" }],
          default: "manual-review",
        },
      },
    }),
  );

  // Status & Legend
  assertStringIncludes(html, "Waiting for Children");
  assertStringIncludes(html, "waiting_for_children");

  // Barrier join badge
  assertStringIncludes(html, 'id="insp-barrier-badge"');
  assertStringIncludes(html, "Barrier: m_of_n (2)");

  // Subworkflow badge & drilldown button
  assertStringIncludes(html, 'id="insp-subworkflow-badge"');
  assertStringIncludes(html, "Subworkflow");
  assertStringIncludes(html, "sub-audit-flow");
  assertStringIncludes(html, "Drill Down into Subworkflow");

  // Decision Rules & Maps
  assertStringIncludes(html, 'id="insp-decision-rules-card"');
  assertStringIncludes(html, "Decision Rules &amp; Maps");
  assertStringIncludes(html, "field: reviewStatus");
  assertStringIncludes(html, "approved");
  assertStringIncludes(html, "prod-deploy");
  assertStringIncludes(html, "rejected");
  assertStringIncludes(html, "> 80");
  assertStringIncludes(html, "fast-track");
  assertStringIncludes(html, "manual-review");
});

Deno.test("VisualizerFrame - renders Message Board panel with messages, filters, and counter", () => {
  const html = renderToString(
    h(VisualizerFrame, {
      workflowName: "Execution Board",
      activeTab: "messages",
      messages: [
        {
          id: "msg-1",
          executionId: "exec-101",
          workflowId: "wf-101",
          taskId: "tk-feat-42",
          nodeId: "node-impl",
          author: "developer-bot",
          role: "developer",
          topic: "review_feedback",
          content: "Refactored database pool connections per architect review.",
          createdAt: "2026-09-25T20:00:00.000Z",
        },
      ],
    }),
  );

  // Header button & count
  assertStringIncludes(html, 'id="msg-board-toggle-btn"');
  assertStringIncludes(html, 'id="header-msg-count"');
  assertStringIncludes(html, 'id="tab-btn-messages"');

  // Filter inputs
  assertStringIncludes(html, 'id="msg-filter-task"');
  assertStringIncludes(html, 'id="msg-filter-role"');
  assertStringIncludes(html, 'id="msg-filter-topic"');

  // Rendered Message Card
  assertStringIncludes(html, 'id="msg-board-list"');
  assertStringIncludes(html, "developer-bot");
  assertStringIncludes(html, "@developer");
  assertStringIncludes(html, "#review_feedback");
  assertStringIncludes(html, "tk-feat-42");
  assertStringIncludes(html, "Refactored database pool connections per architect review.");
});

