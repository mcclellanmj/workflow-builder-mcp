import type { VNode } from "preact";
import { Button, EmptyState, SearchInput, type TabItem, Tabs } from "../components/index.ts";
import { type JournalEntry, JournalEntryCard } from "./JournalEntryCard.tsx";

export type { JournalEntry } from "./JournalEntryCard.tsx";

export interface RoleItem {
  id?: string;
  name: string;
  description?: string;
}

export interface JournalViewProps {
  entries?: JournalEntry[];
  roles?: (RoleItem | string)[];
  activeRoleTab?: string;
  searchQuery?: string;
  isLoading?: boolean;
  onRoleTabChange?: (role: string) => void;
  onSearchChange?: (query: string) => void;
  onNewRole?: () => void;
  onWriteEntry?: (role?: string) => void;
  onRefresh?: () => void;
  onCopyEntry?: (content: string) => void;
  onEditEntry?: (entry: JournalEntry) => void;
  class?: string;
  className?: string;
}

function normalizeRoles(roles: (RoleItem | string)[]): RoleItem[] {
  return roles.map((r) => (typeof r === "string" ? { name: r } : r));
}

/**
 * JournalView provides a full Engineering Role Journal dashboard with role filter tabs,
 * search input, chronological entry list, role metrics, and zero-state handling.
 */
export function JournalView({
  entries = [],
  roles = [],
  activeRoleTab = "all",
  searchQuery = "",
  isLoading = false,
  onRoleTabChange,
  onSearchChange,
  onNewRole,
  onWriteEntry,
  onRefresh,
  onCopyEntry,
  onEditEntry,
  class: classProp,
  className,
}: JournalViewProps): VNode {
  const customClass = classProp || className || "";
  const normalizedRoles = normalizeRoles(roles);

  // Collect unique role names from roles list + entries
  const roleNameSet = new Set<string>();
  for (const r of normalizedRoles) {
    if (r.name) roleNameSet.add(r.name);
  }
  for (const e of entries) {
    if (e.role) roleNameSet.add(e.role);
  }
  const allRoleNames = Array.from(roleNameSet).sort();

  // Filter entries based on active role tab and search query
  const filteredEntries = entries.filter((e) => {
    // Role filter
    if (activeRoleTab && activeRoleTab !== "all" && activeRoleTab !== "") {
      if (e.role.toLowerCase() !== activeRoleTab.toLowerCase()) {
        return false;
      }
    }

    // Search query filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const matchRole = e.role.toLowerCase().includes(q);
      const matchText = (e.entry || "").toLowerCase().includes(q);
      const matchAuthor = (e.writtenBy || "").toLowerCase().includes(q);
      const matchTags = e.tags?.some((t) => t.toLowerCase().includes(q)) ?? false;
      if (!matchRole && !matchText && !matchAuthor && !matchTags) {
        return false;
      }
    }

    return true;
  });

  // Sort chronological descending (most recent first)
  const sortedEntries = [...filteredEntries].sort((a, b) => {
    const timeA = new Date(a.timestamp || a.updatedAt || a.createdAt || 0).getTime();
    const timeB = new Date(b.timestamp || b.updatedAt || b.createdAt || 0).getTime();
    return timeB - timeA;
  });

  // Build tabs items
  const tabs: TabItem[] = [
    {
      id: "all",
      label: "All Roles",
      count: entries.length,
    },
    ...allRoleNames.map((roleName) => ({
      id: roleName,
      label: `@${roleName}`,
      count: entries.filter((e) => e.role.toLowerCase() === roleName.toLowerCase()).length,
    })),
  ];

  const handleTabSelect = (tabId: string): void => {
    if (onRoleTabChange) {
      onRoleTabChange(tabId);
    }
  };

  const handleWriteClick = (): void => {
    if (onWriteEntry) {
      const targetRole = activeRoleTab && activeRoleTab !== "all" ? activeRoleTab : undefined;
      onWriteEntry(targetRole);
    }
  };

  return (
    <div
      class={`flex flex-col min-h-full gap-6 p-6 bg-gray-950 text-gray-100 ${customClass}`.trim()}
    >
      {/* Header & Controls Section */}
      <div class="flex flex-col gap-4 bg-gray-900/60 p-5 rounded-xl border border-gray-800/80 backdrop-blur-sm">
        {/* Title Bar & Actions */}
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-xl">
              📖
            </div>
            <div>
              <h1 class="text-lg font-bold text-gray-100 tracking-tight flex items-center gap-2">
                Engineering Role Journals
              </h1>
              <p class="text-xs text-gray-400">
                Chronological role logs, architecture decisions, and session handoffs
              </p>
            </div>
          </div>

          <div class="flex items-center gap-2 self-start sm:self-auto flex-wrap">
            {onRefresh && (
              <Button
                variant="secondary"
                size="sm"
                onClick={onRefresh}
                title="Refresh Journals"
              >
                <span>🔄</span>
                <span>Refresh</span>
              </Button>
            )}
            {onNewRole && (
              <Button
                variant="secondary"
                size="sm"
                onClick={onNewRole}
                title="Define a new engineering role"
              >
                <span>➕</span>
                <span>New Role</span>
              </Button>
            )}
            <Button
              variant="primary"
              size="sm"
              onClick={handleWriteClick}
              title="Write a new journal entry"
            >
              <span>📝</span>
              <span>Write Entry</span>
            </Button>
          </div>
        </div>

        {/* Metrics Row */}
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-gray-800/70">
          <div class="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-900 border border-gray-800">
            <span class="text-sm">👥</span>
            <div class="flex flex-col">
              <span class="text-[10px] uppercase font-semibold tracking-wider text-gray-500">
                Roles
              </span>
              <span class="font-mono font-bold text-sm text-gray-200">
                {allRoleNames.length}
              </span>
            </div>
          </div>

          <div class="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-900 border border-gray-800">
            <span class="text-sm">📖</span>
            <div class="flex flex-col">
              <span class="text-[10px] uppercase font-semibold tracking-wider text-emerald-400">
                Entries
              </span>
              <span class="font-mono font-bold text-sm text-emerald-300">
                {entries.length}
              </span>
            </div>
          </div>

          <div class="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-900 border border-gray-800">
            <span class="text-sm">🎯</span>
            <div class="flex flex-col">
              <span class="text-[10px] uppercase font-semibold tracking-wider text-indigo-400">
                Active Filter
              </span>
              <span class="font-mono font-bold text-xs text-indigo-300 truncate">
                {activeRoleTab && activeRoleTab !== "all" ? `@${activeRoleTab}` : "All Roles"}
              </span>
            </div>
          </div>

          <div class="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-900 border border-gray-800">
            <span class="text-sm">🔍</span>
            <div class="flex flex-col">
              <span class="text-[10px] uppercase font-semibold tracking-wider text-sky-400">
                Showing
              </span>
              <span class="font-mono font-bold text-sm text-sky-300">
                {sortedEntries.length}
              </span>
            </div>
          </div>
        </div>

        {/* Search Bar */}
        <div class="pt-1">
          <SearchInput
            placeholder="Search role journals by keyword, author, entry text, or tag..."
            value={searchQuery}
            onSearch={onSearchChange}
            id="journal-search-input"
          />
        </div>

        {/* Role Navigation Tabs Strip */}
        <div class="pt-1">
          <Tabs
            tabs={tabs}
            activeTab={activeRoleTab || "all"}
            onTabChange={handleTabSelect}
            ariaLabel="Role Journal Tabs"
          />
        </div>
      </div>

      {/* Main Journal Content: List or Empty / Loading State */}
      <div id="rolesGrid">
        {isLoading
          ? (
            <div class="flex flex-col items-center justify-center p-12 text-center text-gray-400 gap-3">
              <div class="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
              <p class="text-sm font-medium">Loading Role Journal entries...</p>
            </div>
          )
          : sortedEntries.length === 0
          ? (
            <EmptyState
              title="No journal entries found"
              description={searchQuery || (activeRoleTab && activeRoleTab !== "all")
                ? "No journal entries match your selected role or search keyword. Try clearing filters or selecting another role tab."
                : "No engineering journal logs have been recorded yet. Add your first journal entry to document engineering decisions, progress, and handoffs."}
              icon="📖"
              action={
                <Button variant="primary" size="md" onClick={handleWriteClick}>
                  <span>📝</span>
                  <span>Write First Journal Entry</span>
                </Button>
              }
            />
          )
          : (
            <div class="flex flex-col gap-4">
              {sortedEntries.map((entry, index) => (
                <JournalEntryCard
                  key={entry.id || `${entry.role}-${entry.timestamp || index}`}
                  entry={entry}
                  onCopy={onCopyEntry}
                  onEdit={onEditEntry}
                />
              ))}
            </div>
          )}
      </div>
    </div>
  );
}
