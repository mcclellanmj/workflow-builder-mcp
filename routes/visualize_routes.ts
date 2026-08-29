/**
 * Server-Side Rendered (SSR) Visualization and Share Ticket HTTP Route Handlers.
 */

import { safeGetEnv } from "../env.ts";
import { authenticateRequest } from "../auth/oauth.ts";
import type { AuthResult } from "../auth/oauth.ts";
import { generateSsrVisualizerHtml } from "../mcp/ssr_visualizer.ts";
import {
  deleteViewTicket,
  exportWorkflowBundle,
  getExecution,
  getViewTicket,
} from "../store/kv.ts";
import type { ViewTicket } from "../store/types.ts";
import { hydrateNodesWithExecution } from "../mcp/helpers.ts";
import { CORS_HEADERS, errorResponse, getWwwAuthenticateHeader, jsonResponse } from "./common.ts";

export const revokedTickets = new Set<string>();

export function revokeTicket(ticketId: string): void {
  revokedTickets.add(ticketId.trim());
}

function renderExpiredTicketHtml(origin: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Link Expired — Workflow Visualizer</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #0f172a;
      color: #f8fafc;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      padding: 20px;
    }
    .card {
      background: #1e293b;
      border: 1px solid #475569;
      border-radius: 12px;
      padding: 32px;
      max-width: 480px;
      text-align: center;
      box-shadow: 0 10px 25px rgba(0,0,0,0.5);
    }
    h1 { font-size: 1.5rem; margin-bottom: 12px; color: #f87171; }
    p { color: #94a3b8; line-height: 1.6; margin-bottom: 20px; font-size: 0.95rem; }
    .btn {
      display: inline-block;
      background: #0284c7;
      color: white;
      text-decoration: none;
      padding: 10px 20px;
      border-radius: 6px;
      font-weight: 600;
      font-size: 0.9rem;
    }
    .btn:hover { background: #0ea5e9; }
  </style>
</head>
<body>
  <div class="card">
    <h1>⏳ Share Link Expired</h1>
    <p>
      This visualization link has reached its expiration time and is no longer active.
      To view this workflow, please request a new share link or run the <code>workflow_visualize</code> tool again.
    </p>
    <a href="${origin}/" class="btn">Go to Dashboard</a>
  </div>
</body>
</html>`;
}

function renderUnauthorizedHtml(origin: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Unauthorized — Workflow Visualizer</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #0f172a;
      color: #f8fafc;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      padding: 20px;
    }
    .card {
      background: #1e293b;
      border: 1px solid #475569;
      border-radius: 12px;
      padding: 32px;
      max-width: 480px;
      text-align: center;
      box-shadow: 0 10px 25px rgba(0,0,0,0.5);
    }
    h1 { font-size: 1.5rem; margin-bottom: 12px; color: #f59e0b; }
    p { color: #94a3b8; line-height: 1.6; margin-bottom: 20px; font-size: 0.95rem; }
    .btn {
      display: inline-block;
      background: #0284c7;
      color: white;
      text-decoration: none;
      padding: 10px 20px;
      border-radius: 6px;
      font-weight: 600;
      font-size: 0.9rem;
    }
    .btn:hover { background: #0ea5e9; }
  </style>
</head>
<body>
  <div class="card">
    <h1>🔒 Access Restricted</h1>
    <p>
      Viewing this workflow requires a valid share ticket, active Passkey login session, or Bearer token.
    </p>
    <a href="${origin}/" class="btn">Sign In with Passkey</a>
  </div>
</body>
</html>`;
}

export async function handleVisualizeRoutes(
  req: Request,
  url: URL,
  auth: AuthResult | null,
): Promise<Response | null> {
  const path = url.pathname;
  const method = req.method.toUpperCase();

  // Match /visualize/:workflowId, /visualize/view/:ticketId, /visualize, or /api/visualize/tickets/:ticketId
  const isVisualizePage = path === "/visualize" || path.startsWith("/visualize/");
  const isApiData = path.startsWith("/api/visualize/") && path.endsWith("/data");
  const isTicketManagement = path.startsWith("/api/visualize/tickets/");

  if (!isVisualizePage && !isApiData && !isTicketManagement) {
    return null;
  }

  // DELETE /api/visualize/tickets/:ticketId - Revoke and delete ticket
  if (isTicketManagement && method === "DELETE") {
    const ticketToDelete = path.replace("/api/visualize/tickets/", "").trim();
    if (!ticketToDelete) {
      return errorResponse("Ticket ID is required.", 400);
    }
    revokeTicket(ticketToDelete);
    await deleteViewTicket(ticketToDelete);
    return jsonResponse({ success: true, message: `Ticket "${ticketToDelete}" has been revoked.` });
  }

  if (method !== "GET") {
    return errorResponse("Method Not Allowed", 405);
  }

  let ticketId = url.searchParams.get("ticket");
  let workflowId: string | undefined;

  if (path.startsWith("/visualize/view/")) {
    ticketId = path.replace("/visualize/view/", "").split("/")[0];
  } else if (isApiData) {
    workflowId = path.replace("/api/visualize/", "").replace(/\/data$/, "");
  } else if (path.startsWith("/visualize/")) {
    workflowId = path.replace("/visualize/", "").split("/")[0];
  }

  // Fast revocation check before any KV lookup
  if (ticketId) {
    const disabledEnv = safeGetEnv("DISABLED_TICKETS") || safeGetEnv("REVOKED_TICKETS") || "";
    const isRevoked = revokedTickets.has(ticketId) ||
      disabledEnv.split(",").map((t) => t.trim()).filter(Boolean).includes(ticketId);

    if (isRevoked) {
      if (isApiData) {
        return errorResponse("Ticket has been revoked.", 403);
      }
      return new Response(renderExpiredTicketHtml(url.origin), {
        status: 403,
        headers: { "content-type": "text/html; charset=utf-8", ...CORS_HEADERS },
      });
    }
  }

  if (!workflowId && url.searchParams.has("workflowId")) {
    workflowId = url.searchParams.get("workflowId")!;
  }

  let resolvedUserId: string | null = null;
  let resolvedTicket: ViewTicket | null = null;
  let activeExecutionId = url.searchParams.get("executionId") || undefined;

  // 1. Resolve authentication via Share Ticket
  if (ticketId) {
    const ticket = await getViewTicket(ticketId);
    if (!ticket) {
      if (isApiData) {
        return errorResponse("View ticket is expired or invalid.", 403);
      }
      return new Response(renderExpiredTicketHtml(url.origin), {
        status: 403,
        headers: { "content-type": "text/html; charset=utf-8", ...CORS_HEADERS },
      });
    }

    resolvedTicket = ticket;
    resolvedUserId = ticket.userId;
    workflowId = ticket.workflowId;
    if (!activeExecutionId && ticket.executionId) {
      activeExecutionId = ticket.executionId;
    }
  } else {
    // 2. Direct access without ticket requires user authentication
    const effectiveAuth = auth || (await authenticateRequest(req));
    if (!effectiveAuth) {
      if (isApiData) {
        return errorResponse(
          "Unauthorized. Please log in or provide Bearer token.",
          401,
          getWwwAuthenticateHeader(url.origin),
        );
      }
      return new Response(renderUnauthorizedHtml(url.origin), {
        status: 401,
        headers: {
          "content-type": "text/html; charset=utf-8",
          ...CORS_HEADERS,
          ...getWwwAuthenticateHeader(url.origin),
        },
      });
    }
    resolvedUserId = effectiveAuth.userId;
  }

  if (!workflowId) {
    return errorResponse("Workflow ID is required.", 400);
  }

  // 3. Load Workflow Bundle
  const bundle = await exportWorkflowBundle(workflowId, {
    includeSubworkflows: true,
    includeExecutions: true,
    userId: resolvedUserId!,
  });

  if (!bundle) {
    return errorResponse(`Workflow "${workflowId}" was not found.`, 404);
  }

  // Hydrate execution if active
  if (activeExecutionId) {
    const exec = await getExecution(activeExecutionId, resolvedUserId!);
    if (exec) {
      bundle.workflow.nodes = hydrateNodesWithExecution(bundle.workflow.nodes, exec);
    }
  }

  // Return API Data for Polling
  if (isApiData) {
    return jsonResponse({
      workflow: bundle.workflow,
      subworkflows: bundle.subworkflows,
      activeExecutionId,
    });
  }

  // Return SSR HTML Page
  const html = generateSsrVisualizerHtml({
    bundle,
    activeExecutionId,
    viewTicket: resolvedTicket,
    serverOrigin: url.origin,
    isStandaloneFile: false,
  });

  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-cache, no-store, must-revalidate",
      ...CORS_HEADERS,
    },
  });
}
