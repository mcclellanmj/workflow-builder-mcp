/**
 * In-memory TTL (Time-To-Live) cache with LRU eviction support.
 */

export interface TtlCacheOptions {
  /** Default TTL in milliseconds for entries (defaults to 300,000 ms / 5 minutes). */
  defaultTtlMs?: number;
  /** Maximum number of entries before the oldest entries are evicted. */
  maxCapacity?: number;
}

export interface CacheEntry<V> {
  value: V;
  expiresAt: number;
}

export class TtlCache<K, V> {
  private readonly defaultTtlMs: number;
  private readonly maxCapacity?: number;
  private readonly map = new Map<K, CacheEntry<V>>();

  constructor(options: TtlCacheOptions = {}) {
    this.defaultTtlMs = options.defaultTtlMs ?? 300_000;
    this.maxCapacity = options.maxCapacity;
  }

  /**
   * Retrieves an item from the cache.
   * If the item is expired, it is removed and undefined is returned.
   * If found and valid, entry is refreshed in access order (LRU).
   */
  get(key: K): V | undefined {
    const entry = this.map.get(key);
    if (!entry) {
      return undefined;
    }

    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return undefined;
    }

    // Refresh access order for LRU behavior
    this.map.delete(key);
    this.map.set(key, entry);

    return entry.value;
  }

  /**
   * Stores an item in the cache with an optional custom TTL in milliseconds.
   */
  set(key: K, value: V, ttlMs?: number): void {
    const effectiveTtl = ttlMs ?? this.defaultTtlMs;
    const expiresAt = Date.now() + effectiveTtl;

    // Delete first to maintain insertion/access order
    this.map.delete(key);

    // If max capacity is configured and reached, prune expired first
    if (
      this.maxCapacity !== undefined && this.maxCapacity > 0 && this.map.size >= this.maxCapacity
    ) {
      this.pruneExpired();

      // If still at or over capacity, evict the oldest entry (first item in Map)
      while (this.map.size >= this.maxCapacity) {
        const oldestKey = this.map.keys().next().value;
        if (oldestKey === undefined) {
          break;
        }
        this.map.delete(oldestKey);
      }
    }

    this.map.set(key, { value, expiresAt });
  }

  /**
   * Checks if a non-expired entry exists for the given key.
   */
  has(key: K): boolean {
    return this.get(key) !== undefined;
  }

  /**
   * Deletes a key from the cache.
   * Returns true if the key was present and removed, false otherwise.
   */
  delete(key: K): boolean {
    return this.map.delete(key);
  }

  /**
   * Clears all entries from the cache.
   */
  clear(): void {
    this.map.clear();
  }

  /**
   * Returns the count of valid (unexpired) entries currently stored.
   * Also cleans up any expired entries encountered.
   */
  size(): number {
    this.pruneExpired();
    return this.map.size;
  }

  /**
   * Prunes all expired entries from the cache.
   * Returns the number of pruned entries.
   */
  pruneExpired(): number {
    const now = Date.now();
    let prunedCount = 0;

    for (const [key, entry] of this.map.entries()) {
      if (now > entry.expiresAt) {
        this.map.delete(key);
        prunedCount++;
      }
    }

    return prunedCount;
  }
}
