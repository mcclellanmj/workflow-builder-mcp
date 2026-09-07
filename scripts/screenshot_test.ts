import { assertEquals, assertGreater } from "jsr:@std/assert@^1.0.0";
import { join } from "jsr:@std/path@^1.0.0";
import {
  captureScreenshot,
  DEFAULT_KEY_VIEWS,
  fileExists,
  findBrowserExecutable,
} from "./screenshot.ts";

Deno.test("screenshot - findBrowserExecutable detects installed browser", async () => {
  const browserPath = await findBrowserExecutable();
  assertGreater(browserPath.length, 0);
  const exists = await fileExists(browserPath);
  assertEquals(exists, true);
});

Deno.test("screenshot - DEFAULT_KEY_VIEWS contains standard web views", () => {
  const paths = DEFAULT_KEY_VIEWS.map((v) => v.path);
  assertEquals(paths.includes("/"), true);
  assertEquals(paths.includes("/tasks"), true);
  assertEquals(paths.includes("/memories"), true);
  assertEquals(paths.includes("/journals"), true);
});

Deno.test("screenshot - captures data URI to PNG file", async () => {
  const hasRunPerm = (await Deno.permissions.query({ name: "run" })).state === "granted";
  if (!hasRunPerm) {
    console.log(
      "Skipping live browser capture test (run permission not granted in current test runner)",
    );
    return;
  }

  const tempDir = await Deno.makeTempDir();
  const outputPath = join(tempDir, "smoke_test.png");

  try {
    const captured = await captureScreenshot({
      url: "data:text/html,<html><body><h1>Smoke Test</h1></body></html>",
      output: outputPath,
      delay: 500,
      silent: true,
    });

    assertEquals(captured, outputPath);
    const exists = await fileExists(outputPath);
    assertEquals(exists, true);

    const fileBytes = await Deno.readFile(outputPath);
    assertGreater(fileBytes.length, 100);

    // Verify PNG signature (89 50 4E 47 0D 0A 1A 0A)
    assertEquals(fileBytes[0], 0x89);
    assertEquals(fileBytes[1], 0x50); // P
    assertEquals(fileBytes[2], 0x4e); // N
    assertEquals(fileBytes[3], 0x47); // G
  } finally {
    try {
      await Deno.remove(tempDir, { recursive: true });
    } catch {
      // Ignore cleanup error
    }
  }
});
