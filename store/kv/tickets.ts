/**
 * Deno KV persistence for visualization share tickets (time-limited access).
 */

import type { ExecutionId, ViewTicket, WorkflowId } from "../types.ts";
import { getKv, resolveUserId } from "./client.ts";

/**
 * Creates a secure, time-limited ticket for sharing/viewing a workflow visualization.
 * Defaults to 1 week (7 days) expiration, configurable up to 1 year (365 days).
 */
export async function createViewTicket(
  workflowId: WorkflowId,
  executionId?: ExecutionId,
  expiresInMinutes = 7 * 24 * 60,
  userId?: string,
): Promise<ViewTicket> {
  const uid = resolveUserId(userId);
  const kv = await getKv();
  const ticketId = crypto.randomUUID().replace(/-/g, "");
  const now = new Date().toISOString();
  const expiresAt = Date.now() + expiresInMinutes * 60 * 1000;

  const ticket: ViewTicket = {
    ticketId,
    userId: uid,
    workflowId,
    executionId,
    createdAt: now,
    expiresAt,
  };

  const atomic = kv.atomic()
    .set(["view_tickets", ticketId], ticket)
    .set(["users", uid, "view_tickets", ticketId], ticketId);

  await atomic.commit();
  return ticket;
}

/**
 * Retrieves a view ticket by ID. Returns null if ticket does not exist or has expired.
 */
export async function getViewTicket(ticketId: string): Promise<ViewTicket | null> {
  const kv = await getKv();
  const entry = await kv.get<ViewTicket>(["view_tickets", ticketId]);
  if (!entry.value) return null;

  if (Date.now() > entry.value.expiresAt) {
    // Expired - clean up asynchronously
    deleteViewTicket(ticketId).catch(() => {});
    return null;
  }

  return entry.value;
}

/**
 * Deletes a view ticket from KV store.
 */
export async function deleteViewTicket(ticketId: string): Promise<void> {
  const kv = await getKv();
  const entry = await kv.get<ViewTicket>(["view_tickets", ticketId]);
  if (!entry.value) return;

  const atomic = kv.atomic()
    .delete(["view_tickets", ticketId])
    .delete(["users", entry.value.userId, "view_tickets", ticketId]);

  await atomic.commit();
}
