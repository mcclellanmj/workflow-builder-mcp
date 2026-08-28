/**
 * Deno KV client connection management, user context resolution,
 * and low-level key listing utilities.
 */

import { getCurrentUserId } from "../../auth/context.ts";

let _kv: Deno.Kv | null = null;

export const MAX_ATOMIC_OPS = 500;
export const MAX_GET_MANY_KEYS = 10;

/** Returns the shared Deno KV instance, opening it lazily on first call. */
export async function getKv(): Promise<Deno.Kv> {
  if (!_kv) {
    _kv = await Deno.openKv();
  }
  return _kv;
}

/** Replaces the KV instance (useful for tests). */
export function setKv(kv: Deno.Kv): void {
  _kv = kv;
}

/** Resolves the target userId, defaulting to the current async context or default local user. */
export function resolveUserId(explicitUserId?: string): string {
  return (explicitUserId && explicitUserId.trim().length > 0)
    ? explicitUserId.trim()
    : getCurrentUserId();
}

export interface ListOptions {
  limit?: number;
  userId?: string;
}

/** Generic helper to list entries matching a prefix. */
export async function listEntries<T>(prefix: Deno.KvKey, options?: ListOptions): Promise<T[]> {
  const kv = await getKv();
  const results: T[] = [];
  const listOptions: Deno.KvListOptions = options?.limit ? { limit: options.limit } : {};
  for await (const entry of kv.list<T>({ prefix }, listOptions)) {
    results.push(entry.value);
  }
  return results;
}
