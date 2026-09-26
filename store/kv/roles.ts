/**
 * Deno KV persistence for workflow-scoped user-defined roles and journals.
 */

import type { Role, RoleJournal, WorkflowId } from "../types.ts";
import { TtlCache } from "../cache.ts";
import { getKv, type ListOptions, resolveUserId } from "./client.ts";

/** In-memory cache for role lookups to eliminate redundant KV queries. */
const roleCache = new TtlCache<string, Role>({ defaultTtlMs: 300_000, maxCapacity: 1000 });

/**
 * Clears the in-memory role cache (useful for testing or cache resets).
 */
export function clearRoleCache(): void {
  roleCache.clear();
}

export interface CreateRoleInput {
  workflowId?: WorkflowId;
  name: string;
  description?: string;
  id?: string;
}

export interface ListRolesOptions extends ListOptions {
  workflowId?: WorkflowId;
  userId?: string;
}

/**
 * Creates or updates a role scoped to a workflow.
 * KV primary key: ["users", uid, "workflows", workflowId, "roles", role.id]
 */
export async function createRole(
  input: CreateRoleInput,
  userId?: string,
): Promise<Role> {
  if (input.workflowId !== undefined && !input.workflowId.trim()) {
    throw new Error("Workflow ID is required");
  }
  const workflowId = input.workflowId?.trim() || "default";

  const name = input.name?.trim();
  if (!name) {
    throw new Error("Role name cannot be empty");
  }

  if (
    input.description !== undefined && input.description !== null && input.description.length > 500
  ) {
    throw new Error("Job description must be 500 characters or less");
  }

  const uid = resolveUserId(userId);
  const kv = await getKv();
  const now = new Date().toISOString();

  const existing = (input.id ? await getRole(input.id, { workflowId, userId: uid }) : null) || await getRole(name, { workflowId, userId: uid });
  const id = input.id || existing?.id || crypto.randomUUID();

  const roleRecord: Role = {
    id,
    workflowId,
    userId: uid,
    name,
    description: input.description !== undefined ? input.description : existing?.description,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  await kv.atomic()
    .set(["users", uid, "workflows", workflowId, "roles", id], roleRecord)
    .set(["users", uid, "roles", id], roleRecord)
    .set(["users", uid, "roles_by_name", name.toLowerCase()], id)
    .set(["users", uid, "workflows", workflowId, "roles_by_name", name.toLowerCase()], id)
    .set(["workflows", workflowId, "roles", id], roleRecord)
    .set(["roles", id], roleRecord)
    .set(["roles_by_name", name.toLowerCase()], id)
    .set(["workflows", workflowId, "roles_by_name", name.toLowerCase()], id)
    .commit();

  roleCache.set(`${uid}:id:${id}`, roleRecord);
  roleCache.set(`${uid}:name:${name.toLowerCase()}`, roleRecord);
  roleCache.set(`${uid}:wf:${workflowId}:${name.toLowerCase()}`, roleRecord);

  return roleRecord;
}

/**
 * Retrieves a role by its ID (or workflowId + roleId/name).
 */
export async function getRole(
  roleId: string,
  options?: { workflowId?: WorkflowId; userId?: string },
): Promise<Role | null> {
  const trimmed = roleId?.trim();
  if (!trimmed) {
    return null;
  }
  const uid = resolveUserId(options?.userId);

  const cached = roleCache.get(`${uid}:id:${trimmed}`) ||
    (options?.workflowId ? roleCache.get(`${uid}:wf:${options.workflowId}:${trimmed.toLowerCase()}`) : undefined) ||
    roleCache.get(`${uid}:name:${trimmed.toLowerCase()}`);
  if (cached) {
    return cached;
  }

  const kv = await getKv();

  // 1. Direct workflow role lookup if workflowId is supplied
  if (options?.workflowId) {
    const userEntry = await kv.get<Role>(["users", uid, "workflows", options.workflowId, "roles", trimmed]);
    if (userEntry.value) {
      roleCache.set(`${uid}:id:${userEntry.value.id}`, userEntry.value);
      roleCache.set(`${uid}:name:${userEntry.value.name.toLowerCase()}`, userEntry.value);
      roleCache.set(`${uid}:wf:${options.workflowId}:${userEntry.value.name.toLowerCase()}`, userEntry.value);
      return userEntry.value;
    }

    const userNameEntry = await kv.get<string>(["users", uid, "workflows", options.workflowId, "roles_by_name", trimmed.toLowerCase()]);
    if (userNameEntry.value) {
      const byName = await kv.get<Role>(["users", uid, "workflows", options.workflowId, "roles", userNameEntry.value]);
      if (byName.value) {
        roleCache.set(`${uid}:id:${byName.value.id}`, byName.value);
        roleCache.set(`${uid}:name:${byName.value.name.toLowerCase()}`, byName.value);
        roleCache.set(`${uid}:wf:${options.workflowId}:${byName.value.name.toLowerCase()}`, byName.value);
        return byName.value;
      }
    }

    const entry = await kv.get<Role>(["workflows", options.workflowId, "roles", trimmed]);
    if (entry.value && (!entry.value.userId || entry.value.userId === uid)) {
      return entry.value;
    }
  }

  // 2. Global user lookup by role ID
  const userEntry = await kv.get<Role>(["users", uid, "roles", trimmed]);
  if (userEntry.value) {
    return userEntry.value;
  }

  const userNameEntry = await kv.get<string>(["users", uid, "roles_by_name", trimmed.toLowerCase()]);
  if (userNameEntry.value) {
    const byName = await kv.get<Role>(["users", uid, "roles", userNameEntry.value]);
    if (byName.value) {
      return byName.value;
    }
  }

  return null;
}

/**
 * Lists all roles for a workflow (or all roles for user if workflow not provided).
 */
export async function listRoles(options?: ListRolesOptions): Promise<Role[]> {
  const uid = resolveUserId(options?.userId);
  const kv = await getKv();
  const results: Role[] = [];
  const listOptions: Deno.KvListOptions = options?.limit ? { limit: options.limit } : {};
  const workflowId = options?.workflowId?.trim();

  if (workflowId) {
    for await (
      const entry of kv.list<Role>(
        { prefix: ["users", uid, "workflows", workflowId, "roles"] },
        listOptions,
      )
    ) {
      if (entry.value) {
        results.push(entry.value);
      }
    }

    if (results.length === 0) {
      for await (
        const entry of kv.list<Role>(
          { prefix: ["workflows", workflowId, "roles"] },
          listOptions,
        )
      ) {
        if (entry.value && (!entry.value.userId || entry.value.userId === uid)) {
          results.push(entry.value);
        }
      }
    }
  } else {
    for await (
      const entry of kv.list<Role>(
        { prefix: ["users", uid, "roles"] },
        listOptions,
      )
    ) {
      if (entry.value) {
        results.push(entry.value);
      }
    }
  }

  return results;
}

/**
 * Deletes a role by ID within a workflow.
 */
export async function deleteRole(
  workflowId: WorkflowId,
  roleId: string,
  userId?: string,
): Promise<void> {
  const uid = resolveUserId(userId);
  const kv = await getKv();
  const existing = await getRole(roleId, { workflowId, userId: uid });
  const atomic = kv.atomic()
    .delete(["users", uid, "workflows", workflowId, "roles", roleId])
    .delete(["users", uid, "roles", roleId])
    .delete(["workflows", workflowId, "roles", roleId])
    .delete(["roles", roleId]);

  if (existing) {
    atomic.delete(["users", uid, "workflows", workflowId, "roles_by_name", existing.name.toLowerCase()]);
    atomic.delete(["users", uid, "roles_by_name", existing.name.toLowerCase()]);
    atomic.delete(["workflows", workflowId, "roles_by_name", existing.name.toLowerCase()]);
    roleCache.delete(`${uid}:id:${roleId}`);
    roleCache.delete(`${uid}:name:${existing.name.toLowerCase()}`);
    roleCache.delete(`${uid}:wf:${workflowId}:${existing.name.toLowerCase()}`);
  }

  await atomic.commit();
}

/**
 * Ensures a role exists within a workflow. If not found, creates it.
 */
export async function ensureRole(
  workflowId: WorkflowId,
  name: string,
  userId?: string,
): Promise<Role> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("Role name cannot be empty");
  }
  const existing = await getRole(trimmed, { workflowId, userId });
  if (existing) {
    return existing;
  }
  return await createRole({ workflowId, name: trimmed }, userId);
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
  await ensureRole("default", trimmedRole, uid);

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
