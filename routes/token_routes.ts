/**
 * Bearer API Token management route handlers.
 */

import type { AuthResult } from "../auth/oauth.ts";
import { createApiToken, listApiTokens, revokeApiToken } from "../auth/oauth.ts";
import { errorResponse, jsonResponse } from "./common.ts";

export async function handleTokenRoutes(
  req: Request,
  url: URL,
  auth: AuthResult,
): Promise<Response | null> {
  const path = url.pathname;
  const method = req.method.toUpperCase();

  if (path === "/api/token" && method === "POST") {
    const body = await req.json().catch(() => ({}));
    const name = typeof body?.name === "string" ? body.name : "API Token";
    const expiresInDays = typeof body?.expiresInDays === "number" ? body.expiresInDays : undefined;

    const tokenInfo = await createApiToken(auth.userId, name, expiresInDays);
    return jsonResponse({
      message: "API token created successfully.",
      token: tokenInfo.token,
      id: tokenInfo.id,
      name: tokenInfo.name,
      createdAt: tokenInfo.createdAt,
      expiresAt: tokenInfo.expiresAt,
    }, 201);
  }

  if (path === "/api/tokens" && method === "GET") {
    const tokens = await listApiTokens(auth.userId);
    const now = Date.now();
    const masked = tokens.map((t) => ({
      id: t.id,
      name: t.name,
      tokenMasked: t.token.slice(0, 7) + "..." + t.token.slice(-4),
      createdAt: t.createdAt,
      expiresAt: t.expiresAt,
      expired: Boolean(t.expiresAt && new Date(t.expiresAt).getTime() < now),
    }));
    return jsonResponse({ tokens: masked });
  }

  if (path.startsWith("/api/tokens/") && method === "DELETE") {
    const tokenId = path.slice("/api/tokens/".length).trim();
    const success = await revokeApiToken(auth.userId, tokenId);
    if (!success) {
      return errorResponse("Token not found or already revoked.", 404);
    }
    return jsonResponse({ message: "Token revoked successfully." });
  }

  return null;
}
