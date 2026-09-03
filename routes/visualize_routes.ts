/**
 * Server-Side Rendered (SSR) Visualization and Share Ticket HTTP Route Handlers.
 */

import { h } from "preact";
import { renderToString } from "preact-render-to-string";
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
import { BaseLayout } from "../views/layouts/BaseLayout.tsx";
import { renderHtmlResponse } from "../views/ssr.ts";
import { ErrorCard } from "../views/visualize/ErrorCard.tsx";
import { CORS_HEADERS, errorResponse, getWwwAuthenticateHeader, jsonResponse } from "./common.ts";

export const revokedTickets = new Set<string>([
  "7b5c86c68aeb4ee7a8c5b24682d98c8f",
]);

export function revokeTicket(ticketId: string): void {
  revokedTickets.add(ticketId.trim());
}

/**
 * Legacy HTML string generator maintained for backward compatibility.
 */
export function renderExpiredTicketHtml(origin: string): string {
  return renderToString(
    h(BaseLayout, {
      title: "Link Expired — Workflow Visualizer",
      children: h(ErrorCard, { variant: "expired", actionHref: `${origin}/` }),
    }),
  );
}

/**
 * Legacy HTML string generator maintained for backward compatibility.
 */
export function renderUnauthorizedHtml(origin: string): string {
  return renderToString(
    h(BaseLayout, {
      title: "Unauthorized — Workflow Visualizer",
      children: h(ErrorCard, { variant: "unauthorized", actionHref: `${origin}/` }),
    }),
  );
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
      return renderHtmlResponse(
        h(ErrorCard, {
          variant: "expired",
          actionHref: `${url.origin}/`,
        }),
        {
          status: 403,
          headers: CORS_HEADERS,
          title: "Link Expired — Workflow Visualizer",
        },
      );
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
      return renderHtmlResponse(
        h(ErrorCard, {
          variant: "expired",
          actionHref: `${url.origin}/`,
        }),
        {
          status: 403,
          headers: CORS_HEADERS,
          title: "Link Expired — Workflow Visualizer",
        },
      );
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
      return renderHtmlResponse(
        h(ErrorCard, {
          variant: "unauthorized",
          actionHref: `${url.origin}/`,
        }),
        {
          status: 401,
          headers: {
            ...CORS_HEADERS,
            ...getWwwAuthenticateHeader(url.origin),
          },
          title: "Unauthorized — Workflow Visualizer",
        },
      );
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
