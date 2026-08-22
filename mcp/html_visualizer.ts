/**
 * HTML Visualizer Generator (Deno SSR Powered)
 *
 * Produces a self-contained, interactive HTML document using pure Server-Side Rendering
 * with zero external CDN dependencies.
 */

import type { WorkflowExportBundle } from "../store/types.ts";
import { generateSsrVisualizerHtml, type SsrVisualizerOptions } from "./ssr_visualizer.ts";

export interface HtmlVisualizerOptions {
  bundle: WorkflowExportBundle;
  activeExecutionId?: string;
  serverOrigin?: string;
}

export function generateInteractiveHtml(options: HtmlVisualizerOptions): string {
  const ssrOptions: SsrVisualizerOptions = {
    bundle: options.bundle,
    activeExecutionId: options.activeExecutionId,
    serverOrigin: options.serverOrigin,
    isStandaloneFile: true,
  };
  return generateSsrVisualizerHtml(ssrOptions);
}
