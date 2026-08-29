/**
 * Deno KV persistence for user-defined roles and single-entry role journals.
 */

import type { Role, RoleJournal } from "../types.ts";
import { TtlCache } from "../cache.ts";
import { getKv, listEntries, type ListOptions, resolveUserId } from "./client.ts";

/** In-memory cache for role lookups to eliminate redundant KV queries during task and memory creation. */
const roleCache = new TtlCache<string, Role>({ defaultTtlMs: 300_000, maxCapacity: 1000 });

/**
 * Clears the in-memory role cache (useful for testing or cache resets).
 */
export function clearRoleCache(): void {
  roleCache.clear();
}

/**
 * Creates a new role. If a role with the same name exists, it will be updated.
 */
export async function createRole(
  role: { name: string; description?: string; id?: string },
  userId?: string,
): Promise<Role> {
  const name = role.name?.trim();
  if (!name) {
    throw new Error("Role name cannot be empty");
  }

  const uid = resolveUserId(userId);
  const kv = await getKv();

  const now = new Date().toISOString();
  const existing = await getRole(name, uid);

  const roleRecord: Role = {
    id: role.id || existing?.id || crypto.randomUUID(),
    userId: uid,
    name,
    description: role.description !== undefined ? role.description : existing?.description,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  await kv.set(["users", uid, "roles", name], roleRecord);
  roleCache.set(`${uid}:${name}`, roleRecord);
  return roleRecord;
}

/**
 * Retrieves a role by its name with in-memory caching.
 */
export async function getRole(name: string, userId?: string): Promise<Role | null> {
  const trimmed = name?.trim();
  if (!trimmed) {
    return null;
  }
  const uid = resolveUserId(userId);
  const cacheKey = `${uid}:${trimmed}`;
  const cached = roleCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const kv = await getKv();
  const entry = await kv.get<Role>(["users", uid, "roles", trimmed]);
  if (entry.value) {
    roleCache.set(cacheKey, entry.value);
  }
  return entry.value;
}

/**
 * Lists all roles for the user.
 */
export function listRoles(options?: ListOptions): Promise<Role[]> {
  const uid = resolveUserId(options?.userId);
  return listEntries<Role>(["users", uid, "roles"], options);
}

/**
 * Ensures a role exists. If not found, creates it with default description.
 */
export async function ensureRole(name: string, userId?: string): Promise<Role> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("Role name cannot be empty");
  }
  const uid = resolveUserId(userId);
  const existing = await getRole(trimmed, uid);
  if (existing) {
    return existing;
  }
  return await createRole({ name: trimmed }, uid);
}

/**
 * Writes a journal entry for a role, overwriting any previous entry.
 */
export async function writeJournal(
  roleName: string,
  entry: string,
  writtenBy?: string,
  userId?: string,
): Promise<RoleJournal> {
  const trimmedRole = roleName.trim();
  if (!trimmedRole) {
    throw new Error("Role name cannot be empty");
  }

  const uid = resolveUserId(userId);
  // Auto-ensure the role exists
  await ensureRole(trimmedRole, uid);

  const journal: RoleJournal = {
    roleId: trimmedRole,
    userId: uid,
    entry,
    writtenBy,
    writtenAt: new Date().toISOString(),
  };

  const kv = await getKv();
  await kv.set(["users", uid, "role_journals", trimmedRole], journal);
  return journal;
}

/**
 * Reads the latest journal entry for a role. Returns null if none exists.
 */
export async function readJournal(
  roleName: string,
  userId?: string,
): Promise<RoleJournal | null> {
  const uid = resolveUserId(userId);
  const kv = await getKv();
  const entry = await kv.get<RoleJournal>(["users", uid, "role_journals", roleName.trim()]);
  return entry.value;
}
