/**
 * OAuth 2.1 Authorization Server domain logic for Model Context Protocol (MCP).
 * Strict compliance with OAuth 2.1 (RFC 7636 PKCE S256 mandatory, RFC 7591 Dynamic Client Registration,
 * RFC 6749 authorization code grant with TTL expiration and replay protection).
 */

import { getKv } from "../store/kv.ts";
import { uint8ArrayToBase64Url } from "../routes/common.ts";
import { createApiToken, revokeApiToken } from "./oauth.ts";

export interface OAuthClient {
  clientId: string;
  clientSecret?: string;
  clientName?: string;
  redirectUris: string[];
  grantTypes: string[];
  responseTypes: string[];
  tokenEndpointAuthMethod?: string;
  createdAt: string;
}

export interface OAuthAuthorizationCode {
  code: string;
  userId: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  scope: string;
  expiresAt: number;
  used: boolean;
}

export interface OAuthRefreshToken {
  refreshToken: string;
  userId: string;
  clientId: string;
  scope: string;
  createdAt: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
}

/**
 * Verifies a PKCE code_verifier against a code_challenge per RFC 7636 (S256 mandatory).
 */
export async function verifyCodeChallenge(
  codeVerifier: string,
  codeChallenge: string,
  method: string = "S256",
): Promise<boolean> {
  if (!codeVerifier || !codeChallenge) return false;

  // OAuth 2.1 strictly requires S256
  if (method === "S256") {
    const encoder = new TextEncoder();
    const data = encoder.encode(codeVerifier);
    const hash = await crypto.subtle.digest("SHA-256", data);
    const base64 = uint8ArrayToBase64Url(new Uint8Array(hash));
    return base64 === codeChallenge;
  }

  return false;
}

/**
 * Registers a new OAuth client dynamically per RFC 7591.
 */
export async function registerOAuthClient(
  metadata: {
    client_name?: string;
    redirect_uris?: string[];
    grant_types?: string[];
    response_types?: string[];
    token_endpoint_auth_method?: string;
  },
): Promise<OAuthClient> {
  const kv = await getKv();
  const clientId = "client_" + crypto.randomUUID().replace(/-/g, "");
  const clientSecret = "secret_" + crypto.randomUUID().replace(/-/g, "");

  const client: OAuthClient = {
    clientId,
    clientSecret,
    clientName: metadata.client_name || "MCP Client",
    redirectUris: Array.isArray(metadata.redirect_uris) ? metadata.redirect_uris : [],
    grantTypes: metadata.grant_types || ["authorization_code", "refresh_token"],
    responseTypes: metadata.response_types || ["code"],
    tokenEndpointAuthMethod: metadata.token_endpoint_auth_method || "none",
    createdAt: new Date().toISOString(),
  };

  await kv.set(["oauth_clients", clientId], client);
  return client;
}

/**
 * Retrieves an OAuth client by clientId, or returns a synthetic client for standard public clients.
 */
export async function getOAuthClient(clientId: string): Promise<OAuthClient | null> {
  if (!clientId) return null;
  const kv = await getKv();
  const entry = await kv.get<OAuthClient>(["oauth_clients", clientId]);
  if (entry.value) return entry.value;

  // Support public MCP clients with arbitrary IDs (e.g. "claude-desktop", "cursor")
  return {
    clientId,
    clientName: clientId.replace(/[-_]/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()),
    redirectUris: [],
    grantTypes: ["authorization_code", "refresh_token"],
    responseTypes: ["code"],
    tokenEndpointAuthMethod: "none",
    createdAt: new Date().toISOString(),
  };
}

/**
 * Generates and stores a single-use authorization code with mandatory PKCE (valid for 10 minutes).
 */
export async function createAuthorizationCode(params: {
  userId: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod?: string;
  scope?: string;
}): Promise<string> {
  if (!params.codeChallenge || params.codeChallenge.trim().length === 0) {
    throw new Error("PKCE code_challenge is mandatory under OAuth 2.1.");
  }

  const method = (params.codeChallengeMethod || "S256").toUpperCase();
  if (method !== "S256") {
    throw new Error("Only S256 code_challenge_method is permitted under OAuth 2.1.");
  }

  const kv = await getKv();
  const code = "authcode_" + crypto.randomUUID().replace(/-/g, "");
  const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

  const authCode: OAuthAuthorizationCode = {
    code,
    userId: params.userId,
    clientId: params.clientId,
    redirectUri: params.redirectUri,
    codeChallenge: params.codeChallenge.trim(),
    codeChallengeMethod: "S256",
    scope: params.scope || "workflow",
    expiresAt,
    used: false,
  };

  // Set with 10-minute TTL in Deno KV
  await kv.set(["oauth_codes", code], authCode, { expireIn: 10 * 60 * 1000 });
  return code;
}

/**
 * Exchanges an authorization code for an access token and refresh token with PKCE verification.
 */
export async function exchangeAuthorizationCode(params: {
  code: string;
  clientId?: string;
  redirectUri?: string;
  codeVerifier: string;
}): Promise<TokenResponse> {
  if (!params.codeVerifier || params.codeVerifier.trim().length === 0) {
    throw new Error("PKCE code_verifier is mandatory under OAuth 2.1.");
  }

  const kv = await getKv();
  const entry = await kv.get<OAuthAuthorizationCode>(["oauth_codes", params.code]);
  if (!entry.value) {
    throw new Error("Invalid or expired authorization code.");
  }

  const authCode = entry.value;
  if (authCode.used) {
    throw new Error("Authorization code has already been used.");
  }

  if (Date.now() > authCode.expiresAt) {
    throw new Error("Authorization code has expired.");
  }

  if (authCode.redirectUri && authCode.redirectUri !== params.redirectUri) {
    throw new Error("Redirect URI is required and must match the authorization request.");
  }

  if (params.clientId && authCode.clientId && params.clientId !== authCode.clientId) {
    throw new Error(
      "Client ID mismatch: authorization code was not issued to the requesting client.",
    );
  }

  const isValid = await verifyCodeChallenge(
    params.codeVerifier,
    authCode.codeChallenge,
    authCode.codeChallengeMethod || "S256",
  );
  if (!isValid) {
    throw new Error("PKCE verification failed: invalid code_verifier.");
  }

  // Atomically mark code as used
  const commitRes = await kv.atomic()
    .check(entry)
    .set(["oauth_codes", params.code], { ...authCode, used: true }, { expireIn: 10 * 60 * 1000 })
    .commit();

  if (!commitRes.ok) {
    throw new Error("Failed to process authorization code (concurrent use).");
  }

  // Look up client name for friendly token labeling
  const client = authCode.clientId ? await getOAuthClient(authCode.clientId) : null;
  const tokenLabel = `OAuth: ${client?.clientName || authCode.clientId || "MCP Client"}`;

  // Create persistent API access token (valid 30 days)
  const tokenInfo = await createApiToken(authCode.userId, tokenLabel, 30);

  // Create refresh token with 90-day TTL in Deno KV
  const refreshToken = "re_" + crypto.randomUUID().replace(/-/g, "");
  const refreshTokenRecord: OAuthRefreshToken = {
    refreshToken,
    userId: authCode.userId,
    clientId: authCode.clientId,
    scope: authCode.scope,
    createdAt: new Date().toISOString(),
  };

  await kv.set(["oauth_refresh_tokens", refreshToken], refreshTokenRecord, {
    expireIn: 90 * 24 * 60 * 60 * 1000,
  });

  return {
    access_token: tokenInfo.token,
    token_type: "Bearer",
    expires_in: 30 * 24 * 60 * 60, // 30 days in seconds
    refresh_token: refreshToken,
    scope: authCode.scope,
  };
}

/**
 * Refreshes an access token using a valid refresh token.
 */
export async function refreshOAuthToken(params: {
  refreshToken: string;
  clientId?: string;
}): Promise<TokenResponse> {
  const kv = await getKv();
  const entry = await kv.get<OAuthRefreshToken>(["oauth_refresh_tokens", params.refreshToken]);
  if (!entry.value) {
    throw new Error("Invalid refresh token.");
  }

  const record = entry.value;
  if (params.clientId && record.clientId && params.clientId !== record.clientId) {
    throw new Error(
      "Client ID mismatch: refresh token was not issued to the requesting client.",
    );
  }

  const client = record.clientId ? await getOAuthClient(record.clientId) : null;
  const tokenLabel = `OAuth Refreshed: ${client?.clientName || record.clientId || "MCP Client"}`;

  const tokenInfo = await createApiToken(record.userId, tokenLabel, 30);

  // Rotate refresh token with 90-day TTL
  const newRefreshToken = "re_" + crypto.randomUUID().replace(/-/g, "");
  const newRecord: OAuthRefreshToken = {
    refreshToken: newRefreshToken,
    userId: record.userId,
    clientId: record.clientId,
    scope: record.scope,
    createdAt: new Date().toISOString(),
  };

  await kv.atomic()
    .delete(["oauth_refresh_tokens", params.refreshToken])
    .set(["oauth_refresh_tokens", newRefreshToken], newRecord, {
      expireIn: 90 * 24 * 60 * 60 * 1000,
    })
    .commit();

  return {
    access_token: tokenInfo.token,
    token_type: "Bearer",
    expires_in: 30 * 24 * 60 * 60,
    refresh_token: newRefreshToken,
    scope: record.scope,
  };
}

/**
 * Revokes an access token or refresh token per RFC 7009.
 */
export async function revokeOAuthToken(token: string): Promise<boolean> {
  if (!token) return false;
  const kv = await getKv();

  if (token.startsWith("wf_")) {
    const entry = await kv.get<{ userId: string; id: string }>(["api_tokens", token]);
    if (entry.value) {
      return await revokeApiToken(entry.value.userId, entry.value.id);
    }
  }

  if (token.startsWith("re_")) {
    await kv.delete(["oauth_refresh_tokens", token]);
    return true;
  }

  return false;
}
