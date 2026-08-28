import { assertEquals } from "@std/assert";
import { TtlCache } from "./cache.ts";

Deno.test("TtlCache - Basic set, get, and delete operations", () => {
  const cache = new TtlCache<string, { id: number; name: string }>();

  assertEquals(cache.size(), 0);
  assertEquals(cache.get("user:1"), undefined);
  assertEquals(cache.has("user:1"), false);

  cache.set("user:1", { id: 1, name: "Alice" });
  assertEquals(cache.size(), 1);
  assertEquals(cache.has("user:1"), true);
  assertEquals(cache.get("user:1"), { id: 1, name: "Alice" });

  const deleted = cache.delete("user:1");
  assertEquals(deleted, true);
  assertEquals(cache.size(), 0);
  assertEquals(cache.get("user:1"), undefined);

  const deletedAgain = cache.delete("user:1");
  assertEquals(deletedAgain, false);
});

Deno.test("TtlCache - Expiration with default TTL and custom TTL", async () => {
  const cache = new TtlCache<string, string>({ defaultTtlMs: 50 });

  cache.set("item1", "value1"); // uses default 50ms
  cache.set("item2", "value2", 150); // custom 150ms

  assertEquals(cache.get("item1"), "value1");
  assertEquals(cache.get("item2"), "value2");
  assertEquals(cache.size(), 2);

  // Wait 70ms - item1 should expire, item2 should still be alive
  await new Promise((resolve) => setTimeout(resolve, 70));

  assertEquals(cache.get("item1"), undefined);
  assertEquals(cache.has("item1"), false);
  assertEquals(cache.get("item2"), "value2");
  assertEquals(cache.size(), 1);

  // Wait another 100ms - item2 should also expire
  await new Promise((resolve) => setTimeout(resolve, 100));

  assertEquals(cache.get("item2"), undefined);
  assertEquals(cache.size(), 0);
});

Deno.test("TtlCache - Clear and Pruning", async () => {
  const cache = new TtlCache<string, number>();

  cache.set("k1", 100, 30);
  cache.set("k2", 200, 30);
  cache.set("k3", 300, 500);

  assertEquals(cache.size(), 3);

  // Wait for k1 & k2 to expire
  await new Promise((resolve) => setTimeout(resolve, 50));

  const pruned = cache.pruneExpired();
  assertEquals(pruned, 2);
  assertEquals(cache.size(), 1);
  assertEquals(cache.get("k3"), 300);

  cache.clear();
  assertEquals(cache.size(), 0);
  assertEquals(cache.get("k3"), undefined);
});

Deno.test("TtlCache - Max capacity and LRU eviction", () => {
  const cache = new TtlCache<string, number>({ maxCapacity: 3 });

  cache.set("a", 1);
  cache.set("b", 2);
  cache.set("c", 3);

  assertEquals(cache.size(), 3);

  // Accessing "a" makes "b" the least recently used
  assertEquals(cache.get("a"), 1);

  // Adding "d" should evict "b"
  cache.set("d", 4);

  assertEquals(cache.size(), 3);
  assertEquals(cache.get("b"), undefined); // evicted
  assertEquals(cache.get("a"), 1);
  assertEquals(cache.get("c"), 3);
  assertEquals(cache.get("d"), 4);

  // Updating existing key "c" should not evict anything
  cache.set("c", 30);
  assertEquals(cache.size(), 3);
  assertEquals(cache.get("c"), 30);
});
