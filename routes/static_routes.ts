/**
 * Static discovery, health check, user profile, and Web Dashboard route handlers.
 */

import { getOAuthConfig } from "../auth/oauth.ts";
import type { AuthResult } from "../auth/oauth.ts";
import { listUserPasskeys } from "../auth/passkey.ts";
import { errorResponse, jsonResponse } from "./common.ts";

export function renderDashboardHtml(origin: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Workflow MCP — Serverless Remote Server</title>
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
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; max-width: 840px; margin: 30px auto; padding: 0 20px; line-height: 1.5; color: var(--text); background: var(--bg); }
    h1 { color: var(--text); font-size: 1.8rem; margin-bottom: 4px; display: flex; align-items: center; gap: 8px; }
    h2 { color: #334155; font-size: 1.25rem; margin-top: 0; margin-bottom: 12px; }
    p { margin-top: 0; color: var(--text-muted); }
    .card { background: var(--card-bg); border: 1px solid var(--border); border-radius: 12px; padding: 24px; margin: 18px 0; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
    .badge { display: inline-block; font-size: 0.75rem; font-weight: 600; padding: 4px 10px; border-radius: 9999px; background: #e0e7ff; color: #3730a3; }
    .badge-success { background: #d1fae5; color: #065f46; }
    .input-group { margin-bottom: 16px; }
    label { display: block; font-size: 0.88rem; font-weight: 600; margin-bottom: 6px; color: #334155; }
    input[type="text"] { width: 100%; padding: 10px 14px; border: 1px solid var(--border); border-radius: 8px; font-size: 1rem; outline: none; }
    input[type="text"]:focus { border-color: var(--primary); box-shadow: 0 0 0 3px rgba(37,99,235,0.15); }
    .btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; background: var(--primary); color: white; border: none; padding: 11px 20px; border-radius: 8px; font-size: 0.95rem; font-weight: 600; cursor: pointer; transition: background 0.15s; text-decoration: none; }
    .btn:hover { background: var(--primary-hover); }
    .btn-secondary { background: #e2e8f0; color: #334155; }
    .btn-secondary:hover { background: #cbd5e1; }
    .btn-danger { background: #fee2e2; color: #991b1b; }
    .btn-danger:hover { background: #fecaca; }
    .btn-row { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 12px; }
    pre { background: #0f172a; color: #f8fafc; padding: 16px; border-radius: 8px; overflow-x: auto; font-size: 0.85rem; position: relative; margin: 12px 0 0 0; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
    .copy-btn { position: absolute; top: 10px; right: 10px; background: #334155; color: white; border: none; padding: 5px 10px; border-radius: 6px; font-size: 0.75rem; cursor: pointer; }
    .copy-btn:hover { background: #475569; }
    .alert { padding: 12px 16px; border-radius: 8px; margin-bottom: 16px; font-size: 0.9rem; }
    .alert-error { background: #fee2e2; color: #991b1b; border: 1px solid #fecaca; }
    .alert-success { background: #d1fae5; color: #065f46; border: 1px solid #a7f3d0; }
    .tabs { display: flex; gap: 8px; border-bottom: 1px solid var(--border); margin-bottom: 20px; }
    .tab { padding: 8px 16px; font-weight: 600; font-size: 0.9rem; cursor: pointer; border-bottom: 2px solid transparent; color: var(--text-muted); }
    .tab.active { color: var(--primary); border-bottom-color: var(--primary); }
    .hidden { display: none !important; }
  </style>
</head>
<body>
  <h1>🚀 Workflow MCP Remote Server <span class="badge badge-success">Passkey Auth</span></h1>
  <p>Production serverless MCP service with biometric Touch ID / Face ID authentication and user-scoped persistence.</p>

  <!-- Notification Banner -->
  <div id="alertBox" class="alert hidden"></div>

  <!-- Unauthenticated Section: Passkey Login & Registration -->
  <div id="authSection" class="card">
    <div class="tabs">
      <div class="tab active" onclick="switchAuthTab('login')">🔑 Sign In with Passkey</div>
      <div class="tab" onclick="switchAuthTab('register')">✨ Create New Passkey</div>
    </div>

    <!-- Login Form -->
    <div id="loginTab">
      <p>Touch your fingerprint sensor (Touch ID), Face ID, or Windows Hello to sign in instantly.</p>
      <div class="input-group">
        <label for="loginUsername">Username (Optional for auto-discovery)</label>
        <input type="text" id="loginUsername" placeholder="e.g. alice (or leave empty for Touch ID prompt)" />
      </div>
      <button class="btn" onclick="signInWithPasskey()">
        <span>👆</span> Sign In with Biometrics / Passkey
      </button>
    </div>

    <!-- Register Form -->
    <div id="registerTab" class="hidden">
      <p>Register a biometric Passkey tied directly to your hardware (no passwords, no 3rd parties).</p>
      <div class="input-group">
        <label for="regUsername">Choose a Username *</label>
        <input type="text" id="regUsername" placeholder="e.g. alice" required />
      </div>
      <button class="btn" onclick="registerWithPasskey()">
        <span>🔐</span> Create Passkey with Touch ID / Face ID
      </button>
    </div>
  </div>

    <!-- Authenticated User Dashboard -->
    <div id="dashboardSection" class="card hidden">
      <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); padding-bottom: 16px; margin-bottom: 16px;">
        <div>
          <h2 style="margin: 0;">👋 Welcome, <span id="userDisplayName">User</span></h2>
          <p style="margin: 4px 0 0 0; font-size: 0.85rem;">User ID: <code id="userUid">-</code></p>
        </div>
        <button class="btn btn-secondary" onclick="signOutUser()">Sign Out</button>
      </div>

      <h2>🔐 Registered Devices & Passkeys</h2>
      <p>Manage hardware passkeys, biometric credentials, and security keys attached to this account:</p>
      
      <div id="passkeysListContainer" style="margin-bottom: 16px;">
        <ul id="passkeysList" style="list-style: none; padding: 0; margin: 0;"></ul>
      </div>

      <div class="btn-row" style="margin-bottom: 24px;">
        <button class="btn" onclick="addPasskeyForCurrentDevice()">
          <span>➕</span> Register Passkey for This Device
        </button>
      </div>

      <h2>🔑 Bearer API Token (For Claude Desktop & Cursor)</h2>
      <p>Generate a persistent Bearer token to connect remote MCP clients to your personal workflow workspace:</p>
      
      <div class="btn-row">
        <button class="btn" onclick="generateApiToken()">⚡ Generate New API Token</button>
      </div>

      <div id="tokenDisplay" class="hidden" style="margin-top: 16px;">
        <label>Your New API Token (Save this — it won't be shown again):</label>
        <pre><code id="tokenValue">-</code><button class="copy-btn" onclick="copyToken()">Copy Token</button></pre>
      </div>

      <h2 style="margin-top: 24px;">⚙️ Client Setup Configuration</h2>
      <p>Paste this configuration into your <code>claude_desktop_config.json</code> or Cursor <code>.cursor/mcp.json</code>:</p>
      
      <pre><code id="configSnippet">{
  "mcpServers": {
    "workflow-mcp": {
      "url": "${origin}/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_TOKEN"
      }
    }
  }
}</code><button class="copy-btn" onclick="copyConfig()">Copy Config</button></pre>
    </div>

    <div class="card">
      <h2>📡 Available Endpoints</h2>
      <ul>
        <li><strong>Live SSR Visualizer</strong>: <code>GET ${origin}/visualize/:workflowId</code> (supports share tickets <code>?ticket=...</code>, 1 week default up to 1 year)</li>
        <li><strong>Stateless JSON-RPC MCP</strong>: <code>POST ${origin}/mcp</code></li>
        <li><strong>SSE Stream</strong>: <code>GET ${origin}/sse</code> + <code>POST ${origin}/message</code></li>
        <li><strong>Health Probe</strong>: <code>GET ${origin}/health</code></li>
        <li><strong>User Profile</strong>: <code>GET ${origin}/api/me</code></li>
      </ul>
    </div>

    <script>
      const ORIGIN = "${origin}";

      function showAlert(msg, isError = false) {
        const box = document.getElementById("alertBox");
        box.className = "alert " + (isError ? "alert-error" : "alert-success");
        box.textContent = msg;
        box.classList.remove("hidden");
      }

      function switchAuthTab(tab) {
        document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
        if (tab === "login") {
          document.querySelectorAll(".tab")[0].classList.add("active");
          document.getElementById("loginTab").classList.remove("hidden");
          document.getElementById("registerTab").classList.add("hidden");
        } else {
          document.querySelectorAll(".tab")[1].classList.add("active");
          document.getElementById("loginTab").classList.add("hidden");
          document.getElementById("registerTab").classList.remove("hidden");
        }
      }

      function bufferToBase64Url(buffer) {
        const bytes = new Uint8Array(buffer);
        let binary = "";
        for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
        return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      }

      function base64UrlToBuffer(base64url) {
        const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/").padEnd(base64url.length + (4 - (base64url.length % 4)) % 4, "=");
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes.buffer;
      }

      async function checkAuth() {
        try {
          const res = await fetch("/api/me");
          if (res.ok) {
            const data = await res.json();
            showDashboard(data);
            loadPasskeys();
          }
        } catch (err) {
          console.error("Auth check error:", err);
        }
      }

      function showDashboard(userData) {
        document.getElementById("authSection").classList.add("hidden");
        document.getElementById("dashboardSection").classList.remove("hidden");
        document.getElementById("userDisplayName").textContent = userData.user?.name || userData.userId;
        document.getElementById("userUid").textContent = userData.userId;
      }

      async function loadPasskeys() {
        try {
          const res = await fetch("/api/passkeys");
          if (!res.ok) return;
          const data = await res.json();
          const list = document.getElementById("passkeysList");
          list.innerHTML = "";

          if (!data.passkeys || data.passkeys.length === 0) {
            list.innerHTML = "<li style='color: var(--text-muted); font-size: 0.9rem;'>No passkeys found.</li>";
            return;
          }

          data.passkeys.forEach((p, idx) => {
            const li = document.createElement("li");
            li.style.cssText = "display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; margin-bottom: 8px;";
            
            const maskedId = p.id.slice(0, 10) + "..." + p.id.slice(-6);
            const dateStr = p.createdAt ? new Date(p.createdAt).toLocaleDateString() : "Active";
            
            const leftDiv = document.createElement("div");
            leftDiv.innerHTML = "<strong>🔑 Passkey #" + (idx + 1) + "</strong> <span style='font-size: 0.8rem; color: var(--text-muted); margin-left: 8px;'>(" + p.deviceType + ")</span><br><code style='font-size: 0.75rem; color: var(--text-muted);'>" + maskedId + "</code> <span style='font-size: 0.75rem; color: var(--text-muted);'>• Created " + dateStr + "</span>";
            li.appendChild(leftDiv);

            if (data.passkeys.length > 1) {
              const delBtn = document.createElement("button");
              delBtn.className = "btn btn-danger";
              delBtn.style.cssText = "padding: 5px 12px; font-size: 0.8rem;";
              delBtn.textContent = "Remove";
              delBtn.onclick = () => deletePasskey(p.id);
              li.appendChild(delBtn);
            }

            list.appendChild(li);
          });
        } catch (err) {
          console.error("Failed to load passkeys:", err);
        }
      }

      async function addPasskeyForCurrentDevice() {
        try {
          const optRes = await fetch("/api/passkeys/add-options", {
            method: "POST",
            headers: { "Content-Type": "application/json" }
          });
          if (!optRes.ok) {
            const errData = await optRes.json();
            showAlert(errData.error || "Failed to generate passkey options.", true);
            return;
          }
          const { options, challengeId } = await optRes.json();

          options.challenge = base64UrlToBuffer(options.challenge);
          options.user.id = base64UrlToBuffer(options.user.id);
          if (options.excludeCredentials) {
            for (const cred of options.excludeCredentials) cred.id = base64UrlToBuffer(cred.id);
          }

          const credential = await navigator.credentials.create({ publicKey: options });

          const formattedResponse = {
            id: credential.id,
            rawId: bufferToBase64Url(credential.rawId),
            type: credential.type,
            response: {
              attestationObject: bufferToBase64Url(credential.response.attestationObject),
              clientDataJSON: bufferToBase64Url(credential.response.clientDataJSON),
              transports: credential.response.getTransports ? credential.response.getTransports() : undefined
            }
          };

          const verifyRes = await fetch("/api/passkeys/add-verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ challengeId, response: formattedResponse })
          });
          const verifyData = await verifyRes.json();

          if (verifyData.verified) {
            showAlert("New Passkey added successfully to this account!", false);
            loadPasskeys();
          } else {
            showAlert(verifyData.error || "Passkey verification failed.", true);
          }
        } catch (err) {
          showAlert("Add passkey error: " + err.message, true);
        }
      }

      async function deletePasskey(credentialId) {
        if (!confirm("Are you sure you want to remove this passkey?")) return;
        try {
          const res = await fetch("/api/passkeys/" + encodeURIComponent(credentialId), {
            method: "DELETE"
          });
          if (res.ok) {
            showAlert("Passkey removed.", false);
            loadPasskeys();
          } else {
            const errData = await res.json();
            showAlert(errData.error || "Failed to remove passkey.", true);
          }
        } catch (err) {
          showAlert("Delete passkey error: " + err.message, true);
        }
      }

      async function registerWithPasskey() {
        const username = document.getElementById("regUsername").value.trim();
        if (!username) {
          showAlert("Please enter a username.", true);
          return;
        }

        try {
          const optRes = await fetch("/auth/passkey/register-options", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, displayName: username })
          });
          
          if (!optRes.ok) {
            const errData = await optRes.json();
            showAlert(errData.error || "Registration failed.", true);
            return;
          }

          const { options, challengeId } = await optRes.json();

          options.challenge = base64UrlToBuffer(options.challenge);
          options.user.id = base64UrlToBuffer(options.user.id);
          if (options.excludeCredentials) {
            for (const cred of options.excludeCredentials) cred.id = base64UrlToBuffer(cred.id);
          }

          const credential = await navigator.credentials.create({ publicKey: options });

          const formattedResponse = {
            id: credential.id,
            rawId: bufferToBase64Url(credential.rawId),
            type: credential.type,
            response: {
              attestationObject: bufferToBase64Url(credential.response.attestationObject),
              clientDataJSON: bufferToBase64Url(credential.response.clientDataJSON),
              transports: credential.response.getTransports ? credential.response.getTransports() : undefined
            }
          };

          const verifyRes = await fetch("/auth/passkey/register-verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ challengeId, response: formattedResponse })
          });
          const verifyData = await verifyRes.json();

          if (verifyData.verified) {
            showAlert("Passkey registered successfully! Welcome.", false);
            checkAuth();
          } else {
            showAlert(verifyData.error || "Registration verification failed.", true);
          }
        } catch (err) {
          showAlert("Passkey error: " + err.message, true);
        }
      }

      async function signInWithPasskey() {
        const username = document.getElementById("loginUsername").value.trim();

        try {
          const optRes = await fetch("/auth/passkey/login-options", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: username || undefined })
          });
          const { options, challengeId } = await optRes.json();

          options.challenge = base64UrlToBuffer(options.challenge);
          if (options.allowCredentials) {
            for (const cred of options.allowCredentials) cred.id = base64UrlToBuffer(cred.id);
          }

          const credential = await navigator.credentials.get({ publicKey: options });

          const formattedResponse = {
            id: credential.id,
            rawId: bufferToBase64Url(credential.rawId),
            type: credential.type,
            response: {
              authenticatorData: bufferToBase64Url(credential.response.authenticatorData),
              clientDataJSON: bufferToBase64Url(credential.response.clientDataJSON),
              signature: bufferToBase64Url(credential.response.signature),
              userHandle: credential.response.userHandle ? bufferToBase64Url(credential.response.userHandle) : undefined
            }
          };

          const verifyRes = await fetch("/auth/passkey/login-verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ challengeId, response: formattedResponse })
          });
          const verifyData = await verifyRes.json();

          if (verifyData.verified) {
            showAlert("Signed in successfully with Passkey!", false);
            checkAuth();
          } else {
            showAlert(verifyData.error || "Authentication failed.", true);
          }
        } catch (err) {
          showAlert("Passkey sign in error: " + err.message, true);
        }
      }

      async function generateApiToken() {
        try {
          const res = await fetch("/api/token", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: "Browser Generated Token", expiresInDays: 365 })
          });
          if (res.ok) {
            const data = await res.json();
            document.getElementById("tokenValue").textContent = data.token;
            document.getElementById("tokenDisplay").classList.remove("hidden");
            updateConfigSnippet(data.token);
            showAlert("New API Token generated!", false);
          }
        } catch (err) {
          showAlert("Token generation failed: " + err.message, true);
        }
      }

      function updateConfigSnippet(token) {
        const json = JSON.stringify({
          mcpServers: {
            "workflow-mcp": {
              url: ORIGIN + "/mcp",
              headers: {
                Authorization: "Bearer " + token
              }
            }
          }
        }, null, 2);
        document.getElementById("configSnippet").textContent = json;
      }

      function copyToken() {
        const token = document.getElementById("tokenValue").textContent;
        navigator.clipboard.writeText(token);
        showAlert("API token copied to clipboard!", false);
      }

      function copyConfig() {
        const config = document.getElementById("configSnippet").textContent;
        navigator.clipboard.writeText(config);
        showAlert("Configuration JSON copied to clipboard!", false);
      }

      async function signOutUser() {
        await fetch("/oauth/signout");
        location.reload();
      }

      checkAuth();
    </script>
  </body>
  </html>`;
}

export async function handleStaticRoutes(
  req: Request,
  url: URL,
  auth: AuthResult | null,
): Promise<Response | null> {
  const path = url.pathname;
  const method = req.method.toUpperCase();

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
          mcp: `${url.origin}/mcp`,
          sse: `${url.origin}/sse`,
          health: `${url.origin}/health`,
          authPasskey: `${url.origin}/auth/passkey/*`,
        },
      });
    }
    return new Response(renderDashboardHtml(url.origin), {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  // User Profile Endpoint
  if (path === "/api/me" && method === "GET") {
    if (!auth) {
      return errorResponse("Unauthorized. Please log in or provide Bearer token.", 401);
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
