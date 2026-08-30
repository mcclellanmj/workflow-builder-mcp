/**
 * Stateless, on-demand memory search engine using Orama BM25 and vector/hybrid indexing.
 */

import { create, insert, search } from "@orama/orama";
import type { Memory, MemoryScope } from "./types.ts";

export type SearchMode = "hybrid" | "keyword" | "vector";

export interface MemorySearchParams {
  query?: string;
  vector?: number[];
  mode?: SearchMode;
  scope?: MemoryScope;
  workflow?: string;
  workflowId?: string;
  node?: string;
  nodeId?: string;
  role?: string;
  roleId?: string;
  tags?: string[];
  limit?: number;
  threshold?: number;
}

export interface MemorySearchHit {
  id: string;
  score: number;
  memory: Memory;
  matchedFields: string[];
}

export interface MemorySearchResult {
  count: number;
  totalHits: number;
  elapsedMs: number;
  hits: MemorySearchHit[];
}

/**
 * Computes which fields in a memory matched the query terms or vector.
 */
export function computeMatchedFields(
  memory: Memory,
  query?: string,
  mode?: SearchMode,
  hasVector?: boolean,
): string[] {
  const matched: string[] = [];
  if (!query) {
    if (hasVector || mode === "vector") {
      return ["embedding"];
    }
    return [];
  }

  const terms = query
    .toLowerCase()
    .split(/[\s,.;:!?\-_]+/)
    .filter((t) => t.length > 0);

  const checkField = (val: string): boolean => {
    const lower = val.toLowerCase();
    return terms.some((t) => lower.includes(t));
  };

  if (checkField(memory.key)) matched.push("key");
  if (memory.tags && memory.tags.some((t) => checkField(t))) matched.push("tags");
  if (checkField(memory.summary)) matched.push("summary");
  if (checkField(memory.content)) matched.push("content");

  if ((mode === "hybrid" || mode === "vector") && hasVector) {
    matched.push("embedding");
  }

  return matched.length > 0 ? matched : ["content"];
}

/**
 * Searches user memories from Deno KV using an in-memory Orama database instance.
 */
export async function searchMemoriesFromKv(
  kv: Deno.Kv,
  userId: string,
  params: MemorySearchParams,
): Promise<MemorySearchResult> {
  const startTime = performance.now();

  // 1. Query candidate memories from Deno KV
  const candidateMemories: Memory[] = [];
  for await (const entry of kv.list<Memory>({ prefix: ["users", userId, "memories"] })) {
    if (entry.value && typeof entry.value === "object") {
      const m = entry.value;

      // Filter by scope
      if (params.scope && m.scope !== params.scope) continue;

      // Filter by workflow / workflowId
      const targetWorkflow = params.workflowId || params.workflow;
      if (targetWorkflow && m.workflowId !== targetWorkflow) continue;

      // Filter by node / nodeId
      const targetNode = params.nodeId || params.node;
      if (targetNode && m.nodeId !== targetNode) continue;

      // Filter by role / roleId
      const targetRole = params.roleId || params.role;
      if (targetRole && m.roleId !== targetRole) continue;

      // Filter by tags
      if (params.tags && params.tags.length > 0) {
        const memTags = m.tags || [];
        const hasAll = params.tags.every((t) => memTags.includes(t));
        if (!hasAll) continue;
      }

      candidateMemories.push(m);
    }
  }

  if (candidateMemories.length === 0) {
    const elapsedMs = Math.round(performance.now() - startTime);
    return {
      count: 0,
      totalHits: 0,
      elapsedMs,
      hits: [],
    };
  }

  // 2. Determine vector dimensionality if vector is provided or stored
  let vectorDim: number | null = null;
  if (params.vector && Array.isArray(params.vector) && params.vector.length > 0) {
    vectorDim = params.vector.length;
  } else {
    for (const m of candidateMemories) {
      if (Array.isArray(m.embedding) && m.embedding.length > 0) {
        vectorDim = m.embedding.length;
        break;
      }
    }
  }

  // 3. Create Orama database schema
  const schema: Record<string, string> = {
    id: "string",
    key: "string",
    summary: "string",
    content: "string",
    tags: "string[]",
    scope: "string",
    workflowId: "string",
    roleId: "string",
    nodeId: "string",
  };

  if (vectorDim !== null) {
    schema.embedding = `vector[${vectorDim}]`;
  }

  // deno-lint-ignore no-explicit-any
  const db = await create({ schema: schema as any });

  // 4. Insert candidate memories into Orama
  for (const m of candidateMemories) {
    const doc: Record<string, unknown> = {
      id: m.id,
      key: m.key,
      summary: m.summary,
      content: m.content,
      tags: m.tags || [],
      scope: m.scope || "",
      workflowId: m.workflowId || "",
      roleId: m.roleId || "",
      nodeId: m.nodeId || "",
    };

    if (vectorDim !== null) {
      doc.embedding = (Array.isArray(m.embedding) && m.embedding.length === vectorDim)
        ? m.embedding
        : undefined;
    }

    // deno-lint-ignore no-explicit-any
    await insert(db, doc as any);
  }

  // 5. Determine search mode
  let searchMode: SearchMode = params.mode ?? "keyword";
  if (!params.mode) {
    if (params.vector && params.query) {
      searchMode = "hybrid";
    } else if (params.vector) {
      searchMode = "vector";
    } else {
      searchMode = "keyword";
    }
  }

  // 6. Build search options
  const limit = params.limit ?? 10;
  // deno-lint-ignore no-explicit-any
  const searchOptions: any = {
    limit: Math.max(limit * 3, 20),
  };

  if (searchMode === "vector" && params.vector) {
    searchOptions.mode = "vector";
    searchOptions.vector = {
      value: params.vector,
      property: "embedding",
    };
  } else if (searchMode === "hybrid" && params.vector) {
    searchOptions.mode = "hybrid";
    if (params.query) searchOptions.term = params.query;
    searchOptions.vector = {
      value: params.vector,
      property: "embedding",
    };
    searchOptions.boost = {
      key: 3,
      tags: 2,
      summary: 2,
      content: 1,
    };
  } else {
    // keyword mode
    if (params.query) {
      searchOptions.term = params.query;
      searchOptions.boost = {
        key: 3,
        tags: 2,
        summary: 2,
        content: 1,
      };
    }
  }

  const results = await search(db, searchOptions);
  const elapsedMs = Math.round(performance.now() - startTime);

  const memoryMap = new Map<string, Memory>();
  for (const m of candidateMemories) {
    memoryMap.set(m.id, m);
  }

  const threshold = params.threshold ?? 0.0;
  const hits: MemorySearchHit[] = [];

  for (const hit of results.hits) {
    if (hit.score < threshold) continue;
    const mem = memoryMap.get(hit.id);
    if (!mem) continue;

    const matchedFields = computeMatchedFields(
      mem,
      params.query,
      searchMode,
      Boolean(params.vector),
    );

    hits.push({
      id: hit.id,
      score: hit.score,
      memory: mem,
      matchedFields,
    });

    if (hits.length >= limit) {
      break;
    }
  }

  return {
    count: hits.length,
    totalHits: results.count,
    elapsedMs,
    hits,
  };
}
