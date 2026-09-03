/**
 * OAuth 2.1 Authorization Server endpoints, RFC 9728 Protected Resource Metadata,
 * RFC 8414 Authorization Server Metadata, RFC 7591 Dynamic Client Registration,
 * interactive Passkey-integrated authorization UI, and token exchange handlers.
 */

import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import type { AuthResult } from "../auth/oauth.ts";
import { getOAuthConfig } from "../auth/oauth.ts";
import {
  createAuthorizationCode,
  exchangeAuthorizationCode,
  getOAuthClient,
  refreshOAuthToken,
  registerOAuthClient,
  revokeOAuthToken,
} from "../auth/oauth_server.ts";
import { BaseLayout } from "../views/layouts/BaseLayout.tsx";
import { renderHtmlResponse } from "../views/ssr.ts";
import { OAuthAuthorize } from "../views/auth/OAuthAuthorize.tsx";
import {
  errorResponse,
  getWwwAuthenticateHeader,
  isValidRedirectUri,
  jsonResponse,
} from "./common.ts";

/**
 * Legacy HTML string generator maintained for backward compatibility.
 */
export function renderOAuthAuthorizeHtml(params: {
  origin?: string;
  clientId: string;
  clientName: string;
  redirectUri: string;
  scope: string;
  state?: string;
  codeChallenge: string;
  codeChallengeMethod?: string;
  auth: AuthResult | null;
  oauthConfigured: boolean;
}): string {
  return renderToString(
    h(BaseLayout, {
      title: `Authorize ${params.clientName} — Workflow MCP`,
      children: h(OAuthAuthorize, params),
    }),
  );
}

/**
 * Handles all OAuth 2.1 Authorization Server endpoints:
 * - RFC 9728 Protected Resource Metadata (GET /.well-known/oauth-protected-resource)
 * - RFC 8414 Authorization Server Metadata (GET /.well-known/oauth-authorization-server, GET /.well-known/openid-configuration)
 * - RFC 7591 Dynamic Client Registration (POST /oauth/register)
 * - RFC 7636 Authorization Grant UI & Submission (GET /oauth/authorize, POST /oauth/authorize)
 * - RFC 6749 / RFC 7636 Token Exchange & Refresh (POST /oauth/token)
 * - RFC 7009 Token Revocation (POST /oauth/revoke)
 */
export async function handleOAuthServerRoutes(
  req: Request,
  url: URL,
  auth: AuthResult | null,
): Promise<Response | null> {
  const path = url.pathname;
  const method = req.method.toUpperCase();

  // 1. RFC 9728: Protected Resource Metadata
  if (
    (path === "/.well-known/oauth-protected-resource" ||
      path === "/.well-known/oauth-protected-resource/") && method === "GET"
  ) {
    const origin = url.origin;
    return jsonResponse({
      resource: origin,
      authorization_servers: [origin],
      scopes_supported: ["workflow", "read", "write"],
      bearer_methods_supported: ["header"],
    });
  }

  // 2. RFC 8414: Authorization Server Metadata & OpenID Configuration
  if (
    (path === "/.well-known/oauth-authorization-server" ||
      path === "/.well-known/oauth-authorization-server/" ||
      path === "/.well-known/openid-configuration" ||
      path === "/.well-known/openid-configuration/") && method === "GET"
  ) {
    const origin = url.origin;
    return jsonResponse({
      issuer: origin,
      authorization_endpoint: `${origin}/oauth/authorize`,
      token_endpoint: `${origin}/oauth/token`,
      registration_endpoint: `${origin}/oauth/register`,
      revocation_endpoint: `${origin}/oauth/revoke`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
      scopes_supported: ["workflow", "read", "write"],
    });
  }

  // 3. RFC 7591: Dynamic Client Registration
  if ((path === "/oauth/register" || path === "/register") && method === "POST") {
    try {
      const body = await req.json().catch(() => ({}));
      const client = await registerOAuthClient(body);
      return jsonResponse(
        {
          client_id: client.clientId,
          client_secret: client.clientSecret,
          client_name: client.clientName,
          redirect_uris: client.redirectUris,
          grant_types: client.grantTypes,
          response_types: client.responseTypes,
          token_endpoint_auth_method: client.tokenEndpointAuthMethod,
          client_id_issued_at: Math.floor(Date.now() / 1000),
        },
        201,
      );
    } catch (err) {
      return jsonResponse(
        {
          error: "invalid_client_metadata",
          error_description: err instanceof Error ? err.message : String(err),
        },
        400,
      );
    }
  }

  // 4. Authorization Endpoint (GET: Render Consent & Biometric Sign-in)
  if (path === "/oauth/authorize" && method === "GET") {
    const responseType = url.searchParams.get("response_type") || "code";
    const clientId = url.searchParams.get("client_id") || "claude-desktop";
    const redirectUri = url.searchParams.get("redirect_uri");
    const scope = url.searchParams.get("scope") || "workflow";
    const state = url.searchParams.get("state") || undefined;
    const codeChallenge = url.searchParams.get("code_challenge") || undefined;
    const codeChallengeMethod = url.searchParams.get("code_challenge_method") || "S256";

    if (!redirectUri || !isValidRedirectUri(redirectUri)) {
      return errorResponse("Missing or invalid 'redirect_uri' parameter.", 400);
    }

    const client = await getOAuthClient(clientId);
    if (!client) {
      return errorResponse("Invalid or unknown 'client_id'.", 400);
    }

    // If client has registered redirect URIs, enforce that redirectUri matches
    if (client.redirectUris.length > 0 && !client.redirectUris.includes(redirectUri)) {
      return errorResponse("The provided 'redirect_uri' is not registered for this client.", 400);
    }

    // OAuth 2.1 requires PKCE code_challenge
    if (!codeChallenge || codeChallenge.trim().length === 0) {
      return errorResponse("Missing required PKCE 'code_challenge' parameter.", 400);
    }

    if (codeChallengeMethod.toUpperCase() !== "S256") {
      return errorResponse("Only 'S256' code_challenge_method is supported under OAuth 2.1.", 400);
    }

    if (responseType !== "code") {
      const sep = redirectUri.includes("?") ? "&" : "?";
      return Response.redirect(
        `${redirectUri}${sep}error=unsupported_response_type${
          state ? `&state=${encodeURIComponent(state)}` : ""
        }`,
        302,
      );
    }

    const clientName = client.clientName || clientId;
    const oauthConfigured = Boolean(getOAuthConfig());

    return renderHtmlResponse(
      h(OAuthAuthorize, {
        origin: url.origin,
        clientId,
        clientName,
        redirectUri,
        scope,
        state,
        codeChallenge,
        codeChallengeMethod,
        auth,
        oauthConfigured,
      }),
      {
        title: `Authorize ${clientName} — Workflow MCP`,
      },
    );
  }

  // 5. Authorization Endpoint (POST: Process Approval & Issue Code)
  if (path === "/oauth/authorize" && method === "POST") {
    let body: Record<string, unknown> = {};
    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const formData = await req.formData();
      body = Object.fromEntries(formData.entries());
    } else {
      body = await req.json().catch(() => ({}));
    }

    const approve = body.approve === true || body.approve === "true";
    const clientId = String(body.client_id || "claude-desktop");
    const redirectUri = String(body.redirect_uri || "");
    const scope = String(body.scope || "workflow");
    const state = body.state ? String(body.state) : undefined;
    const codeChallenge = body.code_challenge ? String(body.code_challenge) : undefined;
    const codeChallengeMethod = body.code_challenge_method
      ? String(body.code_challenge_method)
      : "S256";

    if (!redirectUri || !isValidRedirectUri(redirectUri)) {
      return errorResponse("Missing or invalid 'redirect_uri'.", 400);
    }

    const client = await getOAuthClient(clientId);
    if (!client) {
      return errorResponse("Invalid or unknown 'client_id'.", 400);
    }

    if (client.redirectUris.length > 0 && !client.redirectUris.includes(redirectUri)) {
      return errorResponse("The provided 'redirect_uri' is not registered for this client.", 400);
    }

    if (!codeChallenge || codeChallenge.trim().length === 0) {
      return errorResponse("Missing required PKCE 'code_challenge' parameter.", 400);
    }

    if (!approve) {
      const sep = redirectUri.includes("?") ? "&" : "?";
      const redirectUrl = `${redirectUri}${sep}error=access_denied${
        state ? `&state=${encodeURIComponent(state)}` : ""
      }`;
      if (req.headers.get("accept")?.includes("application/json")) {
        return jsonResponse({ redirect: redirectUrl });
      }
      return Response.redirect(redirectUrl, 302);
    }

    if (!auth) {
      return jsonResponse(
        { error: "unauthorized", error_description: "Please sign in before authorizing." },
        401,
        getWwwAuthenticateHeader(url.origin),
      );
    }

    try {
      const code = await createAuthorizationCode({
        userId: auth.userId,
        clientId,
        redirectUri,
        codeChallenge,
        codeChallengeMethod,
        scope,
      });

      const sep = redirectUri.includes("?") ? "&" : "?";
      const redirectUrl = `${redirectUri}${sep}code=${encodeURIComponent(code)}${
        state ? `&state=${encodeURIComponent(state)}` : ""
      }`;

      if (req.headers.get("accept")?.includes("application/json")) {
        return jsonResponse({ redirect: redirectUrl, code });
      }

      return Response.redirect(redirectUrl, 302);
    } catch (err) {
      return errorResponse(err instanceof Error ? err.message : String(err), 400);
    }
  }

  // 6. Token Endpoint (POST /oauth/token)
  if (path === "/oauth/token" && method === "POST") {
    const body: Record<string, string> = {};
    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("application/x-www-form-urlencoded")) {
      const formData = await req.formData();
      for (const [k, v] of formData.entries()) {
        body[k] = String(v);
      }
    } else {
      const parsed = await req.json().catch(() => ({}));
      for (const [k, v] of Object.entries(parsed)) {
        body[k] = String(v);
      }
    }

    // Also parse Basic Auth header if present
    const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
    if (authHeader && authHeader.toLowerCase().startsWith("basic ")) {
      try {
        const decoded = atob(authHeader.slice(6).trim());
        const [hClientId] = decoded.split(":");
        if (hClientId && !body.client_id) {
          body.client_id = hClientId;
        }
      } catch {
        // Ignore base64 decode errors
      }
    }

    const grantType = body.grant_type;

    if (grantType === "authorization_code") {
      const code = body.code;
      const clientId = body.client_id;
      const redirectUri = body.redirect_uri;
      const codeVerifier = body.code_verifier;

      if (!code) {
        return jsonResponse(
          { error: "invalid_request", error_description: "Missing required 'code' parameter." },
          400,
        );
      }

      if (!codeVerifier) {
        return jsonResponse(
          {
            error: "invalid_request",
            error_description: "Missing mandatory PKCE 'code_verifier' parameter.",
          },
          400,
        );
      }

      try {
        const tokenResponse = await exchangeAuthorizationCode({
          code,
          clientId,
          redirectUri,
          codeVerifier,
        });
        return jsonResponse(tokenResponse, 200, {
          "Cache-Control": "no-store",
          "Pragma": "no-cache",
        });
      } catch (err) {
        return jsonResponse(
          {
            error: "invalid_grant",
            error_description: err instanceof Error ? err.message : String(err),
          },
          400,
        );
      }
    }

    if (grantType === "refresh_token") {
      const refreshToken = body.refresh_token;
      const clientId = body.client_id;

      if (!refreshToken) {
        return jsonResponse(
          {
            error: "invalid_request",
            error_description: "Missing required 'refresh_token' parameter.",
          },
          400,
        );
      }

      try {
        const tokenResponse = await refreshOAuthToken({
          refreshToken,
          clientId,
        });
        return jsonResponse(tokenResponse, 200, {
          "Cache-Control": "no-store",
          "Pragma": "no-cache",
        });
      } catch (err) {
        return jsonResponse(
          {
            error: "invalid_grant",
            error_description: err instanceof Error ? err.message : String(err),
          },
          400,
        );
      }
    }

    return jsonResponse(
      {
        error: "unsupported_grant_type",
        error_description:
          `Grant type '${grantType}' is not supported. Use 'authorization_code' or 'refresh_token'.`,
      },
      400,
    );
  }

  // 7. Revocation Endpoint (POST /oauth/revoke)
  if (path === "/oauth/revoke" && method === "POST") {
    let token = "";
    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const formData = await req.formData();
      token = String(formData.get("token") || "");
    } else {
      const body = await req.json().catch(() => ({}));
      token = String(body.token || "");
    }

    if (token) {
      await revokeOAuthToken(token);
    }

    return jsonResponse({ revoked: true });
  }

  return null;
}
