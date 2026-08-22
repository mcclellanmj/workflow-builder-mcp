/**
 * Authenticated Passkey and WebAuthn management route handlers.
 * Allows logged-in users to associate multiple passkeys (e.g. across multiple computers or security keys).
 */

import type { AuthResult } from "../auth/oauth.ts";
import {
  createAddPasskeyOptions,
  deleteUserPasskey,
  listUserPasskeys,
  verifyPasskeyRegistration,
} from "../auth/passkey.ts";
import { errorResponse, jsonResponse } from "./common.ts";

export async function handlePasskeyManagementRoutes(
  req: Request,
  url: URL,
  auth: AuthResult,
): Promise<Response | null> {
  const path = url.pathname;
  const method = req.method.toUpperCase();

  // 1. Generate options to add another passkey for the authenticated user
  if (path === "/api/passkeys/add-options" && method === "POST") {
    try {
      const { options, challengeId } = await createAddPasskeyOptions(
        url.hostname,
        auth.userId,
      );
      return jsonResponse({ options, challengeId });
    } catch (err) {
      return errorResponse(
        err instanceof Error ? err.message : String(err),
        400,
      );
    }
  }

  // 2. Verify and associate the newly created passkey
  if (path === "/api/passkeys/add-verify" && method === "POST") {
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
      if (result.userId !== auth.userId) {
        return errorResponse("User mismatch during passkey registration.", 403);
      }
      return jsonResponse({
        verified: true,
        message: "New passkey registered and associated successfully.",
        userId: result.userId,
      });
    }

    return errorResponse(result.error || "Passkey verification failed.", 400);
  }

  // 3. List all passkeys registered to the authenticated user
  if (path === "/api/passkeys" && method === "GET") {
    const passkeys = await listUserPasskeys(auth.userId);
    const sanitized = passkeys.map((p) => ({
      id: p.id,
      deviceType: p.deviceType || "singleDevice",
      backedUp: p.backedUp ?? false,
      transports: p.transports || [],
      createdAt: p.createdAt,
    }));
    return jsonResponse({ passkeys: sanitized });
  }

  // 4. Delete an individual passkey
  if (path.startsWith("/api/passkeys/") && method === "DELETE") {
    const credentialId = path.slice("/api/passkeys/".length).trim();
    if (!credentialId) {
      return errorResponse("Missing passkey ID.", 400);
    }

    const res = await deleteUserPasskey(auth.userId, credentialId);
    if (!res.success) {
      return errorResponse(res.error || "Failed to delete passkey.", 400);
    }

    return jsonResponse({ message: "Passkey deleted successfully." });
  }

  return null;
}
