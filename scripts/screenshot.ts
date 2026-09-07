/**
 * Automated Headless Browser Screenshot Utility.
 *
 * Supports capturing single URLs or batch key views (/tasks, /memories, /journals, /)
 * using local Microsoft Edge or Google Chrome headless CLI.
 *
 * Usage:
 *   deno run --allow-all scripts/screenshot.ts
 *   deno run --allow-all scripts/screenshot.ts --url http://localhost:8000/tasks --output artifacts/screenshots/tasks.png
 *   deno run --allow-all scripts/screenshot.ts --all --base-url http://localhost:8000
 *   deno run --allow-all scripts/screenshot.ts --help
 */

import { parseArgs } from "jsr:@std/cli@^1.0.0/parse-args";
import { dirname, join, resolve } from "jsr:@std/path@^1.0.0";

export interface KeyView {
  path: string;
  name: string;
}

export const DEFAULT_KEY_VIEWS: KeyView[] = [
  { path: "/", name: "dashboard" },
  { path: "/tasks", name: "tasks" },
  { path: "/memories", name: "memories" },
  { path: "/journals", name: "journals" },
];

export interface CaptureOptions {
  url: string;
  output: string;
  viewport?: string;
  delay?: number;
  browserPath?: string;
  silent?: boolean;
}

export interface CaptureViewsOptions {
  baseUrl?: string;
  outputDir?: string;
  viewport?: string;
  delay?: number;
  browserPath?: string;
  views?: KeyView[];
  silent?: boolean;
}

/**
 * Checks if a file exists at the given path.
 */
export async function fileExists(path: string): Promise<boolean> {
  try {
    const info = await Deno.stat(path);
    return info.isFile;
  } catch {
    return false;
  }
}

/**
 * Discovers standard Microsoft Edge or Google Chrome executable paths across platforms.
 */
export async function findBrowserExecutable(explicitPath?: string): Promise<string> {
  if (explicitPath) {
    if (await fileExists(explicitPath)) {
      return explicitPath;
    }
    throw new Error(`Explicit browser path not found: ${explicitPath}`);
  }

  // Check environment variables
  const envCandidates = [
    Deno.env.get("BROWSER_PATH"),
    Deno.env.get("EDGE_PATH"),
    Deno.env.get("CHROME_PATH"),
  ].filter((p): p is string => Boolean(p));

  for (const p of envCandidates) {
    if (await fileExists(p)) {
      return p;
    }
  }

  const isWindows = Deno.build.os === "windows";
  const isDarwin = Deno.build.os === "darwin";

  const candidates: string[] = [];

  if (isWindows) {
    const localAppData = Deno.env.get("LOCALAPPDATA") ?? "";
    const programFiles = Deno.env.get("ProgramFiles") ?? "C:\\Program Files";
    const programFilesX86 = Deno.env.get("ProgramFiles(x86)") ?? "C:\\Program Files (x86)";

    candidates.push(
      `${programFilesX86}\\Microsoft\\Edge\\Application\\msedge.exe`,
      `${programFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
      `${programFiles}\\Google\\Chrome\\Application\\chrome.exe`,
      `${programFilesX86}\\Google\\Chrome\\Application\\chrome.exe`,
    );

    if (localAppData) {
      candidates.push(
        `${localAppData}\\Microsoft\\Edge\\Application\\msedge.exe`,
        `${localAppData}\\Google\\Chrome\\Application\\chrome.exe`,
      );
    }
  } else if (isDarwin) {
    candidates.push(
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    );
  } else {
    // Linux / BSD
    candidates.push(
      "/usr/bin/microsoft-edge",
      "/usr/bin/microsoft-edge-stable",
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/snap/bin/chromium",
    );
  }

  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  // Check PATH as fallback
  const fallbackNames = isWindows
    ? ["msedge.exe", "chrome.exe"]
    : ["microsoft-edge", "google-chrome", "chromium", "chromium-browser"];

  for (const name of fallbackNames) {
    try {
      const whichCmd = isWindows ? "where.exe" : "which";
      const cmd = new Deno.Command(whichCmd, {
        args: [name],
        stdout: "piped",
        stderr: "null",
      });
      const { code, stdout } = await cmd.output();
      if (code === 0) {
        const found = new TextDecoder().decode(stdout).trim().split(/\r?\n/)[0]?.trim();
        if (found && (await fileExists(found))) {
          return found;
        }
      }
    } catch {
      // Ignore search failures
    }
  }

  throw new Error(
    "No supported browser executable (Edge or Chrome) found. Specify one with --browser <path> or set BROWSER_PATH.",
  );
}

/**
 * Captures a screenshot of a single URL and saves it to the output file.
 */
export async function captureScreenshot(options: CaptureOptions): Promise<string> {
  const browser = options.browserPath ?? (await findBrowserExecutable());
  const resolvedOutput = resolve(Deno.cwd(), options.output);
  const outputDir = dirname(resolvedOutput);
  await Deno.mkdir(outputDir, { recursive: true });

  const viewport = options.viewport ?? "1280,900";
  const delay = options.delay ?? 2000;

  const args: string[] = [
    "--headless",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--hide-scrollbars",
    `--window-size=${viewport}`,
    `--screenshot=${resolvedOutput}`,
  ];

  if (delay > 0) {
    args.push(`--virtual-time-budget=${delay}`);
  }

  args.push(options.url);

  if (!options.silent) {
    console.log(`[Screenshot] Capturing ${options.url} -> ${resolvedOutput}`);
  }

  const command = new Deno.Command(browser, {
    args,
    stdout: "piped",
    stderr: "piped",
  });

  const { code, stderr } = await command.output();

  if (code !== 0) {
    const errorText = new TextDecoder().decode(stderr);
    throw new Error(`Browser exited with code ${code}: ${errorText}`);
  }

  if (!(await fileExists(resolvedOutput))) {
    const errorText = new TextDecoder().decode(stderr);
    throw new Error(
      `Screenshot was not produced at ${resolvedOutput}. Browser stderr: ${errorText}`,
    );
  }

  const stat = await Deno.stat(resolvedOutput);
  if (!options.silent) {
    console.log(`[Screenshot] Saved (${stat.size} bytes): ${resolvedOutput}`);
  }

  return resolvedOutput;
}

/**
 * Captures all standard key views (/tasks, /memories, /journals, /) from a target server.
 */
export async function captureAllViews(options?: CaptureViewsOptions): Promise<string[]> {
  const baseUrl = (options?.baseUrl ?? "http://localhost:8000").replace(/\/+$/, "");
  const outputDir = options?.outputDir ?? join("artifacts", "screenshots");
  const views = options?.views ?? DEFAULT_KEY_VIEWS;
  const results: string[] = [];

  if (!options?.silent) {
    console.log(`[Screenshot] Capturing ${views.length} key views from ${baseUrl}...`);
  }

  for (const view of views) {
    const targetUrl = `${baseUrl}${view.path}`;
    const outputPath = join(outputDir, `${view.name}.png`);
    const captured = await captureScreenshot({
      url: targetUrl,
      output: outputPath,
      viewport: options?.viewport,
      delay: options?.delay,
      browserPath: options?.browserPath,
      silent: options?.silent,
    });
    results.push(captured);
  }

  if (!options?.silent) {
    console.log(`[Screenshot] All ${results.length} views captured successfully in ${outputDir}`);
  }

  return results;
}

/**
 * Prints CLI usage instructions.
 */
export function printHelp(): void {
  console.log(`
Workflow MCP - Automated Headless Browser Screenshot Utility

Usage:
  deno run --allow-all scripts/screenshot.ts [options]

Options:
  --url <url>            Target URL to capture (e.g. http://localhost:8000/tasks)
  --output, -o <path>    Output PNG file path or folder (default: artifacts/screenshots/)
  --all, --views         Capture all key views (/, /tasks, /memories, /journals)
  --base-url <url>       Base server URL when capturing all views (default: http://localhost:8000)
  --viewport <w,h>       Browser viewport window size (default: 1280,900)
  --delay, --wait <ms>   Virtual time budget in milliseconds for rendering (default: 2000)
  --browser <path>       Explicit path to msedge or chrome executable
  --silent               Suppress progress logs
  --help, -h             Show this help message

Examples:
  # Capture all key views of running server
  deno run --allow-all scripts/screenshot.ts --all

  # Capture a specific page to a custom file
  deno run --allow-all scripts/screenshot.ts --url http://localhost:8000/tasks --output ./task-board.png

  # Capture with high resolution and extended rendering delay
  deno run --allow-all scripts/screenshot.ts --url http://localhost:8000/ --viewport 1920,1080 --wait 3000
`);
}

// CLI entrypoint
if (import.meta.main) {
  const args = parseArgs(Deno.args, {
    string: ["url", "output", "o", "base-url", "viewport", "delay", "wait", "browser"],
    boolean: ["all", "views", "silent", "help", "h"],
    alias: { o: "output", h: "help" },
  });

  if (args.help || args.h) {
    printHelp();
    Deno.exit(0);
  }

  const explicitUrl = args.url || (args._[0] ? String(args._[0]) : undefined);
  const explicitOutput = args.output;
  const baseUrl = args["base-url"] ?? "http://localhost:8000";
  const viewport = args.viewport ?? "1280,900";
  const delayStr = args.wait ?? args.delay;
  const delay = delayStr !== undefined ? Number(delayStr) : 2000;
  const browserPath = args.browser;
  const silent = Boolean(args.silent);

  try {
    if (args.all || args.views || !explicitUrl) {
      // Default to capturing all key views if no single URL specified
      await captureAllViews({
        baseUrl,
        outputDir: explicitOutput ?? join("artifacts", "screenshots"),
        viewport,
        delay,
        browserPath,
        silent,
      });
    } else {
      const outputPath = explicitOutput ?? join("artifacts", "screenshots", "screenshot.png");
      await captureScreenshot({
        url: explicitUrl,
        output: outputPath,
        viewport,
        delay,
        browserPath,
        silent,
      });
    }
  } catch (error) {
    console.error(`[Screenshot Error] ${error instanceof Error ? error.message : String(error)}`);
    Deno.exit(1);
  }
}
