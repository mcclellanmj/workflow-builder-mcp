import type { VNode } from "preact";
import type { AuthResult } from "../../auth/oauth.ts";
import { Badge, type BadgeVariant } from "../components/Badge.tsx";
import { Button } from "../components/Button.tsx";
import { Input } from "../components/Input.tsx";
import { escapeHtml } from "../../routes/common.ts";

export interface OAuthScopeDetail {
  scope: string;
  label: string;
  description: string;
  variant: BadgeVariant;
}

export const KNOWN_OAUTH_SCOPES: Record<string, OAuthScopeDetail> = {
  workflow: {
    scope: "workflow",
    label: "Workflows",
    description: "Read, design, validate, and execute automated workflows",
    variant: "open",
  },
  read: {
    scope: "read",
    label: "Read",
    description: "Read-only access to workflows, executions, and task statuses",
    variant: "neutral",
  },
  write: {
    scope: "write",
    label: "Write",
    description: "Create, update, and manage workflows, nodes, and configurations",
    variant: "review",
  },
  admin: {
    scope: "admin",
    label: "Admin",
    description: "Full administrative access to all workflows, tenants, and system settings",
    variant: "critical",
  },
  openid: {
    scope: "openid",
    label: "OpenID",
    description: "Verify your user identity and account identifier",
    variant: "role",
  },
  profile: {
    scope: "profile",
    label: "Profile",
    description: "Access your display name, username, and avatar",
    variant: "role",
  },
  email: {
    scope: "email",
    label: "Email",
    description: "Access your verified email address",
    variant: "role",
  },
};

/**
 * Parses a space-delimited or comma-delimited scope string into structured scope details.
 */
export function parseScopeDetails(scopeString?: string): OAuthScopeDetail[] {
  if (!scopeString || !scopeString.trim()) {
    return [KNOWN_OAUTH_SCOPES.workflow];
  }

  const rawScopes = scopeString
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (rawScopes.length === 0) {
    return [KNOWN_OAUTH_SCOPES.workflow];
  }

  return rawScopes.map((scope) => {
    const lower = scope.toLowerCase();
    if (lower in KNOWN_OAUTH_SCOPES) {
      return KNOWN_OAUTH_SCOPES[lower];
    }
    return {
      scope,
      label: scope,
      description: `Permission grant for '${scope}' resources`,
      variant: "neutral" as BadgeVariant,
    };
  });
}

export interface OAuthAuthorizeProps {
  clientId: string;
  clientName?: string;
  clientLogo?: string;
  redirectUri: string;
  responseType?: string;
  scope?: string;
  state?: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  auth?: AuthResult | null;
  user?: {
    id?: string;
    username?: string;
    name?: string;
    email?: string;
  } | null;
  oauthConfigured?: boolean;
  requireWebAuthnPrompt?: boolean;
  errorMessage?: string;
  actionUrl?: string;
  cancelUrl?: string;
  class?: string;
  className?: string;
}

/**
 * OAuth 2.1 Authorization Consent Component.
 *
 * Renders an accessible, responsive consent screen presenting requesting client information,
 * requested OAuth scopes with badges and descriptions, user authentication status,
 * WebAuthn re-authentication action/prompt when needed, and Authorize / Cancel form actions.
 */
export function OAuthAuthorize({
  clientId,
  clientName,
  redirectUri,
  responseType = "code",
  scope = "workflow",
  state,
  codeChallenge,
  codeChallengeMethod = "S256",
  auth,
  user,
  oauthConfigured = false,
  requireWebAuthnPrompt = false,
  errorMessage,
  actionUrl = "/oauth/authorize",
  cancelUrl,
  class: classProp,
  className,
}: OAuthAuthorizeProps): VNode {
  const displayName = clientName || clientId;
  const scopes = parseScopeDetails(scope);

  // Derive active user display
  const currentUser = user || auth?.user;
  const currentUserId = user?.id || user?.username || auth?.userId || auth?.user?.name;
  const isAuthenticated = Boolean(currentUser || currentUserId);

  // Compute cancel URL fallback if not explicitly provided
  const computedCancelUrl = cancelUrl ||
    (() => {
      const sep = redirectUri.includes("?") ? "&" : "?";
      const stateParam = state ? `&state=${encodeURIComponent(state)}` : "";
      return `${redirectUri}${sep}error=access_denied${stateParam}`;
    })();

  const customClass = classProp || className || "";

  return (
    <div
      class={`w-full max-w-lg mx-auto bg-gray-900 border border-gray-800 rounded-2xl shadow-2xl p-6 sm:p-8 text-gray-100 ${customClass}`
        .trim()}
    >
      {/* Client Header & Badge */}
      <div class="text-center space-y-3 pb-6 border-b border-gray-800">
        <div class="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-blue-950/60 border border-blue-800/60 text-blue-400 shadow-inner">
          <svg
            class="w-7 h-7"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
            />
          </svg>
        </div>

        <h1 class="text-xl sm:text-2xl font-bold tracking-tight text-white">
          Authorize Application
        </h1>

        <div class="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-sm font-semibold text-gray-200">
          <span class="text-blue-400">⚡</span>
          <span>{displayName}</span>
        </div>

        <p class="text-sm text-gray-400 max-w-sm mx-auto leading-relaxed">
          A Model Context Protocol (MCP) client is requesting access to execute and manage workflows
          on your server.
        </p>
      </div>

      {/* Error Banner */}
      {errorMessage && (
        <div
          class="mt-6 p-4 rounded-xl bg-red-950/70 border border-red-800/80 text-red-300 text-sm flex items-start gap-3"
          role="alert"
        >
          <svg
            class="w-5 h-5 text-red-400 shrink-0 mt-0.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <div>
            <span class="font-semibold block">Authorization Notice</span>
            <span>{errorMessage}</span>
          </div>
        </div>
      )}

      {/* Scopes Section */}
      <div class="mt-6 space-y-3">
        <div class="flex items-center justify-between">
          <h2 class="text-xs font-semibold uppercase tracking-wider text-gray-400">
            Requested Permissions
          </h2>
          <span class="text-xs text-gray-500 font-mono">
            {scopes.length} {scopes.length === 1 ? "scope" : "scopes"}
          </span>
        </div>

        <div class="bg-gray-950/60 border border-gray-800 rounded-xl divide-y divide-gray-800/80 overflow-hidden">
          {scopes.map((s) => (
            <div key={s.scope} class="p-3.5 flex items-start gap-3">
              <div class="mt-0.5 text-emerald-400 shrink-0">
                <svg
                  class="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2.5"
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-1">
                  <Badge variant={s.variant} size="sm" pill>
                    {s.label}
                  </Badge>
                  <span class="text-xs font-mono text-gray-500 truncate">
                    ({s.scope})
                  </span>
                </div>
                <p class="text-xs text-gray-400 leading-relaxed">
                  {s.description}
                </p>
              </div>
            </div>
          ))}

          {/* Security & Multi-tenancy Guarantee */}
          <div class="p-3.5 bg-gray-900/40 flex items-center gap-3 text-xs text-gray-400">
            <span class="text-blue-400 shrink-0">🛡️</span>
            <span>
              Multi-tenant user scoped data isolation active. Access is confined strictly to your
              account resources.
            </span>
          </div>
        </div>
      </div>

      {/* User Status / Identity confirmation */}
      {isAuthenticated && (
        <div class="mt-6 p-3.5 rounded-xl bg-gray-800/50 border border-gray-700/60 flex items-center justify-between text-sm">
          <div class="flex items-center gap-2.5">
            <div class="w-8 h-8 rounded-full bg-blue-600/30 border border-blue-500/40 flex items-center justify-center text-blue-300 font-semibold text-xs">
              {currentUser?.name ? currentUser.name.charAt(0).toUpperCase() : "👤"}
            </div>
            <div>
              <span class="text-xs text-gray-400 block leading-tight">Authorizing as</span>
              <span
                class="font-medium text-white truncate max-w-[200px] block"
                dangerouslySetInnerHTML={{
                  __html: escapeHtml(currentUser?.name || currentUserId),
                }}
              />
            </div>
          </div>
          <Badge variant="closed" size="sm">
            Authenticated
          </Badge>
        </div>
      )}

      {/* WebAuthn Step-Up / Sign-in Prompt if required */}
      {(!isAuthenticated || requireWebAuthnPrompt) && (
        <div class="mt-6 p-4 rounded-xl bg-gray-800/80 border border-blue-800/40 space-y-4">
          <div class="flex items-center gap-2.5 text-blue-400">
            <svg
              class="w-5 h-5 shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 004 11m0 0a8 8 0 0016 0"
              />
            </svg>
            <h3 class="font-semibold text-sm text-white">
              {requireWebAuthnPrompt
                ? "WebAuthn Confirmation Required"
                : "Passkey Sign-In Required"}
            </h3>
          </div>

          <p class="text-xs text-gray-300 leading-relaxed">
            {requireWebAuthnPrompt
              ? "This client requests sensitive permissions. Verify your physical Passkey, Touch ID, or Windows Hello sensor to approve."
              : "Touch your fingerprint sensor (Touch ID), Face ID, or Windows Hello to authenticate and grant access."}
          </p>

          <div id="webauthnAlertBox" class="hidden text-xs p-2.5 rounded-lg"></div>

          {!isAuthenticated && (
            <div class="space-y-2">
              <Input
                label="Username (Optional)"
                id="loginUsername"
                name="username"
                placeholder="e.g. alice (or leave empty for resident key)"
              />
            </div>
          )}

          <Button
            id="webauthnPromptBtn"
            type="button"
            variant="secondary"
            size="md"
            class="w-full flex items-center justify-center gap-2"
          >
            <span>👆</span>
            <span>
              {requireWebAuthnPrompt
                ? "Verify Passkey & Authorize"
                : "Sign In & Authorize with Passkey"}
            </span>
          </Button>

          {oauthConfigured && !isAuthenticated && (
            <div class="pt-2 text-center border-t border-gray-700/60">
              <span class="text-xs text-gray-400 block mb-2">Or continue with third-party IDP</span>
              <a
                href="/oauth/signin"
                class="inline-block text-xs font-medium text-blue-400 hover:text-blue-300 underline"
              >
                Sign in with GitHub / Google
              </a>
            </div>
          )}
        </div>
      )}

      {/* Consent Form */}
      <form id="consentForm" method="POST" action={actionUrl} class="mt-6 space-y-3">
        {/* Hidden inputs preserving OAuth 2.1 authorization parameters */}
        <input type="hidden" name="approve" value="true" />
        <input type="hidden" name="client_id" value={clientId} />
        <input type="hidden" name="redirect_uri" value={redirectUri} />
        <input type="hidden" name="response_type" value={responseType} />
        <input type="hidden" name="scope" value={scope} />
        <input type="hidden" name="state" value={state || ""} />
        <input type="hidden" name="code_challenge" value={codeChallenge || ""} />
        <input
          type="hidden"
          name="code_challenge_method"
          value={codeChallengeMethod}
        />

        {/* Action Buttons */}
        <div class="flex flex-col sm:flex-row items-center gap-3 pt-2">
          <Button
            type="submit"
            id="authorizeBtn"
            variant="primary"
            size="lg"
            class="w-full sm:flex-1 font-semibold flex items-center justify-center gap-2"
          >
            <span>🚀</span>
            <span>Authorize {displayName}</span>
          </Button>

          <a
            href={computedCancelUrl}
            id="cancelBtn"
            class="w-full sm:w-auto"
          >
            <Button
              type="button"
              variant="ghost"
              size="lg"
              class="w-full text-gray-400 hover:text-red-400 hover:bg-red-950/20"
            >
              Cancel
            </Button>
          </a>
        </div>
      </form>

      {/* Consent Disclaimer */}
      <p class="mt-4 text-center text-xs text-gray-500">
        By clicking Authorize, you grant {displayName}{" "}
        the permissions listed above. You can revoke access anytime in your account settings.
      </p>
    </div>
  );
}
