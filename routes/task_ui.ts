/**
 * Server-Side Rendered & Interactive Single-Page Web Application for Task Kanban Board,
 * Memory Vault & Explorer, and Role Journals.
 * Powered by Preact SSR and modern modular client script.
 */

import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { BaseLayout } from "../views/layouts/BaseLayout.tsx";
import { renderHtmlResponse } from "../views/ssr.ts";
import { TaskApp } from "../views/tasks/TaskApp.tsx";

export interface TaskUiOptions {
  origin: string;
  userId?: string;
  userName?: string;
  initialTab?: "tasks" | "memories" | "journals";
}

/**
 * Renders the full TaskApp view into a standard HTTP Response with Twind CSS injection
 * and security headers.
 */
export function renderTasksHtml(options: TaskUiOptions): Response {
  return renderHtmlResponse(
    h(TaskApp, {
      origin: options.origin,
      userId: options.userId,
      userName: options.userName,
      initialTab: options.initialTab,
    }),
    {
      title: "Tasks Board — Workflow MCP",
    },
  );
}

/**
 * Legacy HTML string generator maintained for backward compatibility.
 * Returns the rendered HTML document as a string.
 */
export function renderTaskKanbanHtml(options: TaskUiOptions): string {
  const vnode = h(TaskApp, {
    origin: options.origin,
    userId: options.userId,
    userName: options.userName,
    initialTab: options.initialTab,
  });

  return renderToString(
    h(BaseLayout, {
      title: "Tasks Board — Workflow MCP",
      children: vnode,
    }),
  );
}
