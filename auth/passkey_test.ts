import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  createAddPasskeyOptions,
  createPasskeyAuthenticationOptions,
  createPasskeyRegistrationOptions,
  deleteUserPasskey,
  listUserPasskeys,
} from "./passkey.ts";
import { handleHttpRequest } from "../http_server.ts";
import { createApiToken } from "./oauth.ts";
import { setKv } from "../store/kv.ts";

Deno.test("Passkey WebAuthn - Registration and Authentication Options Generation", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    // 1. Generate Registration Options for new user
    const regResult = await createPasskeyRegistrationOptions(
      "localhost",
      "alice",
      "Alice Wonderland",
    );
    assert(regResult.challengeId);
    assert(regResult.options.challenge);
    assertEquals((regResult.options.rp as { name: string }).name, "Workflow MCP");
    assertEquals((regResult.options.user as { name: string }).name, "alice");

    // Mock completing registration for alice in KV
    await kv.set(["users_by_username", "alice"], "user_alice123");
    await kv.set(["users", "user_alice123", "profile"], {
      userId: "user_alice123",
      username: "alice",
      displayName: "Alice Wonderland",
      createdAt: new Date().toISOString(),
      passkeyCount: 1,
    });
    await kv.set(["users", "user_alice123", "passkeys", "cred_1"], {
      id: "cred_1",
      publicKey: "pubkey1",
      counter: 0,
      createdAt: new Date().toISOString(),
    });

    // 2. Reject registering the same username again (Account Takeover Prevention)
    await assertRejects(
      async () => {
        await createPasskeyRegistrationOptions("localhost", "alice");
      },
      Error,
      "already taken",
    );

    // 3. Generate Authenticated Add Passkey Options for existing user
    const addResult = await createAddPasskeyOptions("localhost", "user_alice123");
    assert(addResult.challengeId);
    assert(addResult.options.challenge);
    const excludeCreds = addResult.options.excludeCredentials as Array<{ id: string }>;
    assertEquals(excludeCreds.length, 1);
    assertEquals(excludeCreds[0].id, "cred_1");

    // 4. Generate Authentication Options (Discoverable Resident Key)
    const authDiscoverable = await createPasskeyAuthenticationOptions("localhost");
    assert(authDiscoverable.challengeId);
    assert(authDiscoverable.options.challenge);

    // 5. Generate Authentication Options for specific user
    const authUser = await createPasskeyAuthenticationOptions("localhost", "alice");
    assert(authUser.challengeId);
    assert(authUser.options.challenge);
  } finally {
    kv.close();
  }
});

Deno.test("Passkey WebAuthn - Passkey Deletion Guardrails", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    const userId = "user_multi";
    await kv.set(["users", userId, "passkeys", "key_1"], {
      id: "key_1",
      publicKey: "pub1",
      counter: 0,
      createdAt: new Date().toISOString(),
    });

    // Cannot delete the only registered passkey
    const delOnlyRes = await deleteUserPasskey(userId, "key_1");
    assertEquals(delOnlyRes.success, false);
    assert(delOnlyRes.error?.includes("only registered passkey"));

    // Add a second key
    await kv.set(["users", userId, "passkeys", "key_2"], {
      id: "key_2",
      publicKey: "pub2",
      counter: 0,
      createdAt: new Date().toISOString(),
    });

    // Now deletion of one key succeeds
    const delRes = await deleteUserPasskey(userId, "key_1");
    assertEquals(delRes.success, true);

    const remaining = await listUserPasskeys(userId);
    assertEquals(remaining.length, 1);
    assertEquals(remaining[0].id, "key_2");
  } finally {
    kv.close();
  }
});

Deno.test("Passkey WebAuthn - HTTP Endpoints integration & Conflict Prevention", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    // 1. Request registration options via HTTP
    const regReq = new Request("http://localhost:8000/auth/passkey/register-options", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "bob", displayName: "Bob Builder" }),
    });
    const regRes = await handleHttpRequest(regReq);
    assertEquals(regRes.status, 200);
    const regData = await regRes.json();
    assert(regData.challengeId);
    assert(regData.options.challenge);
    assertEquals(regData.options.user.name, "bob");

    // Mock existing user Bob in KV
    await kv.set(["users_by_username", "bob"], "user_bob");

    // 2. Duplicate registration attempt should return 409 Conflict
    const dupRegReq = new Request("http://localhost:8000/auth/passkey/register-options", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "bob" }),
    });
    const dupRegRes = await handleHttpRequest(dupRegReq);
    assertEquals(dupRegRes.status, 409);
    const dupData = await dupRegRes.json();
    assert(dupData.error.includes("already taken"));

    // 3. Missing username should fail with 400
    const invalidRegReq = new Request("http://localhost:8000/auth/passkey/register-options", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "" }),
    });
    const invalidRegRes = await handleHttpRequest(invalidRegReq);
    assertEquals(invalidRegRes.status, 400);

    // 4. Request login options via HTTP
    const loginReq = new Request("http://localhost:8000/auth/passkey/login-options", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "bob" }),
    });
    const loginRes = await handleHttpRequest(loginReq);
    assertEquals(loginRes.status, 200);
    const loginData = await loginRes.json();
    assert(loginData.challengeId);
    assert(loginData.options.challenge);

    // 5. Authenticated Add Passkey Options via HTTP
    const bobToken = (await createApiToken("user_bob", "Bob Test Token")).token;
    const addOptReq = new Request("http://localhost:8000/api/passkeys/add-options", {
      method: "POST",
      headers: { "Authorization": `Bearer ${bobToken}` },
    });
    const addOptRes = await handleHttpRequest(addOptReq);
    assertEquals(addOptRes.status, 200);
    const addOptData = await addOptRes.json();
    assert(addOptData.challengeId);
    assert(addOptData.options.challenge);

    // 6. List passkeys for non-existent user should return empty array
    const emptyKeys = await listUserPasskeys("non_existent_user");
    assertEquals(emptyKeys.length, 0);
  } finally {
    kv.close();
  }
});
