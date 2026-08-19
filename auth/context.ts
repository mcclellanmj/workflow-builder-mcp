/**
 * User context management for multi-tenant request isolation.
 * Uses AsyncLocalStorage to propagate authenticated user ID across async tool invocations.
 */

import { AsyncLocalStorage } from "node:async_hooks";

export const DEFAULT_LOCAL_USER_ID = "default";

const userAsyncLocalStorage = new AsyncLocalStorage<string>();

/**
 * Returns the currently active user ID in the async execution context.
 * Falls back to DEFAULT_LOCAL_USER_ID if no context is active (e.g. stdio CLI mode).
 */
export function getCurrentUserId(): string {
  return userAsyncLocalStorage.getStore() || DEFAULT_LOCAL_USER_ID;
}

/**
 * Executes a function within the scope of a specific user ID.
 */
export function withUserContext<T>(userId: string, fn: () => T | Promise<T>): Promise<T> {
  const normalizedUserId = userId.trim() || DEFAULT_LOCAL_USER_ID;
  return userAsyncLocalStorage.run(normalizedUserId, async () => {
    return await fn();
  });
}
