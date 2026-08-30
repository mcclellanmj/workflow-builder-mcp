import { assert, assertEquals, assertExists } from "@std/assert";
import { createSession } from "../auth/oauth.ts";
import { handleHttpRequest } from "../http_server.ts";
import { setKv } from "../store/kv.ts";
import { handleAuthRoutes } from "./auth_routes.ts";

Deno.test("Auth Routes - Passkey Registration Options (POST /auth/passkey/register-options)", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    // 1. Success: valid username and displayName
    const validReq = new Request("http://localhost:8000/auth/passkey/register-options", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "alice",
        displayName: "Alice In Wonderland",
      }),
    });
    const validRes = await handleHttpRequest(validReq);
    assertEquals(validRes.status, 200);
    const validData = await validRes.json();
    assertExists(validData.challengeId);
    assertExists(validData.options);
    assertExists(validData.options.challenge);
    assertEquals(validData.options.user.name, "alice");
    assertEquals(validData.options.user.displayName, "Alice In Wonderland");

    // 2. Success: username only (fallback displayName)
    const usernameOnlyReq = new Request("http://localhost:8000/auth/passkey/register-options", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "bob" }),
    });
    const usernameOnlyRes = await handleHttpRequest(usernameOnlyReq);
    assertEquals(usernameOnlyRes.status, 200);
    const usernameOnlyData = await usernameOnlyRes.json();
    assertEquals(usernameOnlyData.options.user.name, "bob");
    assertEquals(usernameOnlyData.options.user.displayName, "bob");

    // 3. Validation Error: Missing username
    const missingReq = new Request("http://localhost:8000/auth/passkey/register-options", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "No Username" }),
    });
    const missingRes = await handleHttpRequest(missingReq);
    assertEquals(missingRes.status, 400);
    const missingData = await missingRes.json();
    assert(missingData.error.includes("Username is required for registration."));

    // 4. Validation Error: Empty / whitespace username
    const emptyReq = new Request("http://localhost:8000/auth/passkey/register-options", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "   " }),
    });
    const emptyRes = await handleHttpRequest(emptyReq);
    assertEquals(emptyRes.status, 400);
    const emptyData = await emptyRes.json();
    assert(emptyData.error.includes("Username is required for registration."));

    // 5. Validation Error: Invalid/empty non-JSON body
    const invalidBodyReq = new Request("http://localhost:8000/auth/passkey/register-options", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "not-a-json",
    });
    const invalidBodyRes = await handleHttpRequest(invalidBodyReq);
    assertEquals(invalidBodyRes.status, 400);
    const invalidBodyData = await invalidBodyRes.json();
    assert(invalidBodyData.error.includes("Username is required for registration."));

    // 6. Conflict Error (409): Existing username in KV
    await kv.set(["users_by_username", "charlie"], "user_charlie123");
    const conflictReq = new Request("http://localhost:8000/auth/passkey/register-options", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "charlie" }),
    });
    const conflictRes = await handleHttpRequest(conflictReq);
    assertEquals(conflictRes.status, 409);
    const conflictData = await conflictRes.json();
    assert(conflictData.error.includes("already taken"));
  } finally {
    kv.close();
  }
});

Deno.test("Auth Routes - Passkey Login Options (POST /auth/passkey/login-options)", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    // 1. Success: Discoverable authentication options (no username specified)
    const discoverableReq = new Request("http://localhost:8000/auth/passkey/login-options", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const discoverableRes = await handleHttpRequest(discoverableReq);
    assertEquals(discoverableRes.status, 200);
    const discoverableData = await discoverableRes.json();
    assertExists(discoverableData.challengeId);
    assertExists(discoverableData.options);
    assertExists(discoverableData.options.challenge);

    // 2. Success: Non-JSON / empty body fallback
    const emptyBodyReq = new Request("http://localhost:8000/auth/passkey/login-options", {
      method: "POST",
    });
    const emptyBodyRes = await handleHttpRequest(emptyBodyReq);
    assertEquals(emptyBodyRes.status, 200);
    const emptyBodyData = await emptyBodyRes.json();
    assertExists(emptyBodyData.challengeId);
    assertExists(emptyBodyData.options);

    // 3. Success: User-specific authentication options for registered user with credentials
    const userId = "user_david";
    await kv.set(["users_by_username", "david"], userId);
    await kv.set(["users", userId, "profile"], {
      userId,
      username: "david",
      displayName: "David Goliath",
      createdAt: new Date().toISOString(),
      passkeyCount: 1,
    });
    await kv.set(["users", userId, "passkeys", "cred_key_david"], {
      id: "cred_key_david",
      publicKey: "pubkey_david",
      counter: 0,
      createdAt: new Date().toISOString(),
    });

    const userLoginReq = new Request("http://localhost:8000/auth/passkey/login-options", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "david" }),
    });
    const userLoginRes = await handleHttpRequest(userLoginReq);
    assertEquals(userLoginRes.status, 200);
    const userLoginData = await userLoginRes.json();
    assertExists(userLoginData.challengeId);
    assertExists(userLoginData.options);
    assert(Array.isArray(userLoginData.options.allowCredentials));
    assertEquals(userLoginData.options.allowCredentials.length, 1);
    assertEquals(userLoginData.options.allowCredentials[0].id, "cred_key_david");

    // 4. Success: User-specific options for unregistered username (graceful fallback)
    const unknownUserReq = new Request("http://localhost:8000/auth/passkey/login-options", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "unknown_user" }),
    });
    const unknownUserRes = await handleHttpRequest(unknownUserReq);
    assertEquals(unknownUserRes.status, 200);
    const unknownUserData = await unknownUserRes.json();
    assertExists(unknownUserData.challengeId);
    assertExists(unknownUserData.options);
  } finally {
    kv.close();
  }
});

Deno.test("Auth Routes - Passkey Registration Verification (POST /auth/passkey/register-verify)", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    // 1. Missing challengeId
    const missingChallengeReq = new Request("http://localhost:8000/auth/passkey/register-verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ response: { id: "cred_1" } }),
    });
    const missingChallengeRes = await handleHttpRequest(missingChallengeReq);
    assertEquals(missingChallengeRes.status, 400);
    const missingChallengeData = await missingChallengeRes.json();
    assert(missingChallengeData.error.includes("Missing challengeId or response payload."));

    // 2. Missing response payload
    const missingRespReq = new Request("http://localhost:8000/auth/passkey/register-verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ challengeId: "chal_123" }),
    });
    const missingRespRes = await handleHttpRequest(missingRespReq);
    assertEquals(missingRespRes.status, 400);
    const missingRespData = await missingRespRes.json();
    assert(missingRespData.error.includes("Missing challengeId or response payload."));

    // 3. Non-JSON / empty body
    const emptyBodyReq = new Request("http://localhost:8000/auth/passkey/register-verify", {
      method: "POST",
    });
    const emptyBodyRes = await handleHttpRequest(emptyBodyReq);
    assertEquals(emptyBodyRes.status, 400);
    const emptyBodyData = await emptyBodyRes.json();
    assert(emptyBodyData.error.includes("Missing challengeId or response payload."));

    // 4. Expired or non-existent challenge ID
    const expiredReq = new Request("http://localhost:8000/auth/passkey/register-verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        challengeId: "non_existent_challenge",
        response: {
          id: "cred_sample",
          rawId: "cred_sample",
          response: {
            clientDataJSON: "e30",
            attestationObject: "e30",
          },
          type: "public-key",
        },
      }),
    });
    const expiredRes = await handleHttpRequest(expiredReq);
    assertEquals(expiredRes.status, 400);
    const expiredData = await expiredRes.json();
    assert(expiredData.error.includes("Challenge expired or invalid"));

    // 5. Invalid challenge session record (missing userId/username)
    await kv.set(["challenges", "malformed_chal"], {
      challenge: "random_challenge_str",
      createdAt: Date.now(),
    });
    const malformedReq = new Request("http://localhost:8000/auth/passkey/register-verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        challengeId: "malformed_chal",
        response: {
          id: "cred_sample",
          rawId: "cred_sample",
          response: {
            clientDataJSON: "e30",
            attestationObject: "e30",
          },
          type: "public-key",
        },
      }),
    });
    const malformedRes = await handleHttpRequest(malformedReq);
    assertEquals(malformedRes.status, 400);
    const malformedData = await malformedRes.json();
    assert(malformedData.error.includes("Invalid challenge session"));

    // 6. Verification failure with simulated payload
    await kv.set(["challenges", "chal_test_verify"], {
      challenge: "expected_challenge",
      userId: "user_test_verify",
      username: "test_verify_user",
      createdAt: Date.now(),
    });
    const invalidVerifyReq = new Request("http://localhost:8000/auth/passkey/register-verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        challengeId: "chal_test_verify",
        response: {
          id: "cred_sample",
          rawId: "cred_sample",
          response: {
            clientDataJSON: "e30",
            attestationObject: "e30",
          },
          type: "public-key",
        },
      }),
    });
    const invalidVerifyRes = await handleHttpRequest(invalidVerifyReq);
    assertEquals(invalidVerifyRes.status, 400);
    const invalidVerifyData = await invalidVerifyRes.json();
    assert(invalidVerifyData.error.includes("Verification failed"));
  } finally {
    kv.close();
  }
});

Deno.test("Auth Routes - Passkey Login Verification (POST /auth/passkey/login-verify)", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    // 1. Missing challengeId
    const missingChallengeReq = new Request("http://localhost:8000/auth/passkey/login-verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ response: { id: "cred_1" } }),
    });
    const missingChallengeRes = await handleHttpRequest(missingChallengeReq);
    assertEquals(missingChallengeRes.status, 400);
    const missingChallengeData = await missingChallengeRes.json();
    assert(missingChallengeData.error.includes("Missing challengeId or response payload."));

    // 2. Missing response payload
    const missingRespReq = new Request("http://localhost:8000/auth/passkey/login-verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ challengeId: "chal_login_123" }),
    });
    const missingRespRes = await handleHttpRequest(missingRespReq);
    assertEquals(missingRespRes.status, 400);
    const missingRespData = await missingRespRes.json();
    assert(missingRespData.error.includes("Missing challengeId or response payload."));

    // 3. Non-JSON / empty body
    const emptyBodyReq = new Request("http://localhost:8000/auth/passkey/login-verify", {
      method: "POST",
    });
    const emptyBodyRes = await handleHttpRequest(emptyBodyReq);
    assertEquals(emptyBodyRes.status, 400);
    const emptyBodyData = await emptyBodyRes.json();
    assert(emptyBodyData.error.includes("Missing challengeId or response payload."));

    // 4. Expired or invalid challenge
    const expiredReq = new Request("http://localhost:8000/auth/passkey/login-verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        challengeId: "expired_login_chal",
        response: {
          id: "cred_login_1",
          rawId: "cred_login_1",
          response: {
            clientDataJSON: "e30",
            authenticatorData: "e30",
            signature: "e30",
          },
          type: "public-key",
        },
      }),
    });
    const expiredRes = await handleHttpRequest(expiredReq);
    assertEquals(expiredRes.status, 400);
    const expiredData = await expiredRes.json();
    assert(expiredData.error.includes("Challenge expired or invalid"));

    // 5. Passkey not recognized / not registered
    await kv.set(["challenges", "chal_unreg_key"], {
      challenge: "test_chal_login",
      userId: "user_login_test",
      username: "login_test_user",
      createdAt: Date.now(),
    });
    const unregReq = new Request("http://localhost:8000/auth/passkey/login-verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        challengeId: "chal_unreg_key",
        response: {
          id: "unregistered_credential_id",
          rawId: "unregistered_credential_id",
          response: {
            clientDataJSON: "e30",
            authenticatorData: "e30",
            signature: "e30",
          },
          type: "public-key",
        },
      }),
    });
    const unregRes = await handleHttpRequest(unregReq);
    assertEquals(unregRes.status, 400);
    const unregData = await unregRes.json();
    assert(unregData.error.includes("Passkey not recognized or not registered"));

    // 6. Verification failure when passkey is registered but signature invalid
    await kv.set(["passkeys_by_id", "cred_fake_key"], {
      userId: "user_registered_test",
      username: "reg_user",
      passkey: {
        id: "cred_fake_key",
        publicKey: "dGVzdF9wdWJsaWNfa2V5",
        counter: 0,
        createdAt: new Date().toISOString(),
      },
    });
    await kv.set(["challenges", "chal_registered_key"], {
      challenge: "test_chal_reg",
      userId: "user_registered_test",
      username: "reg_user",
      createdAt: Date.now(),
    });
    const failedVerifyReq = new Request("http://localhost:8000/auth/passkey/login-verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        challengeId: "chal_registered_key",
        response: {
          id: "cred_fake_key",
          rawId: "cred_fake_key",
          response: {
            clientDataJSON: "e30",
            authenticatorData: "e30",
            signature: "e30",
          },
          type: "public-key",
        },
      }),
    });
    const failedVerifyRes = await handleHttpRequest(failedVerifyReq);
    assertEquals(failedVerifyRes.status, 400);
    const failedVerifyData = await failedVerifyRes.json();
    assert(failedVerifyData.error.includes("Authentication failed"));
  } finally {
    kv.close();
  }
});

Deno.test("Auth Routes - OAuth Provider Routes (/oauth/signin, /oauth/callback, /oauth/signout)", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    // 1. /oauth/signin without OAuth configured -> 500 JSON
    const signinReq = new Request("http://localhost:8000/oauth/signin", { method: "GET" });
    const signinRes = await handleHttpRequest(signinReq);
    assertEquals(signinRes.status, 500);
    const signinData = await signinRes.json();
    assert(signinData.error.includes("OAuth is not configured"));

    // 2. /oauth/callback without OAuth configured -> 500 JSON
    const callbackReq = new Request("http://localhost:8000/oauth/callback?code=abc&state=xyz", {
      method: "GET",
    });
    const callbackRes = await handleHttpRequest(callbackReq);
    assertEquals(callbackRes.status, 500);
    const callbackData = await callbackRes.json();
    assert(callbackData.error.includes("OAuth is not configured"));

    // 3. /oauth/signout without session cookie
    const signoutAnonReq = new Request("http://localhost:8000/oauth/signout", { method: "GET" });
    const signoutAnonRes = await handleHttpRequest(signoutAnonReq);
    assertEquals(signoutAnonRes.status, 302);

    // 4. /oauth/signout with active session cookie
    const { cookieHeader, sessionId } = await createSession("user_signout_test", "Signout Test");
    const signoutReq = new Request("http://localhost:8000/oauth/signout", {
      method: "GET",
      headers: { "Cookie": cookieHeader },
    });
    const signoutRes = await handleHttpRequest(signoutReq);
    assertEquals(signoutRes.status, 302); // kvSignOut redirects (302/303)
    // Verify session was removed from KV
    const sessionEntry = await kv.get(["sessions", sessionId]);
    assertEquals(sessionEntry.value, null);

    // 5. Test OAuth signin with GitHub configured environment variables
    Deno.env.set("GITHUB_CLIENT_ID", "gh_test_client_id");
    Deno.env.set("GITHUB_CLIENT_SECRET", "gh_test_client_secret");
    try {
      const ghSigninReq = new Request("http://localhost:8000/oauth/signin", { method: "GET" });
      const ghSigninRes = await handleHttpRequest(ghSigninReq);
      assertEquals(ghSigninRes.status, 302);
      const location = ghSigninRes.headers.get("location");
      assert(location?.includes("github.com/login/oauth/authorize"));
      assert(location?.includes("client_id=gh_test_client_id"));
    } finally {
      Deno.env.delete("GITHUB_CLIENT_ID");
      Deno.env.delete("GITHUB_CLIENT_SECRET");
    }

    // 6. Test OAuth signin with Google configured environment variables
    Deno.env.set("GOOGLE_CLIENT_ID", "google_test_client_id");
    Deno.env.set("GOOGLE_CLIENT_SECRET", "google_test_client_secret");
    try {
      const gSigninReq = new Request("http://localhost:8000/oauth/signin", { method: "GET" });
      const gSigninRes = await handleHttpRequest(gSigninReq);
      assertEquals(gSigninRes.status, 302);
      const location = gSigninRes.headers.get("location");
      assert(location?.includes("accounts.google.com/o/oauth2/v2/auth"));
      assert(location?.includes("client_id=google_test_client_id"));
    } finally {
      Deno.env.delete("GOOGLE_CLIENT_ID");
      Deno.env.delete("GOOGLE_CLIENT_SECRET");
    }
  } finally {
    kv.close();
  }
});

Deno.test("Auth Routes - Direct handleAuthRoutes Fallback for Unmatched Routes & Methods", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    // 1. Wrong HTTP method on passkey routes
    const wrongMethods = ["GET", "PUT", "DELETE", "PATCH"];
    for (const m of wrongMethods) {
      const wrongMethodReq = new Request("http://localhost:8000/auth/passkey/register-options", {
        method: m,
      });
      const wrongMethodRes = await handleAuthRoutes(wrongMethodReq, new URL(wrongMethodReq.url));
      assertEquals(wrongMethodRes, null);
    }

    // 2. Unmatched path
    const unmatchedReq = new Request("http://localhost:8000/auth/other-endpoint", {
      method: "POST",
    });
    const unmatchedRes = await handleAuthRoutes(unmatchedReq, new URL(unmatchedReq.url));
    assertEquals(unmatchedRes, null);

    // 3. Wrong method on oauth routes
    const wrongOAuthMethodReq = new Request("http://localhost:8000/oauth/signin", {
      method: "POST",
    });
    const wrongOAuthMethodRes = await handleAuthRoutes(
      wrongOAuthMethodReq,
      new URL(wrongOAuthMethodReq.url),
    );
    assertEquals(wrongOAuthMethodRes, null);
  } finally {
    kv.close();
  }
});
