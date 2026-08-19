import { assert, assertEquals } from "@std/assert";
import {
  createPasskeyAuthenticationOptions,
  createPasskeyRegistrationOptions,
  listUserPasskeys,
} from "./passkey.ts";
import { handleHttpRequest } from "../http_server.ts";
import { setKv } from "../store/kv.ts";

Deno.test("Passkey WebAuthn - Registration and Authentication Options Generation", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    // 1. Generate Registration Options
    const regResult = await createPasskeyRegistrationOptions(
      "localhost",
      "alice",
      "Alice Wonderland",
    );
    assert(regResult.challengeId);
    assert(regResult.options.challenge);
    assertEquals((regResult.options.rp as { name: string }).name, "Workflow MCP");
    assertEquals((regResult.options.user as { name: string }).name, "alice");

    // 2. Generate Authentication Options (Discoverable Resident Key)
    const authDiscoverable = await createPasskeyAuthenticationOptions("localhost");
    assert(authDiscoverable.challengeId);
    assert(authDiscoverable.options.challenge);

    // 3. Generate Authentication Options for specific user
    const authUser = await createPasskeyAuthenticationOptions("localhost", "alice");
    assert(authUser.challengeId);
    assert(authUser.options.challenge);
  } finally {
    kv.close();
  }
});

Deno.test("Passkey WebAuthn - HTTP Endpoints integration", async () => {
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

    // 2. Missing username should fail with 400
    const invalidRegReq = new Request("http://localhost:8000/auth/passkey/register-options", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "" }),
    });
    const invalidRegRes = await handleHttpRequest(invalidRegReq);
    assertEquals(invalidRegRes.status, 400);

    // 3. Request login options via HTTP
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

    // 4. List passkeys for non-existent user should return empty array
    const emptyKeys = await listUserPasskeys("non_existent_user");
    assertEquals(emptyKeys.length, 0);
  } finally {
    kv.close();
  }
});
