/**
 * Static discovery, health check, user profile, and Web Dashboard route handlers.
 */

import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { getOAuthConfig } from "../auth/oauth.ts";
import type { AuthResult } from "../auth/oauth.ts";
import { listUserPasskeys } from "../auth/passkey.ts";
import { BaseLayout } from "../views/layouts/BaseLayout.tsx";
import { renderHtmlResponse } from "../views/ssr.ts";
import { DashboardApp } from "../views/dashboard/DashboardApp.tsx";
import { errorResponse, getWwwAuthenticateHeader, jsonResponse } from "./common.ts";

/**
 * Legacy HTML string generator maintained for backward compatibility.
 */
export function renderDashboardHtml(origin: string): string {
  return renderToString(
    h(BaseLayout, {
      title: "Workflow MCP — Serverless Remote Server",
      children: h(DashboardApp, { origin }),
    }),
  );
}

export async function handleStaticRoutes(
  req: Request,
  url: URL,
  auth: AuthResult | null,
): Promise<Response | null> {
  const path = url.pathname;
  const method = req.method.toUpperCase();

  // Static Assets (Public)
  if (path.startsWith("/static/") && method === "GET") {
    const decoded = decodeURIComponent(path);
    if (decoded.includes("..")) {
      return errorResponse("Forbidden", 403);
    }
    try {
      const relPath = "." + path;
      const content = await Deno.readTextFile(relPath);
      const ext = path.split(".").pop()?.toLowerCase();
      const contentType = ext === "js"
        ? "application/javascript; charset=utf-8"
        : ext === "css"
        ? "text/css; charset=utf-8"
        : ext === "json"
        ? "application/json; charset=utf-8"
        : ext === "svg"
        ? "image/svg+xml"
        : "text/plain; charset=utf-8";
      return new Response(content, {
        status: 200,
        headers: {
          "content-type": contentType,
          "cache-control": "public, max-age=3600",
        },
      });
    } catch {
      return errorResponse("Static file not found", 404);
    }
  }

  // Health Probe (Public)
  if (path === "/health" && method === "GET") {
    return jsonResponse({
      status: "ok",
      server: "workflow-mcp",
      version: "1.0.0",
      uptime: performance.now(),
      timestamp: new Date().toISOString(),
      passkeysEnabled: true,
      oauthConfigured: Boolean(getOAuthConfig()),
    });
  }

  // Discovery / Homepage with Passkeys & Dashboard (Public)
  if (path === "/" && method === "GET") {
    if (req.headers.get("accept")?.includes("application/json")) {
      return jsonResponse({
        status: "ok",
        server: "workflow-mcp",
        version: "1.0.0",
        uptime: performance.now(),
        timestamp: new Date().toISOString(),
        passkeysEnabled: true,
        oauthConfigured: Boolean(getOAuthConfig()),
        endpoints: {
          tasks: `${url.origin}/tasks`,
          tasksApi: `${url.origin}/api/tasks`,
          mcp: `${url.origin}/mcp`,
          health: `${url.origin}/health`,
          authPasskey: `${url.origin}/auth/passkey/*`,
        },
      });
    }
    return renderHtmlResponse(
      h(DashboardApp, {
        origin: url.origin,
        user: auth?.user ?? (auth?.userId ? { userId: auth.userId } : null),
        authMethod: auth?.authMethod,
      }),
      { title: "Workflow MCP — Serverless Remote Server" },
    );
  }

  // User Profile Endpoint
  if (path === "/api/me" && method === "GET") {
    if (!auth) {
      return errorResponse(
        "Unauthorized. Please log in or provide Bearer token.",
        401,
        getWwwAuthenticateHeader(url.origin),
      );
    }
    const passkeys = await listUserPasskeys(auth.userId);
    return jsonResponse({
      authenticated: true,
      userId: auth.userId,
      authMethod: auth.authMethod,
      user: auth.user,
      passkeysCount: passkeys.length,
    });
  }

  return null;
}
