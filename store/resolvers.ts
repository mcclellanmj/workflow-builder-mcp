/**
 * Name, slug, and hierarchical path resolution utilities for workflows and nodes.
 * Allows store and presentation layers to resolve entities by UUIDs, exact names,
 * kebab-case slugs, or parent/child paths.
 */

import { resolveUserId } from "./kv/client.ts";
import { getWorkflow, listWorkflows } from "./kv/workflows.ts";
import { listNodes } from "./kv/nodes.ts";
import { TtlCache } from "./cache.ts";
import type { Workflow, WorkflowNode } from "./types.ts";

export const workflowListCache = new TtlCache<string, Workflow[]>({
  defaultTtlMs: 300_000,
  maxCapacity: 5000,
});

/**
 * Invalidates cached workflow lists for a user or globally.
 */
export function invalidateWorkflowCache(userId?: string): void {
  if (userId) {
    workflowListCache.delete(resolveUserId(userId));
  } else {
    workflowListCache.clear();
  }
}

/**
 * Converts any text into a normalized kebab-case slug.
 * e.g., "Review Workflow / Security" -> "review-workflow-security"
 *       "Step 5-web" -> "step-5-web"
 */
export function toSlug(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/['"“”‘’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Resolves a workflow by UUID, exact name, slug, or hierarchical path (e.g., "parent-workflow/child-subworkflow").
 */
export async function resolveWorkflow(
  identifier: string,
  userId?: string,
): Promise<Workflow | null> {
  const trimmed = identifier.trim();
  if (!trimmed) return null;

  const uid = resolveUserId(userId);

  // 1. Direct KV lookup by exact ID
  const direct = await getWorkflow(trimmed, userId);
  if (direct) return direct;

  let allWorkflows = workflowListCache.get(uid);
  if (!allWorkflows) {
    allWorkflows = await listWorkflows({ userId });
    workflowListCache.set(uid, allWorkflows);
  }
  if (allWorkflows.length === 0) return null;

  // 2. Direct ID match in cached list
  const idMatch = allWorkflows.find((w) => w.id === trimmed);
  if (idMatch) return idMatch;

  // 3. Hierarchical path resolution (e.g. "review-workflow/security" or "Parent Workflow/Child")
  if (trimmed.includes("/")) {
    const segments = trimmed.split("/").map((s) => s.trim()).filter(Boolean);
    if (segments.length > 1) {
      let currentWorkflow: Workflow | null = null;
      // Resolve root segment
      const rootSegment = segments[0];
      const rootSlug = toSlug(rootSegment);
      currentWorkflow = allWorkflows.find(
        (w) =>
          w.id === rootSegment ||
          w.name.toLowerCase() === rootSegment.toLowerCase() ||
          toSlug(w.name) === rootSlug,
      ) ?? null;

      if (currentWorkflow) {
        // Step through remaining path segments
        for (let i = 1; i < segments.length; i++) {
          const seg = segments[i];
          const segSlug = toSlug(seg);
          const currentNodes = await listNodes(currentWorkflow.id, { userId });
          const subworkflowNodes = currentNodes.filter((n) => n.type === "subworkflow");

          let nextChildId: string | null = null;
          // Check if subworkflow node name or slug matches
          const matchingNode = subworkflowNodes.find(
            (n) =>
              n.name.toLowerCase() === seg.toLowerCase() ||
              toSlug(n.name) === segSlug,
          );

          if (matchingNode && typeof matchingNode.config?.childWorkflowId === "string") {
            nextChildId = matchingNode.config.childWorkflowId;
          } else {
            // Check if any referenced child workflow matches this segment
            for (const sn of subworkflowNodes) {
              const childId = sn.config?.childWorkflowId as string | undefined;
              if (childId) {
                const childWf = allWorkflows.find((w) => w.id === childId);
                if (
                  childWf &&
                  (childWf.name.toLowerCase() === seg.toLowerCase() ||
                    toSlug(childWf.name) === segSlug ||
                    childWf.id === seg)
                ) {
                  nextChildId = childId;
                  break;
                }
              }
            }
          }

          if (!nextChildId) {
            currentWorkflow = null;
            break;
          }

          const resolvedChild = allWorkflows.find((w) => w.id === nextChildId) ??
            (await getWorkflow(nextChildId, userId));
          if (!resolvedChild) {
            currentWorkflow = null;
            break;
          }
          currentWorkflow = resolvedChild;
        }

        if (currentWorkflow) {
          return currentWorkflow;
        }
      }
    }
  }

  // 4. Exact Name Match (case-sensitive first, then case-insensitive)
  const exactCase = allWorkflows.find((w) => w.name === trimmed);
  if (exactCase) return exactCase;

  const exactInsensitive = allWorkflows.find(
    (w) => w.name.toLowerCase() === trimmed.toLowerCase(),
  );
  if (exactInsensitive) return exactInsensitive;

  // 5. Slug Match (e.g. "review-workflow" matching "Review Workflow")
  const targetSlug = toSlug(trimmed);
  const slugMatch = allWorkflows.find((w) => toSlug(w.name) === targetSlug);
  if (slugMatch) return slugMatch;

  return null;
}

/**
 * Resolves a node inside a specific workflow by UUID, exact name, or slug.
 */
export function resolveNode(
  nodeIdentifier: string,
  nodes: WorkflowNode[],
): WorkflowNode | null {
  const trimmed = nodeIdentifier.trim();
  if (!trimmed) return null;

  // 1. Direct ID match
  const idMatch = nodes.find((n) => n.id === trimmed);
  if (idMatch) return idMatch;

  // 2. Exact Name Match (case-sensitive)
  const exactCase = nodes.find((n) => n.name === trimmed);
  if (exactCase) return exactCase;

  // 3. Exact Name Match (case-insensitive)
  const exactInsensitive = nodes.find((n) => n.name.toLowerCase() === trimmed.toLowerCase());
  if (exactInsensitive) return exactInsensitive;

  // 4. Slug Match (e.g. "step-5-web" matching "Step 5-web")
  const targetSlug = toSlug(trimmed);
  const slugMatch = nodes.find((n) => toSlug(n.name) === targetSlug);
  if (slugMatch) return slugMatch;

  return null;
}

/**
 * Resolves a node inside a workflow, loading nodes from store if not provided.
 */
export async function resolveNodeInWorkflow(
  workflowId: string,
  nodeIdentifier: string,
  userId?: string,
  cachedNodes?: WorkflowNode[],
): Promise<WorkflowNode | null> {
  const nodes = cachedNodes ?? (await listNodes(workflowId, { userId }));
  return resolveNode(nodeIdentifier, nodes);
}
