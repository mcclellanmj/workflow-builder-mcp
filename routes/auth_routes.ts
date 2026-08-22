/**
 * Passkey WebAuthn and OAuth authentication HTTP route handlers.
 */

import { createSession, handleCallback, signIn, signOut } from "../auth/oauth.ts";
import {
  createPasskeyAuthenticationOptions,
  createPasskeyRegistrationOptions,
  verifyPasskeyAuthentication,
  verifyPasskeyRegistration,
} from "../auth/passkey.ts";
import { errorResponse, jsonResponse } from "./common.ts";

export async function handleAuthRoutes(req: Request, url: URL): Promise<Response | null> {
  const path = url.pathname;
  const method = req.method.toUpperCase();

  // Passkey Registration Options
  if (path === "/auth/passkey/register-options" && method === "POST") {
    const body = await req.json().catch(() => ({}));
    const username = typeof body?.username === "string" ? body.username : "";
    const displayName = typeof body?.displayName === "string" ? body.displayName : username;

    if (!username || username.trim().length === 0) {
      return errorResponse("Username is required for registration.", 400);
    }

    try {
      const { options, challengeId } = await createPasskeyRegistrationOptions(
        url.hostname,
        username,
        displayName,
      );
      return jsonResponse({ options, challengeId });
    } catch (err) {
      const isConflict = (err as Error & { code?: string })?.code === "USER_EXISTS" ||
        (err instanceof Error && err.message.includes("already taken"));
      return errorResponse(
        err instanceof Error ? err.message : String(err),
        isConflict ? 409 : 400,
      );
    }
  }

  // Passkey Registration Verify
  if (path === "/auth/passkey/register-verify" && method === "POST") {
    const body = await req.json().catch(() => ({}));
    const challengeId = body?.challengeId;
    const credentialResponse = body?.response;

    if (!challengeId || !credentialResponse) {
      return errorResponse("Missing challengeId or response payload.", 400);
    }

    const result = await verifyPasskeyRegistration(
      url.hostname,
      url.origin,
      challengeId,
      credentialResponse,
    );

    if (result.verified && result.userId) {
      const { cookieHeader, session } = await createSession(
        result.userId,
        result.username,
        undefined,
        "passkey",
      );
      return jsonResponse(
        {
          verified: true,
          userId: result.userId,
          username: result.username,
          user: session,
        },
        200,
        { "Set-Cookie": cookieHeader },
      );
    }

    return errorResponse(result.error || "Registration failed.", 400);
  }

  // Passkey Login Options
  if (path === "/auth/passkey/login-options" && method === "POST") {
    const body = await req.json().catch(() => ({}));
    const username = typeof body?.username === "string" ? body.username : undefined;

    const { options, challengeId } = await createPasskeyAuthenticationOptions(
      url.hostname,
      username,
    );
    return jsonResponse({ options, challengeId });
  }

  // Passkey Login Verify
  if (path === "/auth/passkey/login-verify" && method === "POST") {
    const body = await req.json().catch(() => ({}));
    const challengeId = body?.challengeId;
    const credentialResponse = body?.response;

    if (!challengeId || !credentialResponse) {
      return errorResponse("Missing challengeId or response payload.", 400);
    }

    const result = await verifyPasskeyAuthentication(
      url.hostname,
      url.origin,
      challengeId,
      credentialResponse,
    );

    if (result.verified && result.userId) {
      const { cookieHeader, session } = await createSession(
        result.userId,
        result.username,
        undefined,
        "passkey",
      );
      return jsonResponse(
        {
          verified: true,
          userId: result.userId,
          username: result.username,
          user: session,
        },
        200,
        { "Set-Cookie": cookieHeader },
      );
    }

    return errorResponse(result.error || "Authentication failed.", 400);
  }

  // OAuth Routes
  if (path === "/oauth/signin" && method === "GET") {
    return await signIn(req);
  }
  if (path === "/oauth/callback" && method === "GET") {
    return await handleCallback(req);
  }
  if (path === "/oauth/signout" && method === "GET") {
    return await signOut(req);
  }

  return null;
}
