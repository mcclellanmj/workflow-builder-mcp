import { assertEquals } from "@std/assert";
import { safeGetEnv } from "./env.ts";

Deno.test("safeGetEnv - returns value for existing env var", () => {
  Deno.env.set("TEST_ENV_VAR", "test_value");
  try {
    assertEquals(safeGetEnv("TEST_ENV_VAR"), "test_value");
  } finally {
    Deno.env.delete("TEST_ENV_VAR");
  }
});

Deno.test("safeGetEnv - returns undefined for non-existent env var", () => {
  assertEquals(safeGetEnv("NON_EXISTENT_VAR_XYZ_123"), undefined);
});
