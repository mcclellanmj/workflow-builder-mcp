/**
 * Shared HTTP response, header, and error utility primitives.
 */

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-User-Id, Accept",
  "Access-Control-Max-Age": "86400",
};

export function jsonResponse(
  data: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...CORS_HEADERS,
      ...extraHeaders,
    },
  });
}

export function errorResponse(
  message: string,
  status = 400,
  extraHeaders: Record<string, string> = {},
): Response {
  return jsonResponse({ error: message }, status, extraHeaders);
}

/**
 * Escapes unsafe characters for HTML rendering to prevent XSS.
 */
export function escapeHtml(str: string | null | undefined): string {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Validates a redirect URI to ensure it begins with an allowed scheme (http:, https:, or custom app scheme).
 */
export function isValidRedirectUri(uri: string): boolean {
  if (!uri || typeof uri !== "string") return false;
  try {
    const parsed = new URL(uri);
    // Disallow javascript:, data:, vbscript:, file:
    const disallowed = ["javascript:", "data:", "vbscript:", "file:"];
    if (disallowed.includes(parsed.protocol.toLowerCase())) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Encodes a Uint8Array buffer into a URL-safe Base64 string without padding.
 */
export function uint8ArrayToBase64Url(buffer: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < buffer.byteLength; i++) {
    binary += String.fromCharCode(buffer[i]);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Decodes a URL-safe Base64 string into a Uint8Array buffer.
 */
export function base64UrlToUint8Array(base64url: string): Uint8Array {
  let base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) {
    base64 += "=";
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Generates standard RFC 9728 WWW-Authenticate challenge header for 401 Unauthorized responses.
 */
export function getWwwAuthenticateHeader(serverOrigin: string): Record<string, string> {
  const origin = serverOrigin.replace(/\/+$/, "");
  return {
    "WWW-Authenticate":
      `Bearer realm="workflow-mcp", resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
  };
}
