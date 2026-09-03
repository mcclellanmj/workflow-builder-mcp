import type { VNode } from "preact";
import { Badge, Button } from "../components/index.ts";

export interface JournalEntry {
  id?: string;
  role: string;
  entry: string;
  writtenBy?: string;
  timestamp?: string;
  createdAt?: string;
  updatedAt?: string;
  tags?: string[];
}

export interface JournalEntryCardProps {
  entry: JournalEntry;
  onCopy?: (content: string) => void;
  onEdit?: (entry: JournalEntry) => void;
  class?: string;
  className?: string;
}

function formatTimestamp(isoString?: string): string {
  if (!isoString) return "Recently";
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

function getRoleColor(role: string): { bg: string; text: string; border: string } {
  const normalized = role.toLowerCase();
  if (normalized.includes("dev") || normalized.includes("engineer")) {
    return { bg: "bg-blue-950/70", text: "text-blue-400", border: "border-blue-800/60" };
  }
  if (normalized.includes("arch") || normalized.includes("lead")) {
    return { bg: "bg-purple-950/70", text: "text-purple-400", border: "border-purple-800/60" };
  }
  if (normalized.includes("review") || normalized.includes("qa") || normalized.includes("test")) {
    return { bg: "bg-emerald-950/70", text: "text-emerald-400", border: "border-emerald-800/60" };
  }
  if (normalized.includes("sec") || normalized.includes("ops")) {
    return { bg: "bg-rose-950/70", text: "text-rose-400", border: "border-rose-800/60" };
  }
  return { bg: "bg-indigo-950/70", text: "text-indigo-400", border: "border-indigo-800/60" };
}

/**
 * JournalEntryCard displays an individual role journal entry card with role avatar/badge,
 * formatted ISO timestamp, markdown/text body, tags, and action buttons.
 */
export function JournalEntryCard({
  entry,
  onCopy,
  onEdit,
  class: classProp,
  className,
}: JournalEntryCardProps): VNode {
  const customClass = classProp || className || "";
  const isoTime = entry.timestamp || entry.updatedAt || entry.createdAt || "";
  const formattedTime = formatTimestamp(isoTime);
  const colors = getRoleColor(entry.role);
  const initial = entry.role.trim().charAt(0).toUpperCase() || "R";

  const handleCopy = (): void => {
    if (onCopy) {
      onCopy(entry.entry);
    } else if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(entry.entry).catch(() => {
        // Fallback or ignore in headless mode
      });
    }
  };

  const handleEdit = (): void => {
    if (onEdit) {
      onEdit(entry);
    }
  };

  return (
    <div
      class={`group relative flex flex-col gap-3 p-5 rounded-xl bg-gray-900/90 border border-gray-800 hover:border-gray-700 transition-all duration-150 shadow-sm hover:shadow-md ${customClass}`
        .trim()}
      data-role={entry.role}
      data-entry-id={entry.id}
    >
      {/* Header: Role Avatar, Role Badge, Author, & Formatted Timestamp */}
      <div class="flex items-start justify-between gap-3 flex-wrap sm:flex-nowrap">
        <div class="flex items-center gap-3">
          {/* Role Avatar */}
          <div
            class={`w-9 h-9 rounded-lg flex items-center justify-center font-mono font-bold text-sm border ${colors.bg} ${colors.text} ${colors.border} shadow-sm shrink-0`}
            title={`Role: ${entry.role}`}
          >
            {initial}
          </div>

          <div class="flex flex-col gap-0.5">
            <div class="flex items-center gap-2 flex-wrap">
              <Badge variant="role">@{entry.role}</Badge>
              {entry.writtenBy && (
                <span class="text-xs text-gray-400 flex items-center gap-1">
                  <span>by</span>
                  <span class="text-gray-200 font-medium font-mono">
                    {entry.writtenBy}
                  </span>
                </span>
              )}
            </div>

            {isoTime && (
              <time
                dateTime={isoTime}
                title={isoTime}
                class="text-[11px] font-mono text-gray-500 flex items-center gap-1"
              >
                <span>🕒</span>
                <span>{formattedTime}</span>
              </time>
            )}
          </div>
        </div>

        {/* Action Controls */}
        <div class="flex items-center gap-1.5 self-start sm:self-center shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCopy}
            title="Copy journal entry content"
            class="text-gray-400 hover:text-gray-200"
          >
            <span>📋</span>
            <span class="hidden sm:inline">Copy</span>
          </Button>

          {onEdit && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleEdit}
              title="Edit journal entry"
              class="text-gray-400 hover:text-gray-200"
            >
              <span>✏️</span>
              <span class="hidden sm:inline">Edit</span>
            </Button>
          )}
        </div>
      </div>

      {/* Markdown / Text Body */}
      <div class="rounded-lg bg-gray-950/80 border border-gray-800/80 p-4 text-sm text-gray-200 font-sans leading-relaxed whitespace-pre-wrap break-words overflow-x-auto">
        {entry.entry || <span class="text-gray-600 italic">No entry text recorded.</span>}
      </div>

      {/* Tags Row (if provided) */}
      {entry.tags && entry.tags.length > 0 && (
        <div class="flex flex-wrap items-center gap-1.5 pt-1">
          <span class="text-[10px] uppercase font-semibold text-gray-500 tracking-wider">
            Tags:
          </span>
          {entry.tags.map((tag) => (
            <span
              key={tag}
              class="text-[11px] font-mono text-gray-400 bg-gray-800/70 border border-gray-700/60 px-2 py-0.5 rounded-full hover:text-gray-200 transition-colors"
            >
              #{tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
