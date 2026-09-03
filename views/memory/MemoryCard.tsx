import type { VNode } from "preact";
import { Badge, Button } from "../components/index.ts";

export interface MemoryCardItem {
  id: string;
  key: string;
  summary?: string;
  content?: string;
  value?: string;
  scope?: "workflow" | "node" | "role" | string;
  roleId?: string;
  workflowId?: string;
  nodeId?: string;
  tags?: string[];
  accessCount?: number;
  source?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface MemoryCardProps {
  memory: MemoryCardItem;
  onCopy?: (content: string) => void;
  onDelete?: (id: string) => void;
  onInspect?: (id: string) => void;
  class?: string;
  className?: string;
}

function formatValuePreview(raw?: string): { isJson: boolean; text: string } {
  if (!raw) return { isJson: false, text: "" };
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      const parsed = JSON.parse(trimmed);
      return { isJson: true, text: JSON.stringify(parsed, null, 2) };
    } catch {
      // Fall through to plain text
    }
  }
  return { isJson: false, text: trimmed };
}

function formatTimestamp(isoString?: string): string {
  if (!isoString) return "-";
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    return d.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return isoString;
  }
}

/**
 * MemoryCard displays an individual memory item with key, role badge, timestamp,
 * formatted JSON or text preview, and quick copy/delete action buttons.
 */
export function MemoryCard({
  memory,
  onCopy,
  onDelete,
  onInspect,
  class: classProp,
  className,
}: MemoryCardProps): VNode {
  const customClass = classProp || className || "";
  const rawContent = memory.content ?? memory.value ?? "";
  const preview = formatValuePreview(rawContent);
  const timeLabel = formatTimestamp(memory.updatedAt || memory.createdAt);

  const scope = memory.scope || (memory.roleId ? "role" : "workflow");
  const targetRef = memory.workflowId
    ? `Workflow: ${memory.workflowId}`
    : memory.nodeId
    ? `Node: ${memory.nodeId}`
    : memory.roleId
    ? `Role: ${memory.roleId}`
    : null;

  const handleCopy = (): void => {
    if (onCopy) {
      onCopy(rawContent);
    } else if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(rawContent).catch(() => {
        // Ignore clipboard failure in headless/unsupported contexts
      });
    }
  };

  const handleDelete = (): void => {
    if (onDelete) {
      onDelete(memory.id);
    }
  };

  const handleInspect = (): void => {
    if (onInspect) {
      onInspect(memory.id);
    }
  };

  return (
    <div
      class={`group relative flex flex-col justify-between gap-3 p-4 rounded-xl bg-gray-900/90 border border-gray-800 hover:border-gray-700 transition-all duration-150 shadow-sm hover:shadow-md ${customClass}`
        .trim()}
      data-memory-id={memory.id}
    >
      {/* Header: Key & Role/Scope Badges */}
      <div class="flex flex-col gap-2">
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-1.5 flex-wrap">
            {memory.roleId
              ? <Badge variant="role">@{memory.roleId}</Badge>
              : scope === "role"
              ? <Badge variant="role">ROLE</Badge>
              : scope === "node"
              ? <Badge variant="review">NODE</Badge>
              : <Badge variant="open">WORKFLOW</Badge>}
            {memory.source && (
              <span class="text-[10px] font-mono uppercase tracking-wider text-gray-500 bg-gray-800/80 px-1.5 py-0.5 rounded border border-gray-700/50">
                {memory.source}
              </span>
            )}
          </div>

          <span
            class="inline-flex items-center gap-1 text-[11px] font-mono text-emerald-400 bg-emerald-950/50 border border-emerald-800/50 px-2 py-0.5 rounded-full"
            title="Total recall count"
          >
            <span>👁️</span>
            <span>{memory.accessCount ?? 0}</span>
          </span>
        </div>

        {/* Memory Key */}
        <h4
          class="font-mono font-semibold text-sm text-sky-400 hover:text-sky-300 break-all cursor-pointer transition-colors"
          onClick={handleInspect}
          title={memory.key}
        >
          {memory.key}
        </h4>

        {/* Short Summary */}
        {memory.summary && (
          <p class="text-xs text-gray-300 line-clamp-2 leading-relaxed">
            {memory.summary}
          </p>
        )}

        {/* Target Reference */}
        {targetRef && (
          <div class="text-[11px] font-mono text-gray-500 flex items-center gap-1">
            <span>🎯</span>
            <span class="truncate">{targetRef}</span>
          </div>
        )}
      </div>

      {/* Content / Value Preview (with JSON formatting) */}
      <div class="rounded-lg bg-gray-950 border border-gray-800/80 p-2.5 overflow-hidden">
        <div class="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-gray-500 mb-1.5 pb-1 border-b border-gray-800/60">
          <span>{preview.isJson ? "JSON Payload" : "Content Preview"}</span>
          <span class="text-gray-600">{rawContent.length} chars</span>
        </div>
        {preview.isJson
          ? (
            <pre class="font-mono text-xs text-emerald-400 overflow-x-auto max-h-28 whitespace-pre scrollbar-thin scrollbar-thumb-gray-800">
            {preview.text}
            </pre>
          )
          : (
            <p class="font-mono text-xs text-gray-300 whitespace-pre-wrap break-all line-clamp-4 max-h-28 overflow-y-auto">
              {preview.text || <span class="text-gray-600 italic">(Empty memory content)</span>}
            </p>
          )}
      </div>

      {/* Tags Row */}
      {memory.tags && memory.tags.length > 0 && (
        <div class="flex flex-wrap gap-1">
          {memory.tags.map((tag) => (
            <span
              key={tag}
              class="text-[11px] font-mono text-gray-400 bg-gray-800/70 border border-gray-700/60 px-1.5 py-0.5 rounded hover:text-gray-200 transition-colors"
            >
              #{tag}
            </span>
          ))}
        </div>
      )}

      {/* Footer: Timestamp & Action Buttons */}
      <div class="flex items-center justify-between pt-2.5 border-t border-gray-800/80 gap-2">
        <span
          class="text-[11px] text-gray-500 truncate"
          title={`Updated at ${memory.updatedAt || memory.createdAt || "unknown"}`}
        >
          🕒 {timeLabel}
        </span>

        <div class="flex items-center gap-1.5 shrink-0">
          <Button
            variant="secondary"
            size="sm"
            onClick={handleCopy}
            title="Copy memory content to clipboard"
            data-action="copy"
          >
            <span>📋</span>
            <span>Copy</span>
          </Button>

          <Button
            variant="danger"
            size="sm"
            onClick={handleDelete}
            title="Delete this memory"
            data-action="delete"
          >
            <span>🗑️</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
