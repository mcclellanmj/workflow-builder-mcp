/**
 * Backward compatibility barrel export for Deno KV persistence.
 * Modular domain implementations reside under `./kv/`.
 */

export * from "./kv/index.ts";
export * from "./memory_search.ts";
export * from "./resolvers.ts";
