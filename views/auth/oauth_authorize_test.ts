import { assertEquals, assertStringIncludes } from "@std/assert";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { KNOWN_OAUTH_SCOPES, OAuthAuthorize, parseScopeDetails } from "./OAuthAuthorize.tsx";
import { renderHtmlResponse } from "../ssr.ts";

Deno.test("parseScopeDetails - parses standard and custom scopes", () => {
  const defaultScopes = parseScopeDetails();
  assertEquals(defaultScopes.length, 1);
  assertEquals(defaultScopes[0], KNOWN_OAUTH_SCOPES.workflow);

  const multipleScopes = parseScopeDetails("workflow read write admin custom:scope");
  assertEquals(multipleScopes.length, 5);
  assertEquals(multipleScopes[0].scope, "workflow");
  assertEquals(multipleScopes[1].scope, "read");
  assertEquals(multipleScopes[2].scope, "write");
  assertEquals(multipleScopes[3].scope, "admin");
  assertEquals(multipleScopes[4].scope, "custom:scope");
  assertEquals(multipleScopes[4].label, "custom:scope");
  assertEquals(multipleScopes[4].variant, "neutral");
});

Deno.test("OAuthAuthorize - renders consent screen with client name and hidden form inputs", () => {
  const html = renderToString(
    h(OAuthAuthorize, {
      clientId: "test-client-123",
      clientName: "Claude Desktop",
      redirectUri: "http://localhost:8080/callback",
      scope: "workflow read",
      state: "xyz-state-token",
      codeChallenge: "challenge-hash-456",
      codeChallengeMethod: "S256",
      auth: {
        userId: "user_alice",
        user: {
          userId: "user_alice",
          name: "Alice Smith",
          provider: "passkey",
          createdAt: new Date().toISOString(),
        },
        authMethod: "session",
      },
    }),
  );

  // Client display
  assertStringIncludes(html, "Claude Desktop");
  assertStringIncludes(html, "Authorize Application");

  // Scopes and descriptions
  assertStringIncludes(html, "Workflows");
  assertStringIncludes(html, "Read, design, validate, and execute automated workflows");
  assertStringIncludes(html, "Read");
  assertStringIncludes(html, "Read-only access to workflows");

  // User identity
  assertStringIncludes(html, "Alice Smith");
  assertStringIncludes(html, "Authenticated");

  // Form & hidden inputs
  assertStringIncludes(html, '<form id="consentForm" method="POST" action="/oauth/authorize"');
  assertStringIncludes(html, '<input type="hidden" name="approve" value="true"');
  assertStringIncludes(html, '<input type="hidden" name="client_id" value="test-client-123"');
  assertStringIncludes(
    html,
    '<input type="hidden" name="redirect_uri" value="http://localhost:8080/callback"',
  );
  assertStringIncludes(html, '<input type="hidden" name="response_type" value="code"');
  assertStringIncludes(html, '<input type="hidden" name="scope" value="workflow read"');
  assertStringIncludes(html, '<input type="hidden" name="state" value="xyz-state-token"');
  assertStringIncludes(
    html,
    '<input type="hidden" name="code_challenge" value="challenge-hash-456"',
  );
  assertStringIncludes(html, '<input type="hidden" name="code_challenge_method" value="S256"');

  // Authorize and Cancel buttons
  assertStringIncludes(html, "Authorize Claude Desktop");
  assertStringIncludes(html, "Cancel");
  assertStringIncludes(html, "error=access_denied");
});

Deno.test("OAuthAuthorize - renders WebAuthn prompt when unauthenticated or required", () => {
  const html = renderToString(
    h(OAuthAuthorize, {
      clientId: "cli-agent",
      redirectUri: "http://127.0.0.1:3000/oauth",
      requireWebAuthnPrompt: true,
      auth: null,
      oauthConfigured: true,
    }),
  );

  // WebAuthn prompt elements
  assertStringIncludes(html, "WebAuthn Confirmation Required");
  assertStringIncludes(html, "Verify Passkey &amp; Authorize");
  assertStringIncludes(html, "loginUsername");
  assertStringIncludes(html, "Sign in with GitHub / Google");
});

Deno.test("OAuthAuthorize - renders error banner when error prop is provided", () => {
  const html = renderToString(
    h(OAuthAuthorize, {
      clientId: "cli-agent",
      redirectUri: "http://127.0.0.1:3000/oauth",
      errorMessage: "Invalid or expired authorization request.",
    }),
  );

  assertStringIncludes(html, "Authorization Notice");
  assertStringIncludes(html, "Invalid or expired authorization request.");
});

Deno.test("OAuthAuthorize - renders cleanly via renderHtmlResponse with Twind extraction", async () => {
  const res = renderHtmlResponse(
    h(OAuthAuthorize, {
      clientId: "gemini-code-assistant",
      clientName: "Gemini CLI",
      redirectUri: "http://localhost:9999/callback",
      scope: "workflow write",
      state: "state-123",
    }),
    { title: "Authorize Gemini CLI" },
  );

  assertEquals(res.status, 200);
  assertEquals(res.headers.get("content-type"), "text/html; charset=utf-8");

  const body = await res.text();
  assertStringIncludes(body, "<!DOCTYPE html>");
  assertStringIncludes(body, "<title>Authorize Gemini CLI</title>");
  assertStringIncludes(body, '<style id="__twind">');
  assertStringIncludes(body, "Gemini CLI");
});
