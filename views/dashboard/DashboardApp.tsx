import type { VNode } from "preact";
import { Badge } from "../components/Badge.tsx";
import { Button } from "../components/Button.tsx";
import { PasskeyAuth } from "./PasskeyAuth.tsx";
import type { PasskeyDevice } from "./PasskeyAuth.tsx";
import { TokenManager } from "./TokenManager.tsx";

export interface DashboardUser {
  userId: string;
  name?: string;
  email?: string;
  avatarUrl?: string;
  provider?: string;
}

export interface DashboardAppProps {
  origin?: string;
  user?: DashboardUser | null;
  authMethod?: "bearer" | "session" | "header" | "anonymous";
  passkeys?: PasskeyDevice[];
  currentToken?: string;
  tokenLifetimeDays?: number;
  onSignOut?: () => void;
  class?: string;
  className?: string;
}

/**
 * Top-level Dashboard layout assembling Header, user profile / auth badge,
 * PasskeyAuth, TokenManager, and navigation links to /tasks and /visualize.
 */
export function DashboardApp({
  origin = "https://workflow-mcp.deno.dev",
  user = null,
  authMethod,
  passkeys = [],
  currentToken = "",
  tokenLifetimeDays = 365,
  onSignOut,
  class: classProp,
  className,
}: DashboardAppProps): VNode {
  const customClass = classProp || className || "";
  const isAuthenticated = Boolean(user && user.userId);
  const displayName = user?.name || user?.userId || "Guest";

  return (
    <div
      class={`min-h-screen bg-gray-900 text-gray-100 selection:bg-blue-600 selection:text-white ${customClass}`
        .trim()}
    >
      {/* Top Navigation Bar */}
      <header class="border-b border-gray-800 bg-gray-900/95 backdrop-blur sticky top-0 z-40">
        <div class="max-w-6xl mx-auto px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-4">
          {/* Brand & Logo */}
          <div class="flex items-center gap-3">
            <span class="text-2xl" aria-hidden="true">🚀</span>
            <div>
              <a
                href="/"
                class="text-lg font-bold text-gray-100 hover:text-blue-400 transition-colors"
              >
                Workflow Builder MCP
              </a>
              <span class="ml-2 text-xs font-mono text-blue-400 bg-blue-950/70 border border-blue-800/60 px-2 py-0.5 rounded-full">
                v1.0
              </span>
            </div>
          </div>

          {/* Navigation Links to /tasks, /visualize, /memories, /journals */}
          <nav class="flex items-center gap-2" aria-label="Main Navigation">
            <a
              href="/"
              class="px-3 py-1.5 rounded-lg text-sm font-medium bg-blue-600 text-white shadow-sm transition-colors"
              aria-current="page"
            >
              ⚡ Dashboard
            </a>
            <a
              href="/tasks"
              class="px-3 py-1.5 rounded-lg text-sm font-medium text-gray-300 hover:text-white hover:bg-gray-800 transition-colors"
            >
              📋 Tasks
            </a>
            <a
              href="/visualize"
              class="px-3 py-1.5 rounded-lg text-sm font-medium text-gray-300 hover:text-white hover:bg-gray-800 transition-colors"
            >
              📊 Visualize
            </a>
            <a
              href="/memories"
              class="px-3 py-1.5 rounded-lg text-sm font-medium text-gray-300 hover:text-white hover:bg-gray-800 transition-colors"
            >
              🧠 Memories
            </a>
            <a
              href="/journals"
              class="px-3 py-1.5 rounded-lg text-sm font-medium text-gray-300 hover:text-white hover:bg-gray-800 transition-colors"
            >
              📖 Journals
            </a>
          </nav>

          {/* User Profile / Auth Status Badge */}
          <div class="flex items-center gap-3">
            <div
              id="userProfileBadge"
              class="flex items-center gap-2.5 px-3 py-1 bg-gray-800/90 border border-gray-700/80 rounded-full text-xs"
            >
              <span
                class={`w-2 h-2 rounded-full ${
                  isAuthenticated ? "bg-emerald-400 animate-pulse" : "bg-gray-500"
                }`}
                aria-hidden="true"
              />
              <span id="userDisplayName" class="font-medium text-gray-200">
                {displayName}
              </span>
              <Badge
                variant={isAuthenticated ? "closed" : "neutral"}
                size="sm"
                pill
              >
                {isAuthenticated ? (authMethod || "authenticated") : "unauthenticated"}
              </Badge>
            </div>

            {isAuthenticated && (
              <Button
                id="btnSignOut"
                variant="secondary"
                size="sm"
                onClick={onSignOut}
                class="text-xs py-1 px-2.5"
              >
                Sign Out
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main class="max-w-6xl mx-auto px-4 sm:px-6 py-8 flex flex-col gap-8">
        {/* Hero Section */}
        <section class="flex flex-col gap-2">
          <div class="flex items-center gap-3">
            <h1 class="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
              Workflow MCP Remote Server
            </h1>
            <Badge variant="closed" size="md">
              Passkey Secured
            </Badge>
          </div>
          <p class="text-sm text-gray-400 max-w-3xl">
            Production serverless Model Context Protocol service with Stateless JSON-RPC tools,
            biometric Touch ID / Face ID authentication, persistent API tokens, and user-scoped
            workflow execution.
          </p>
          <div
            id="userUidContainer"
            class={isAuthenticated ? "text-xs text-gray-400" : "hidden text-xs text-gray-400"}
          >
            User ID: <code id="userUid" class="font-mono text-sky-400">{user?.userId || "-"}</code>
          </div>
        </section>

        {/* Auth & Token Management Grid */}
        <section class="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
          {/* Passkey Authentication Card */}
          <PasskeyAuth
            isAuthenticated={isAuthenticated}
            username={user?.name}
            userId={user?.userId}
            passkeys={passkeys}
          />

          {/* Bearer Token Manager Card */}
          <TokenManager
            origin={origin}
            currentToken={currentToken}
            lifetimeDays={tokenLifetimeDays}
          />
        </section>

        {/* Quick Navigation & Endpoints Reference Card */}
        <section class="bg-gray-800/60 border border-gray-700/60 rounded-xl p-6 shadow-md flex flex-col gap-4">
          <div class="flex items-center justify-between border-b border-gray-700/60 pb-3">
            <div class="flex items-center gap-2">
              <span class="text-xl" aria-hidden="true">📡</span>
              <h2 class="text-base font-semibold text-gray-100">
                Connected Applications & API Endpoints
              </h2>
            </div>
            <span class="text-xs text-gray-400">Quick Links</span>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <a
              href="/tasks"
              class="flex flex-col gap-1 p-3.5 bg-gray-900/60 hover:bg-gray-900 border border-gray-700/70 hover:border-blue-500 rounded-lg transition-colors group"
            >
              <div class="flex items-center justify-between">
                <span class="text-sm font-semibold text-gray-200 group-hover:text-blue-400">
                  📋 Tasks Kanban Board
                </span>
                <span class="text-xs text-gray-500">GET /tasks</span>
              </div>
              <p class="text-xs text-gray-400">
                Interactive Kanban board with drag-and-drop status workflows.
              </p>
            </a>

            <a
              href="/visualize"
              class="flex flex-col gap-1 p-3.5 bg-gray-900/60 hover:bg-gray-900 border border-gray-700/70 hover:border-blue-500 rounded-lg transition-colors group"
            >
              <div class="flex items-center justify-between">
                <span class="text-sm font-semibold text-gray-200 group-hover:text-blue-400">
                  📊 Workflow Visualizer
                </span>
                <span class="text-xs text-gray-500">GET /visualize</span>
              </div>
              <p class="text-xs text-gray-400">
                Live Cytoscape DAG graph visualization and shareable tickets.
              </p>
            </a>

            <a
              href="/memories"
              class="flex flex-col gap-1 p-3.5 bg-gray-900/60 hover:bg-gray-900 border border-gray-700/70 hover:border-blue-500 rounded-lg transition-colors group"
            >
              <div class="flex items-center justify-between">
                <span
                  class="text-sm font-semibold text-gray-200 group-hover:text-blue-400"
                  dangerouslySetInnerHTML={{ __html: "🧠 Memory Vault & Explorer UI" }}
                />
                <span class="text-xs text-gray-500">GET /memories</span>
              </div>
              <p class="text-xs text-gray-400">
                Semantic memory storage and full-text Orama search.
              </p>
            </a>

            <a
              href="/journals"
              class="flex flex-col gap-1 p-3.5 bg-gray-900/60 hover:bg-gray-900 border border-gray-700/70 hover:border-blue-500 rounded-lg transition-colors group"
            >
              <div class="flex items-center justify-between">
                <span
                  class="text-sm font-semibold text-gray-200 group-hover:text-blue-400"
                  dangerouslySetInnerHTML={{ __html: "📖 Role Journals Web UI" }}
                />
                <span class="text-xs text-gray-500">GET /journals</span>
              </div>
              <p class="text-xs text-gray-400">
                Persistent engineering logs and handoff records per agent role.
              </p>
            </a>

            <div class="flex flex-col gap-1 p-3.5 bg-gray-900/60 border border-gray-700/70 rounded-lg">
              <div class="flex items-center justify-between">
                <span class="text-sm font-semibold text-gray-200">
                  ⚡ JSON-RPC MCP Endpoint
                </span>
                <span class="text-xs text-gray-500">POST /mcp</span>
              </div>
              <p class="text-xs text-gray-400">
                Stateless MCP protocol server accepting Bearer token authentication.
              </p>
            </div>

            <a
              href="/health"
              class="flex flex-col gap-1 p-3.5 bg-gray-900/60 hover:bg-gray-900 border border-gray-700/70 hover:border-blue-500 rounded-lg transition-colors group"
            >
              <div class="flex items-center justify-between">
                <span class="text-sm font-semibold text-gray-200 group-hover:text-blue-400">
                  🩺 Health Probe
                </span>
                <span class="text-xs text-gray-500">GET /health</span>
              </div>
              <p class="text-xs text-gray-400">
                Live service status, uptime, version, and auth capabilities.
              </p>
            </a>
          </div>
        </section>
      </main>

      {/* Client-side Script for WebAuthn, Tokens, and Interactivity */}
      <script
        // deno-lint-ignore react-no-danger
        dangerouslySetInnerHTML={{
          __html: `
            const ORIGIN = ${JSON.stringify(origin).replace(/</g, "\\u003c")};

            function showAlert(msg, isError = false) {
              const box = document.getElementById("alertBox");
              if (!box) return;
              box.className = "p-3.5 rounded-lg text-sm font-medium transition-all duration-200 " +
                (isError
                  ? "bg-red-950/80 text-red-200 border border-red-800"
                  : "bg-emerald-950/80 text-emerald-200 border border-emerald-800");
              box.textContent = msg;
              box.classList.remove("hidden");
            }

            function switchAuthTab(tab) {
              const loginBtn = document.getElementById("tabLoginBtn");
              const regBtn = document.getElementById("tabRegisterBtn");
              const loginTab = document.getElementById("loginTab");
              const registerTab = document.getElementById("registerTab");

              if (tab === "login") {
                loginBtn?.classList.add("border-blue-500", "text-blue-400");
                loginBtn?.classList.remove("border-transparent", "text-gray-400");
                regBtn?.classList.remove("border-blue-500", "text-blue-400");
                regBtn?.classList.add("border-transparent", "text-gray-400");

                loginTab?.classList.remove("hidden");
                registerTab?.classList.add("hidden");
              } else {
                regBtn?.classList.add("border-blue-500", "text-blue-400");
                regBtn?.classList.remove("border-transparent", "text-gray-400");
                loginBtn?.classList.remove("border-blue-500", "text-blue-400");
                loginBtn?.classList.add("border-transparent", "text-gray-400");

                registerTab?.classList.remove("hidden");
                loginTab?.classList.add("hidden");
              }
            }

            function bufferToBase64Url(buffer) {
              const bytes = new Uint8Array(buffer);
              let binary = "";
              for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
              return btoa(binary).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, "");
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
              const authSec = document.getElementById("authSection");
              const dashSec = document.getElementById("dashboardSection");
              if (authSec) authSec.classList.add("hidden");
              if (dashSec) dashSec.classList.remove("hidden");

              const nameEl = document.getElementById("userDisplayName");
              if (nameEl) nameEl.textContent = userData.user?.name || userData.userId;

              const uidEl = document.getElementById("userUid");
              if (uidEl) uidEl.textContent = userData.userId;

              const uidContainer = document.getElementById("userUidContainer");
              if (uidContainer) uidContainer.classList.remove("hidden");
            }

            async function loadPasskeys() {
              try {
                const res = await fetch("/api/passkeys");
                if (!res.ok) return;
                const data = await res.json();
                const list = document.getElementById("passkeysList");
                if (!list) return;
                list.innerHTML = "";

                if (!data.passkeys || data.passkeys.length === 0) {
                  list.innerHTML = "<li class='text-xs text-gray-400 italic py-2'>No passkeys found.</li>";
                  return;
                }

                data.passkeys.forEach((p, idx) => {
                  const li = document.createElement("li");
                  li.className = "flex items-center justify-between p-3 bg-gray-900/70 border border-gray-700/70 rounded-lg text-xs";

                  const maskedId = p.id.slice(0, 10) + "..." + p.id.slice(-6);
                  const dateStr = p.createdAt ? new Date(p.createdAt).toLocaleDateString() : "Active";

                  li.innerHTML = '<div class="flex flex-col gap-0.5">' +
                    '<span class="font-medium text-gray-200">🔑 Passkey #' + (idx + 1) + ' <span class="text-gray-400 font-normal">(' + p.deviceType + ')</span></span>' +
                    '<span class="font-mono text-gray-400 text-[11px]">' + maskedId + ' • Created ' + dateStr + '</span>' +
                    '</div>';

                  if (data.passkeys.length > 1) {
                    const delBtn = document.createElement("button");
                    delBtn.className = "px-2.5 py-1 text-xs rounded bg-red-600 hover:bg-red-700 text-white font-medium";
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
              const usernameEl = document.getElementById("regUsername");
              const username = usernameEl ? usernameEl.value.trim() : "";
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
              const usernameEl = document.getElementById("loginUsername");
              const username = usernameEl ? usernameEl.value.trim() : "";

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
                  const tokenInput = document.getElementById("tokenInput");
                  if (tokenInput) tokenInput.value = data.token;

                  const tokenVal = document.getElementById("tokenValue");
                  if (tokenVal) tokenVal.textContent = data.token;

                  const tokenDisp = document.getElementById("tokenDisplay");
                  if (tokenDisp) tokenDisp.classList.remove("hidden");

                  updateConfigSnippets(data.token);
                  showAlert("New Bearer API Token generated!", false);
                } else {
                  const errData = await res.json();
                  showAlert(errData.error || "Token generation failed.", true);
                }
              } catch (err) {
                showAlert("Token generation failed: " + err.message, true);
              }
            }

            function updateConfigSnippets(token) {
              const remoteJson = JSON.stringify({
                mcpServers: {
                  "workflow-mcp": {
                    url: ORIGIN + "/mcp",
                    headers: {
                      Authorization: "Bearer " + token
                    }
                  }
                }
              }, null, 2);
              const configEl = document.getElementById("configSnippet");
              if (configEl) configEl.textContent = remoteJson;

              const curlMcp = document.getElementById("curlMcpSnippet");
              if (curlMcp) {
                const bodyStr = JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 1 });
                curlMcp.textContent = 'curl -X POST "' + ORIGIN + '/mcp" \\\\\\n' +
                  '  -H "Authorization: Bearer ' + token + '" \\\\\\n' +
                  '  -H "Content-Type: application/json" \\\\\\n' +
                  "  -d '" + bodyStr + "'";
              }

              const curlMe = document.getElementById("curlMeSnippet");
              if (curlMe) {
                curlMe.textContent = 'curl -X GET "' + ORIGIN + '/api/me" \\\\\\n' +
                  '  -H "Authorization: Bearer ' + token + '"';
              }
            }

            function copyToken() {
              const tokenInput = document.getElementById("tokenInput");
              const token = tokenInput ? tokenInput.value : "";
              if (token) {
                navigator.clipboard.writeText(token);
                showAlert("API token copied to clipboard!", false);
              }
            }

            function copyConfig() {
              const configEl = document.getElementById("configSnippet");
              if (configEl) {
                navigator.clipboard.writeText(configEl.textContent || "");
                showAlert("Remote MCP configuration JSON copied!", false);
              }
            }

            function copyStdioConfig() {
              const configEl = document.getElementById("stdioConfigSnippet");
              if (configEl) {
                navigator.clipboard.writeText(configEl.textContent || "");
                showAlert("Stdio MCP configuration JSON copied!", false);
              }
            }

            function copyCurlMcp() {
              const snippet = document.getElementById("curlMcpSnippet");
              if (snippet) {
                navigator.clipboard.writeText(snippet.textContent || "");
                showAlert("cURL command copied!", false);
              }
            }

            function copyCurlMe() {
              const snippet = document.getElementById("curlMeSnippet");
              if (snippet) {
                navigator.clipboard.writeText(snippet.textContent || "");
                showAlert("cURL command copied!", false);
              }
            }

            async function signOutUser() {
              await fetch("/oauth/signout");
              location.reload();
            }

            // Wire up event listeners
            window.addEventListener("DOMContentLoaded", () => {
              document.getElementById("tabLoginBtn")?.addEventListener("click", () => switchAuthTab("login"));
              document.getElementById("tabRegisterBtn")?.addEventListener("click", () => switchAuthTab("register"));
              document.getElementById("btnSignInPasskey")?.addEventListener("click", signInWithPasskey);
              document.getElementById("btnRegisterPasskey")?.addEventListener("click", registerWithPasskey);
              document.getElementById("btnAddPasskey")?.addEventListener("click", addPasskeyForCurrentDevice);
              document.getElementById("btnGenerateToken")?.addEventListener("click", generateApiToken);
              document.getElementById("btnCopyToken")?.addEventListener("click", copyToken);
              document.getElementById("btnCopyCurlMcp")?.addEventListener("click", copyCurlMcp);
              document.getElementById("btnCopyCurlMe")?.addEventListener("click", copyCurlMe);
              document.getElementById("btnCopyConfig")?.addEventListener("click", copyConfig);
              document.getElementById("btnCopyStdioConfig")?.addEventListener("click", copyStdioConfig);
              document.getElementById("btnSignOut")?.addEventListener("click", signOutUser);
            });

            // Auto-check auth on page load
            checkAuth();
          `,
        }}
      />
    </div>
  );
}
