/**
 * OAuth authentication, session management, and Bearer API token handling.
 * Integrates @deno/kv-oauth for browser-based OAuth flows and provides
 * API tokens for headless MCP clients (Claude Desktop, Cursor, CLI agents).
 */

import {
  createGitHubOAuthConfig,
  createGoogleOAuthConfig,
  getSessionId,
  handleCallback as kvHandleCallback,
  signIn as kvSignIn,
  signOut as kvSignOut,
} from "@deno/kv-oauth";
import { safeGetEnv } from "../env.ts";
import { getKv } from "../store/kv.ts";
import { TtlCache } from "../store/cache.ts";

export const apiTokenCache = new TtlCache<string, ApiTokenInfo>({ defaultTtlMs: 300_000 });
export const sessionCache = new TtlCache<string, UserSession>({ defaultTtlMs: 300_000 });

export interface UserSession {
  userId: string;
  email?: string;
  name?: string;
  avatarUrl?: string;
  provider: string;
  createdAt: string;
}

export interface ApiTokenInfo {
  id: string;
  token: string;
  userId: string;
  name: string;
  createdAt: string;
  expiresAt?: string;
}

export interface AuthResult {
  userId: string;
  user?: UserSession;
  authMethod: "bearer" | "session" | "header" | "anonymous";
}

export interface ActiveOAuthConfig {
  provider: "github" | "google";
  // deno-lint-ignore no-explicit-any
  config: any;
}

/**
 * Resolves the active OAuth configuration based on environment variables.
 * Supports GitHub, Google, or returns null if OAuth is not configured.
 */
export function getOAuthConfig(): ActiveOAuthConfig | null {
  const redirectUri = safeGetEnv("REDIRECT_URI");

  const githubClientId = safeGetEnv("GITHUB_CLIENT_ID");
  const githubClientSecret = safeGetEnv("GITHUB_CLIENT_SECRET");
  if (githubClientId && githubClientSecret) {
    return {
      provider: "github" as const,
      config: createGitHubOAuthConfig({
        scope: "read:user user:email",
        ...(redirectUri ? { redirectUri } : {}),
      }),
    };
  }

  const googleClientId = safeGetEnv("GOOGLE_CLIENT_ID");
  const googleClientSecret = safeGetEnv("GOOGLE_CLIENT_SECRET");
  if (googleClientId && googleClientSecret) {
    return {
      provider: "google" as const,
      config: createGoogleOAuthConfig({
        redirectUri: redirectUri || "http://localhost:8000/oauth/callback",
        scope: ["openid", "email", "profile"],
      }),
    };
  }

  return null;
}

/**
 * Initiates the OAuth sign-in flow.
 */
export async function signIn(req: Request): Promise<Response> {
  const oauth = getOAuthConfig();
  if (!oauth) {
    return new Response(
      JSON.stringify({
        error:
          "OAuth is not configured. Set GITHUB_CLIENT_ID & GITHUB_CLIENT_SECRET or GOOGLE_CLIENT_ID & GOOGLE_CLIENT_SECRET.",
      }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }
  return await kvSignIn(req, oauth.config);
}

/**
 * Handles the OAuth callback redirect, retrieves user profile, persists session in Deno KV.
 */
export async function handleCallback(req: Request): Promise<Response> {
  const oauth = getOAuthConfig();
  if (!oauth) {
    return new Response(JSON.stringify({ error: "OAuth is not configured." }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }

  const { response, tokens, sessionId } = await kvHandleCallback(req, oauth.config);
  const kv = await getKv();

  let userId = "user_" + crypto.randomUUID().slice(0, 8);
  let email: string | undefined;
  let name: string | undefined;
  let avatarUrl: string | undefined;

  try {
    if (oauth.provider === "github") {
      const userRes = await fetch("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
          "User-Agent": "workflow-mcp",
        },
      });
      if (userRes.ok) {
        const ghUser = await userRes.json();
        userId = `github:${ghUser.id || ghUser.login}`;
        name = ghUser.name || ghUser.login;
        email = ghUser.email;
        avatarUrl = ghUser.avatar_url;
      }
    } else if (oauth.provider === "google") {
      const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      });
      if (userRes.ok) {
        const gUser = await userRes.json();
        userId = `google:${gUser.id}`;
        name = gUser.name;
        email = gUser.email;
        avatarUrl = gUser.picture;
      }
    }
  } catch (err) {
    console.error("[AUTH] Error fetching user profile:", err);
  }

  const userSession: UserSession = {
    userId,
    email,
    name,
    avatarUrl,
    provider: oauth.provider,
    createdAt: new Date().toISOString(),
  };

  // Associate sessionId with userId and save user record (30 days TTL)
  await kv.atomic()
    .set(["sessions", sessionId], userSession, { expireIn: 30 * 24 * 60 * 60 * 1000 })
    .set(["users", userId, "profile"], userSession)
    .commit();

  sessionCache.set(sessionId, userSession);

  return response;
}

/**
 * Creates a new authenticated session in Deno KV and returns a Set-Cookie header.
 */
export async function createSession(
  userId: string,
  name?: string,
  email?: string,
  provider = "passkey",
): Promise<{ sessionId: string; cookieHeader: string; session: UserSession }> {
  const kv = await getKv();
  const sessionId = crypto.randomUUID();
  const session: UserSession = {
    userId,
    email,
    name: name || userId,
    provider,
    createdAt: new Date().toISOString(),
  };

  await kv.atomic()
    .set(["sessions", sessionId], session, { expireIn: 30 * 24 * 60 * 60 * 1000 })
    .set(["users", userId, "profile"], session)
    .commit();

  sessionCache.set(sessionId, session);

  const isSecure = safeGetEnv("DENO_ENV") === "production" ||
    safeGetEnv("NODE_ENV") === "production" ||
    Boolean(safeGetEnv("DENO_DEPLOYMENT_ID")) ||
    Boolean(safeGetEnv("DENO_REGION"));
  const cookieHeader = `site-session=${sessionId}; Path=/; HttpOnly; SameSite=Lax${
    isSecure ? "; Secure" : ""
  }; Max-Age=2592000`;

  return { sessionId, cookieHeader, session };
}

/**
 * Signs the user out by clearing the session cookie and KV record.
 */
export async function signOut(req: Request): Promise<Response> {
  let sessionId = await getSessionId(req);
  if (!sessionId) {
    const cookieStr = req.headers.get("cookie") || req.headers.get("Cookie");
    if (cookieStr) {
      const match = cookieStr.match(/(?:^|;\s*)site-session=([^;]+)/);
      if (match) {
        sessionId = decodeURIComponent(match[1]);
      }
    }
  }
  if (sessionId) {
    sessionCache.delete(sessionId);
    const kv = await getKv();
    await kv.delete(["sessions", sessionId]);
  }
  return await kvSignOut(req);
}

/**
 * Creates a persistent Bearer API token for a given user.
 */
export async function createApiToken(
  userId: string,
  name: string = "Default API Token",
  expiresInDays?: number,
): Promise<ApiTokenInfo> {
  const kv = await getKv();
  const id = crypto.randomUUID();
  const randomBytes = new Uint8Array(24);
  crypto.getRandomValues(randomBytes);
  const token = "wf_" +
    Array.from(randomBytes).map((b) => b.toString(16).padStart(2, "0")).join("");

  const now = new Date();
  const createdAt = now.toISOString();
  let expiresAt: string | undefined;

  if (expiresInDays && expiresInDays > 0) {
    const expDate = new Date(now.getTime() + expiresInDays * 24 * 60 * 60 * 1000);
    expiresAt = expDate.toISOString();
  }

  const tokenInfo: ApiTokenInfo = {
    id,
    token,
    userId,
    name,
    createdAt,
    expiresAt,
  };

  await kv.atomic()
    .set(["api_tokens", token], tokenInfo)
    .set(["user_api_tokens", userId, id], tokenInfo)
    .commit();

  apiTokenCache.set(token, tokenInfo);

  return tokenInfo;
}

/**
 * Validates a Bearer API token.
 */
export async function validateApiToken(token: string): Promise<ApiTokenInfo | null> {
  if (!token || !token.startsWith("wf_")) return null;

  const cached = apiTokenCache.get(token);
  if (cached) {
    if (cached.expiresAt && new Date(cached.expiresAt).getTime() < Date.now()) {
      apiTokenCache.delete(token);
      return null;
    }
    return cached;
  }

  const kv = await getKv();
  const entry = await kv.get<ApiTokenInfo>(["api_tokens", token]);
  if (!entry.value) return null;

  const info = entry.value;
  if (info.expiresAt && new Date(info.expiresAt).getTime() < Date.now()) {
    // Token expired
    return null;
  }

  apiTokenCache.set(token, info);
  return info;
}

/**
 * Lists all API tokens generated for a user.
 */
export async function listApiTokens(userId: string): Promise<ApiTokenInfo[]> {
  const kv = await getKv();
  const tokens: ApiTokenInfo[] = [];
  for await (const entry of kv.list<ApiTokenInfo>({ prefix: ["user_api_tokens", userId] })) {
    if (entry.value) {
      tokens.push(entry.value);
    }
  }
  return tokens;
}

/**
 * Revokes an API token by token ID.
 */
export async function revokeApiToken(userId: string, tokenId: string): Promise<boolean> {
  const kv = await getKv();
  const userTokenEntry = await kv.get<ApiTokenInfo>(["user_api_tokens", userId, tokenId]);
  if (!userTokenEntry.value) return false;

  const tokenString = userTokenEntry.value.token;
  if (tokenString) {
    apiTokenCache.delete(tokenString);
  }

  await kv.atomic()
    .delete(["user_api_tokens", userId, tokenId])
    .delete(["api_tokens", tokenString])
    .commit();

  return true;
}

export const deleteApiToken = revokeApiToken;

/**
 * Authenticates an incoming HTTP Request via:
 * 1. `Authorization: Bearer <token>`
 * 2. Cookie session via `getSessionId(req)`
 * 3. Header `X-User-Id` (when in dev/test or ALLOW_HEADER_AUTH=1)
 */
export async function authenticateRequest(req: Request): Promise<AuthResult | null> {
  const authHeader = req.headers.get("Authorization") || req.headers.get("authorization");
  const cookieStr = req.headers.get("cookie") || req.headers.get("Cookie");
  const allowHeaderAuth = safeGetEnv("ALLOW_HEADER_AUTH") === "1";
  const headerUserId = req.headers.get("x-user-id") || req.headers.get("X-User-Id");

  // Fast exit: If no auth headers or cookies exist, return null immediately without opening or touching KV
  if (!authHeader && !cookieStr && (!allowHeaderAuth || !headerUserId)) {
    return null;
  }

  // 1. Check Bearer Token
  if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
    const token = authHeader.slice(7).trim();
    const tokenInfo = await validateApiToken(token);
    if (tokenInfo) {
      return {
        userId: tokenInfo.userId,
        authMethod: "bearer",
      };
    }
  }

  // 2. Check KV OAuth Session Cookie
  if (cookieStr) {
    try {
      let sessionId: string | undefined;
      const match = cookieStr.match(/(?:^|;\s*)site-session=([^;]+)/);
      if (match) {
        sessionId = decodeURIComponent(match[1]);
      }
      if (!sessionId) {
        sessionId = (await getSessionId(req)) ?? undefined;
      }
      if (sessionId) {
        let session = sessionCache.get(sessionId);
        if (!session) {
          const kv = await getKv();
          const sessionEntry = await kv.get<UserSession>(["sessions", sessionId]);
          if (sessionEntry.value) {
            session = sessionEntry.value;
            sessionCache.set(sessionId, session);
          }
        }
        if (session) {
          return {
            userId: session.userId,
            user: session,
            authMethod: "session",
          };
        }
      }
    } catch {
      // Ignore cookie parsing errors
    }
  }

  // 3. Check X-User-Id header for development / testing environments (Strict Opt-In only)
  if (allowHeaderAuth && headerUserId && headerUserId.trim().length > 0) {
    return {
      userId: headerUserId.trim(),
      authMethod: "header",
    };
  }

  return null;
}
