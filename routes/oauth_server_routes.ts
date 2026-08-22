/**
 * OAuth 2.1 Authorization Server endpoints, RFC 9728 Protected Resource Metadata,
 * RFC 8414 Authorization Server Metadata, RFC 7591 Dynamic Client Registration,
 * interactive Passkey-integrated authorization UI, and token exchange handlers.
 */

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
import {
  errorResponse,
  escapeHtml,
  getWwwAuthenticateHeader,
  isValidRedirectUri,
  jsonResponse,
} from "./common.ts";

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
  const {
    clientId,
    clientName,
    redirectUri,
    scope,
    state,
    codeChallenge,
    codeChallengeMethod,
    auth,
    oauthConfigured,
  } = params;

  const safeClientName = escapeHtml(clientName);
  const safeClientId = escapeHtml(clientId);
  const safeRedirectUri = escapeHtml(redirectUri);
  const safeScope = escapeHtml(scope);
  const safeState = escapeHtml(state || "");
  const safeCodeChallenge = escapeHtml(codeChallenge);
  const safeCodeChallengeMethod = escapeHtml(codeChallengeMethod || "S256");
  const safeUserName = escapeHtml(auth?.user?.name || auth?.userId || "");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Authorize ${safeClientName} — Workflow MCP</title>
  <style>
    :root {
      --primary: #2563eb;
      --primary-hover: #1d4ed8;
      --bg: #f8fafc;
      --card-bg: #ffffff;
      --text: #0f172a;
      --text-muted: #64748b;
      --border: #e2e8f0;
      --success: #10b981;
      --danger: #ef4444;
    }
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; max-width: 540px; margin: 40px auto; padding: 0 20px; line-height: 1.5; color: var(--text); background: var(--bg); }
    h1 { font-size: 1.5rem; margin-top: 0; margin-bottom: 8px; display: flex; align-items: center; gap: 8px; }
    p { margin-top: 0; color: var(--text-muted); font-size: 0.95rem; }
    .card { background: var(--card-bg); border: 1px solid var(--border); border-radius: 12px; padding: 28px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
    .client-badge { display: inline-flex; align-items: center; gap: 6px; background: #eff6ff; color: #1e40af; border: 1px solid #dbeafe; padding: 6px 12px; border-radius: 8px; font-weight: 600; font-size: 0.95rem; margin-bottom: 16px; }
    .scope-box { background: #f1f5f9; border-radius: 8px; padding: 12px 16px; margin: 16px 0; font-size: 0.88rem; color: #334155; }
    .scope-item { display: flex; align-items: center; gap: 8px; margin: 4px 0; }
    .input-group { margin-bottom: 16px; }
    label { display: block; font-size: 0.88rem; font-weight: 600; margin-bottom: 6px; color: #334155; }
    input[type="text"] { width: 100%; padding: 10px 14px; border: 1px solid var(--border); border-radius: 8px; font-size: 1rem; outline: none; }
    input[type="text"]:focus { border-color: var(--primary); box-shadow: 0 0 0 3px rgba(37,99,235,0.15); }
    .btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; background: var(--primary); color: white; border: none; padding: 12px 20px; border-radius: 8px; font-size: 1rem; font-weight: 600; cursor: pointer; transition: background 0.15s; text-decoration: none; width: 100%; }
    .btn:hover { background: var(--primary-hover); }
    .btn-secondary { background: #f1f5f9; color: #475569; border: 1px solid var(--border); margin-top: 8px; }
    .btn-secondary:hover { background: #e2e8f0; color: #1e293b; }
    .alert { padding: 12px 16px; border-radius: 8px; margin-bottom: 16px; font-size: 0.9rem; }
    .alert-error { background: #fee2e2; color: #991b1b; border: 1px solid #fecaca; }
    .alert-success { background: #d1fae5; color: #065f46; border: 1px solid #a7f3d0; }
    .tabs { display: flex; gap: 8px; border-bottom: 1px solid var(--border); margin-bottom: 20px; }
    .tab { padding: 8px 12px; font-weight: 600; font-size: 0.88rem; cursor: pointer; border-bottom: 2px solid transparent; color: var(--text-muted); }
    .tab.active { color: var(--primary); border-bottom-color: var(--primary); }
    .hidden { display: none !important; }
    .user-info { display: flex; align-items: center; justify-content: space-between; background: #f8fafc; border: 1px solid var(--border); padding: 10px 14px; border-radius: 8px; margin-bottom: 16px; font-size: 0.9rem; }
    .user-tag { font-weight: 600; color: #0f172a; }
  </style>
</head>
<body>
  <div class="card">
    <h1>🔐 Authorize Connection</h1>
    <div class="client-badge">
      <span>⚡</span>
      <span>${safeClientName}</span>
    </div>
    <p>A Model Context Protocol (MCP) client is requesting access to execute and manage workflows on your server.</p>

    <div id="alertBox" class="alert hidden"></div>

    <div class="scope-box">
      <div class="scope-item">
        <span>✓</span>
        <span>Read, design, validate, and execute workflows (<strong>${safeScope}</strong>)</span>
      </div>
      <div class="scope-item">
        <span>✓</span>
        <span>Multi-tenant user scoped data isolation</span>
      </div>
    </div>

    ${
    auth
      ? `
    <!-- User Already Authenticated -->
    <div class="user-info">
      <span>Connected as:</span>
      <span class="user-tag">👤 ${safeUserName}</span>
    </div>

    <form id="consentForm" method="POST" action="/oauth/authorize">
      <input type="hidden" name="approve" value="true" />
      <input type="hidden" name="client_id" value="${safeClientId}" />
      <input type="hidden" name="redirect_uri" value="${safeRedirectUri}" />
      <input type="hidden" name="scope" value="${safeScope}" />
      <input type="hidden" name="state" value="${safeState}" />
      <input type="hidden" name="code_challenge" value="${safeCodeChallenge}" />
      <input type="hidden" name="code_challenge_method" value="${safeCodeChallengeMethod}" />
      
      <button type="submit" class="btn" id="authorizeBtn">
        <span>🚀</span> Authorize ${safeClientName}
      </button>
      <a href="${safeRedirectUri}${safeRedirectUri.includes("?") ? "&" : "?"}error=access_denied${
        state ? `&state=${encodeURIComponent(state)}` : ""
      }" class="btn btn-secondary">
        Cancel / Deny
      </a>
    </form>
    `
      : `
    <!-- User Needs To Sign In First (Passkey WebAuthn) -->
    <div class="tabs">
      <div class="tab active" onclick="switchTab('login')">🔑 Sign In with Passkey</div>
      <div class="tab" onclick="switchTab('register')">✨ Create Passkey</div>
    </div>

    <!-- Login Tab -->
    <div id="loginTab">
      <p>Touch your fingerprint sensor (Touch ID), Face ID, or Windows Hello to authenticate and grant access.</p>
      <div class="input-group">
        <label for="loginUsername">Username (Optional)</label>
        <input type="text" id="loginUsername" placeholder="e.g. alice (or leave empty for Touch ID)" />
      </div>
      <button class="btn" onclick="signInAndAuthorize()">
        <span>👆</span> Sign In & Authorize with Passkey
      </button>
    </div>

    <!-- Register Tab -->
    <div id="registerTab" class="hidden">
      <p>Register a new Passkey tied to your device to secure your workflows.</p>
      <div class="input-group">
        <label for="regUsername">Choose Username *</label>
        <input type="text" id="regUsername" placeholder="e.g. alice" required />
      </div>
      <button class="btn" onclick="registerAndAuthorize()">
        <span>🔐</span> Create Passkey & Authorize
      </button>
    </div>

    ${
        oauthConfigured
          ? `
    <div style="margin-top: 18px; text-align: center; border-top: 1px solid var(--border); padding-top: 14px;">
      <p style="font-size: 0.85rem; margin-bottom: 8px;">Or sign in via OAuth Provider:</p>
      <a href="/oauth/signin" class="btn btn-secondary">
        Sign In with GitHub / Google
      </a>
    </div>
    `
          : ""
      }
    `
  }
  </div>

  <script>
    const clientId = ${JSON.stringify(clientId).replace(/</g, "\\u003c")};
    const redirectUri = ${JSON.stringify(redirectUri).replace(/</g, "\\u003c")};
    const scope = ${JSON.stringify(scope).replace(/</g, "\\u003c")};
    const state = ${JSON.stringify(state || "").replace(/</g, "\\u003c")};
    const codeChallenge = ${JSON.stringify(codeChallenge).replace(/</g, "\\u003c")};
    const codeChallengeMethod = ${
    JSON.stringify(codeChallengeMethod || "S256").replace(/</g, "\\u003c")
  };

    function showAlert(msg, isError = true) {
      const alertBox = document.getElementById("alertBox");
      alertBox.textContent = msg;
      alertBox.className = "alert " + (isError ? "alert-error" : "alert-success");
      alertBox.classList.remove("hidden");
    }

    function switchTab(tab) {
      document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
      document.getElementById("loginTab").classList.add("hidden");
      document.getElementById("registerTab").classList.add("hidden");
      if (tab === "login") {
        document.querySelectorAll(".tab")[0].classList.add("active");
        document.getElementById("loginTab").classList.remove("hidden");
      } else {
        document.querySelectorAll(".tab")[1].classList.add("active");
        document.getElementById("registerTab").classList.remove("hidden");
      }
    }

    function bufferToBase64Url(buffer) {
      const bytes = new Uint8Array(buffer);
      let binary = "";
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      return btoa(binary).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, "");
    }

    function base64UrlToBuffer(base64url) {
      let base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
      while (base64.length % 4) base64 += "=";
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes.buffer;
    }

    async function finishAuthorization() {
      try {
        const res = await fetch("/oauth/authorize", {
          method: "POST",
          headers: { "content-type": "application/json", "accept": "application/json" },
          body: JSON.stringify({
            approve: true,
            client_id: clientId,
            redirect_uri: redirectUri,
            scope: scope,
            state: state,
            code_challenge: codeChallenge,
            code_challenge_method: codeChallengeMethod
          })
        });
        const data = await res.json();
        if (data.redirect) {
          window.location.href = data.redirect;
        } else if (data.code) {
          const sep = redirectUri.includes("?") ? "&" : "?";
          window.location.href = redirectUri + sep + "code=" + encodeURIComponent(data.code) + (state ? "&state=" + encodeURIComponent(state) : "");
        } else {
          showAlert(data.error || "Failed to complete authorization.", true);
        }
      } catch (err) {
        showAlert("Authorization error: " + err.message, true);
      }
    }

    async function signInAndAuthorize() {
      try {
        const username = document.getElementById("loginUsername")?.value.trim() || undefined;
        const optRes = await fetch("/auth/passkey/login-options", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ username })
        });
        if (!optRes.ok) throw new Error(await optRes.text());
        const { options, challengeId } = await optRes.json();

        options.challenge = base64UrlToBuffer(options.challenge);
        if (options.allowCredentials) {
          options.allowCredentials = options.allowCredentials.map(c => ({
            ...c,
            id: base64UrlToBuffer(c.id)
          }));
        }

        const cred = await navigator.credentials.get({ publicKey: options });
        if (!cred) throw new Error("No credential returned.");

        const payload = {
          id: cred.id,
          rawId: bufferToBase64Url(cred.rawId),
          type: cred.type,
          response: {
            authenticatorData: bufferToBase64Url(cred.response.authenticatorData),
            clientDataJSON: bufferToBase64Url(cred.response.clientDataJSON),
            signature: bufferToBase64Url(cred.response.signature),
            userHandle: cred.response.userHandle ? bufferToBase64Url(cred.response.userHandle) : null
          }
        };

        const verifyRes = await fetch("/auth/passkey/login-verify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ challengeId, response: payload })
        });
        if (!verifyRes.ok) throw new Error(await verifyRes.text());

        showAlert("Passkey verified! Redirecting to client...", false);
        await finishAuthorization();
      } catch (err) {
        showAlert(err.message, true);
      }
    }

    async function registerAndAuthorize() {
      try {
        const username = document.getElementById("regUsername")?.value.trim();
        if (!username) {
          showAlert("Please enter a username.", true);
          return;
        }

        const optRes = await fetch("/auth/passkey/register-options", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ username, displayName: username })
        });
        if (!optRes.ok) throw new Error(await optRes.text());
        const { options, challengeId } = await optRes.json();

        options.challenge = base64UrlToBuffer(options.challenge);
        options.user.id = base64UrlToBuffer(options.user.id);
        if (options.excludeCredentials) {
          options.excludeCredentials = options.excludeCredentials.map(c => ({
            ...c,
            id: base64UrlToBuffer(c.id)
          }));
        }

        const cred = await navigator.credentials.create({ publicKey: options });
        if (!cred) throw new Error("Passkey creation cancelled.");

        const payload = {
          id: cred.id,
          rawId: bufferToBase64Url(cred.rawId),
          type: cred.type,
          response: {
            attestationObject: bufferToBase64Url(cred.response.attestationObject),
            clientDataJSON: bufferToBase64Url(cred.response.clientDataJSON),
          }
        };

        const verifyRes = await fetch("/auth/passkey/register-verify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ challengeId, response: payload })
        });
        if (!verifyRes.ok) throw new Error(await verifyRes.text());

        showAlert("Passkey registered! Authorizing...", false);
        await finishAuthorization();
      } catch (err) {
        showAlert(err.message, true);
      }
    }
  </script>
</body>
</html>`;
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

    return new Response(
      renderOAuthAuthorizeHtml({
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
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
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
