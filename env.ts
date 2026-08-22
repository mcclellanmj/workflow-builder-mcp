/**
 * Safe environment variable helper.
 * Prevents Uncaught NotCapable errors when running in environments
 * without explicit `--allow-env` permission.
 */

/**
 * Safely retrieves an environment variable without throwing if `--allow-env` permission is missing.
 *
 * @param key The environment variable name.
 * @returns The environment variable value, or undefined if not set or not accessible.
 */
export function safeGetEnv(key: string): string | undefined {
  try {
    if (typeof Deno !== "undefined" && typeof Deno.env?.get === "function") {
      return Deno.env.get(key);
    }
  } catch {
    // PermissionDenied or NotCapable when --allow-env is not provided
  }
  return undefined;
}
