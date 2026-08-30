import type { ViewTicket, WorkflowExportBundle } from "../../store/types.ts";

export interface SsrVisualizerOptions {
  bundle: WorkflowExportBundle;
  activeExecutionId?: string;
  viewTicket?: ViewTicket | null;
  serverOrigin?: string;
  isStandaloneFile?: boolean;
}

export function escapeHtml(text: string | null | undefined): string {
  if (text == null) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
