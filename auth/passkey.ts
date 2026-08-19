/**
 * WebAuthn & Passkey Authentication Engine.
 *
 * Provides 100% third-party-free, cryptographic biometric login (Touch ID, Face ID,
 * Windows Hello, security keys) using WebAuthn standards and Deno KV persistence.
 */

import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  RegistrationResponseJSON,
} from "@simplewebauthn/types";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { getKv } from "../store/kv.ts";

export interface StoredPasskey {
  id: string;
  publicKey: string; // base64url encoded Uint8Array
  counter: number;
  transports?: AuthenticatorTransportFuture[];
  backedUp?: boolean;
  deviceType?: string;
  createdAt: string;
}

export interface UserPasskeyProfile {
  userId: string;
  username: string;
  displayName: string;
  createdAt: string;
  passkeyCount: number;
}

interface StoredChallenge {
  challenge: string;
  userId?: string;
  username?: string;
  createdAt: number;
}

function uint8ArrayToBase64Url(bytes: Uint8Array): string {
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlToUint8Array(base64url: string): Uint8Array {
  try {
    const base64 = base64url
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(base64url.length + (4 - (base64url.length % 4)) % 4, "=");
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    throw new Error("Invalid base64url string format.");
  }
}

/**
 * Generates WebAuthn registration options for creating a new Passkey.
 */
export async function createPasskeyRegistrationOptions(
  rpID: string,
  username: string,
  displayName?: string,
): Promise<{ options: Record<string, unknown>; challengeId: string }> {
  if (!username || typeof username !== "string" || username.trim().length === 0) {
    throw new Error("Username cannot be empty.");
  }

  const kv = await getKv();
  const cleanUsername = username.trim().toLowerCase();

  // Find existing userId or create new one
  const userEntry = await kv.get<string>(["users_by_username", cleanUsername]);
  const userId = userEntry.value || ("user_" + crypto.randomUUID().slice(0, 8));

  // Get existing user passkeys to exclude re-registering the same key
  const existingPasskeys: Array<{ id: string; transports?: AuthenticatorTransportFuture[] }> = [];
  for await (const entry of kv.list<StoredPasskey>({ prefix: ["users", userId, "passkeys"] })) {
    if (entry.value) {
      existingPasskeys.push({
        id: entry.value.id,
        transports: entry.value.transports,
      });
    }
  }

  const options = await generateRegistrationOptions({
    rpName: "Workflow MCP",
    rpID,
    userID: new TextEncoder().encode(userId),
    userName: cleanUsername,
    userDisplayName: displayName?.trim() || username.trim(),
    attestationType: "none",
    excludeCredentials: existingPasskeys,
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
  });

  const challengeId = crypto.randomUUID();
  const challengeRecord: StoredChallenge = {
    challenge: options.challenge,
    userId,
    username: cleanUsername,
    createdAt: Date.now(),
  };

  // Store challenge with a 5-minute TTL
  await kv.set(["challenges", challengeId], challengeRecord, { expireIn: 300_000 });

  return {
    options: options as unknown as Record<string, unknown>,
    challengeId,
  };
}

/**
 * Verifies the WebAuthn registration response and persists the new Passkey.
 */
export async function verifyPasskeyRegistration(
  rpID: string,
  expectedOrigin: string,
  challengeId: string,
  body: RegistrationResponseJSON,
): Promise<{ verified: boolean; userId?: string; username?: string; error?: string }> {
  if (!body || typeof body !== "object" || !body.id || !body.response) {
    return { verified: false, error: "Invalid registration response payload." };
  }

  const kv = await getKv();
  const challengeEntry = await kv.get<StoredChallenge>(["challenges", challengeId]);

  if (!challengeEntry.value) {
    return { verified: false, error: "Challenge expired or invalid. Please try again." };
  }

  const { challenge, userId, username } = challengeEntry.value;
  await kv.delete(["challenges", challengeId]);

  if (!userId || !username) {
    return { verified: false, error: "Invalid challenge session." };
  }

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: body,
      expectedChallenge: challenge,
      expectedOrigin,
      expectedRPID: rpID,
    });
  } catch (err) {
    return {
      verified: false,
      error: `Verification failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (verification.verified && verification.registrationInfo) {
    const {
      credentialID,
      credentialPublicKey,
      counter,
      credentialDeviceType,
      credentialBackedUp,
    } = verification.registrationInfo;

    const storedPasskey: StoredPasskey = {
      id: credentialID,
      publicKey: uint8ArrayToBase64Url(credentialPublicKey),
      counter,
      transports: body.response?.transports as AuthenticatorTransportFuture[] | undefined,
      backedUp: credentialBackedUp,
      deviceType: credentialDeviceType,
      createdAt: new Date().toISOString(),
    };

    const count = await existingPasskeyCount(kv, userId);
    const userProfile: UserPasskeyProfile = {
      userId,
      username,
      displayName: username,
      createdAt: new Date().toISOString(),
      passkeyCount: count + 1,
    };

    await kv.atomic()
      .set(["users", userId, "passkeys", credentialID], storedPasskey)
      .set(["passkeys_by_id", credentialID], { userId, username, passkey: storedPasskey })
      .set(["users_by_username", username], userId)
      .set(["users", userId, "profile"], userProfile)
      .commit();

    return {
      verified: true,
      userId,
      username,
    };
  }

  return { verified: false, error: "Failed to verify registration credentials." };
}

async function existingPasskeyCount(kv: Deno.Kv, userId: string): Promise<number> {
  let count = 0;
  for await (const _ of kv.list({ prefix: ["users", userId, "passkeys"] })) {
    count++;
  }
  return count;
}

/**
 * Generates WebAuthn authentication options for signing in with an existing Passkey.
 */
export async function createPasskeyAuthenticationOptions(
  rpID: string,
  username?: string,
): Promise<{ options: Record<string, unknown>; challengeId: string }> {
  const kv = await getKv();
  const allowCredentials: Array<{ id: string; transports?: AuthenticatorTransportFuture[] }> = [];
  let targetUserId: string | undefined;

  if (username && username.trim().length > 0) {
    const cleanUsername = username.trim().toLowerCase();
    const userEntry = await kv.get<string>(["users_by_username", cleanUsername]);
    if (userEntry.value) {
      targetUserId = userEntry.value;
      for await (
        const entry of kv.list<StoredPasskey>({ prefix: ["users", targetUserId, "passkeys"] })
      ) {
        if (entry.value) {
          allowCredentials.push({
            id: entry.value.id,
            transports: entry.value.transports,
          });
        }
      }
    }
  }

  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: allowCredentials.length > 0 ? allowCredentials : undefined,
    userVerification: "preferred",
  });

  const challengeId = crypto.randomUUID();
  const challengeRecord: StoredChallenge = {
    challenge: options.challenge,
    userId: targetUserId,
    username: username?.trim().toLowerCase(),
    createdAt: Date.now(),
  };

  await kv.set(["challenges", challengeId], challengeRecord, { expireIn: 300_000 });

  return {
    options: options as unknown as Record<string, unknown>,
    challengeId,
  };
}

/**
 * Verifies the WebAuthn authentication response against stored passkey credentials.
 */
export async function verifyPasskeyAuthentication(
  rpID: string,
  expectedOrigin: string,
  challengeId: string,
  body: AuthenticationResponseJSON,
): Promise<{ verified: boolean; userId?: string; username?: string; error?: string }> {
  if (!body || typeof body !== "object" || !body.id || !body.response) {
    return { verified: false, error: "Invalid authentication response payload." };
  }

  const kv = await getKv();
  const challengeEntry = await kv.get<StoredChallenge>(["challenges", challengeId]);

  if (!challengeEntry.value) {
    return { verified: false, error: "Challenge expired or invalid. Please try again." };
  }

  const { challenge } = challengeEntry.value;
  await kv.delete(["challenges", challengeId]);

  const credentialId = body.id;
  if (!credentialId) {
    return { verified: false, error: "Missing credential ID in authentication response." };
  }

  // Look up passkey by credential ID
  const passkeyEntry = await kv.get<{ userId: string; username: string; passkey: StoredPasskey }>([
    "passkeys_by_id",
    credentialId,
  ]);

  if (!passkeyEntry.value) {
    return { verified: false, error: "Passkey not recognized or not registered." };
  }

  const { userId, username, passkey } = passkeyEntry.value;

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: body,
      expectedChallenge: challenge,
      expectedOrigin,
      expectedRPID: rpID,
      authenticator: {
        credentialID: passkey.id,
        credentialPublicKey: base64UrlToUint8Array(passkey.publicKey),
        counter: passkey.counter,
        transports: passkey.transports,
      },
    });
  } catch (err) {
    return {
      verified: false,
      error: `Authentication failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (verification.verified) {
    // Update counter
    passkey.counter = verification.authenticationInfo.newCounter;
    await kv.atomic()
      .set(["users", userId, "passkeys", passkey.id], passkey)
      .set(["passkeys_by_id", passkey.id], { userId, username, passkey })
      .commit();

    return {
      verified: true,
      userId,
      username,
    };
  }

  return { verified: false, error: "Failed to verify authentication signature." };
}

/**
 * Lists all registered passkeys for a user.
 */
export async function listUserPasskeys(userId: string): Promise<StoredPasskey[]> {
  if (!userId || typeof userId !== "string" || userId.trim().length === 0) {
    return [];
  }
  const kv = await getKv();
  const passkeys: StoredPasskey[] = [];
  for await (
    const entry of kv.list<StoredPasskey>({ prefix: ["users", userId.trim(), "passkeys"] })
  ) {
    if (entry.value) {
      passkeys.push(entry.value);
    }
  }
  return passkeys;
}
