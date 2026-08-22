/**
 * User & Request context management for multi-tenant isolation and remote URL resolution.
 * Uses AsyncLocalStorage to propagate authenticated user ID and server origin across async tool invocations.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { safeGetEnv } from "../env.ts";

export const DEFAULT_LOCAL_USER_ID = "default";

export interface RequestContext {
  userId: string;
  serverOrigin?: string;
  token?: string;
}

const contextAsyncLocalStorage = new AsyncLocalStorage<RequestContext>();

/**
 * Returns the currently active user ID in the async execution context.
 * Falls back to DEFAULT_LOCAL_USER_ID if no context is active (e.g. stdio CLI mode).
 */
export function getCurrentUserId(): string {
  return contextAsyncLocalStorage.getStore()?.userId || DEFAULT_LOCAL_USER_ID;
}

/**
 * Returns the active server origin (e.g. "https://my-mcp.deno.dev" or "http://localhost:8000")
 * if running within an HTTP request, or falls back to SERVER_ORIGIN / PUBLIC_URL env vars.
 */
export function getCurrentServerOrigin(): string | undefined {
  const context = contextAsyncLocalStorage.getStore();
  if (context?.serverOrigin) {
    return context.serverOrigin.replace(/\/+$/, "");
  }

  const envOrigin = safeGetEnv("SERVER_ORIGIN") ||
    safeGetEnv("PUBLIC_URL") ||
    safeGetEnv("MCP_SERVER_URL") ||
    safeGetEnv("MCP_PUBLIC_URL");

  return envOrigin ? envOrigin.replace(/\/+$/, "") : undefined;
}

/**
 * Returns the current request context if available.
 */
export function getCurrentRequestContext(): RequestContext | undefined {
  return contextAsyncLocalStorage.getStore();
}

/**
 * Executes a function within the scope of a specific user ID.
 */
export function withUserContext<T>(userId: string, fn: () => T | Promise<T>): Promise<T> {
  const normalizedUserId = userId.trim() || DEFAULT_LOCAL_USER_ID;
  const existing = contextAsyncLocalStorage.getStore();
  const context: RequestContext = {
    userId: normalizedUserId,
    serverOrigin: existing?.serverOrigin,
    token: existing?.token,
  };
  return contextAsyncLocalStorage.run(context, async () => {
    return await fn();
  });
}

/**
 * Executes a function within the full request context (userId, serverOrigin, token).
 */
export function withRequestContext<T>(
  context: RequestContext,
  fn: () => T | Promise<T>,
): Promise<T> {
  const normalizedContext: RequestContext = {
    userId: context.userId.trim() || DEFAULT_LOCAL_USER_ID,
    serverOrigin: context.serverOrigin?.trim(),
    token: context.token?.trim(),
  };
  return contextAsyncLocalStorage.run(normalizedContext, async () => {
    return await fn();
  });
}
