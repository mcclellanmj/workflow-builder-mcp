import type { VNode } from "preact";
import { Button, EmptyState, SearchInput, Select } from "../components/index.ts";
import { MemoryCard, type MemoryCardItem } from "./MemoryCard.tsx";

export type { MemoryCardItem } from "./MemoryCard.tsx";

export interface MemoryMetrics {
  total: number;
  workflowScope: number;
  nodeScope: number;
  roleScope: number;
  totalRecalls: number;
}

export interface MemoryVaultProps {
  memories?: MemoryCardItem[];
  availableRoles?: string[];
  searchQuery?: string;
  selectedRole?: string;
  selectedScope?: string;
  metrics?: Partial<MemoryMetrics>;
  isLoading?: boolean;
  onSearchChange?: (query: string) => void;
  onRoleFilterChange?: (role: string) => void;
  onScopeFilterChange?: (scope: string) => void;
  onNewMemory?: () => void;
  onRefresh?: () => void;
  onCopyMemory?: (content: string) => void;
  onDeleteMemory?: (id: string) => void;
  onInspectMemory?: (id: string) => void;
  class?: string;
  className?: string;
}

/**
 * MemoryVault View provides an interactive memory browser with search filtering,
 * role/scope dropdowns, aggregate metrics pills, memory cards grid, and zero-state handling.
 */
export function MemoryVault({
  memories = [],
  availableRoles = [],
  searchQuery = "",
  selectedRole = "",
  selectedScope = "",
  metrics,
  isLoading = false,
  onSearchChange,
  onRoleFilterChange,
  onScopeFilterChange,
  onNewMemory,
  onRefresh,
  onCopyMemory,
  onDeleteMemory,
  onInspectMemory,
  class: classProp,
  className,
}: MemoryVaultProps): VNode {
  const customClass = classProp || className || "";

  // Derive metrics if not explicitly provided
  const totalCount = metrics?.total ?? memories.length;
  const workflowCount = metrics?.workflowScope ??
    memories.filter((m) => (m.scope || "workflow") === "workflow").length;
  const nodeCount = metrics?.nodeScope ??
    memories.filter((m) => m.scope === "node").length;
  const roleCount = metrics?.roleScope ??
    memories.filter((m) => m.scope === "role" || Boolean(m.roleId)).length;
  const recallsCount = metrics?.totalRecalls ??
    memories.reduce((sum, m) => sum + (m.accessCount ?? 0), 0);

  // Build role options for dropdown
  const roleOptions = [
    { value: "", label: "All Roles" },
    ...availableRoles.map((role) => ({
      value: role,
      label: `@${role}`,
    })),
  ];

  const scopeOptions = [
    { value: "", label: "All Scopes" },
    { value: "workflow", label: "Workflow Scope" },
    { value: "node", label: "Node Scope" },
    { value: "role", label: "Role Scope" },
  ];

  return (
    <div
      class={`flex flex-col min-h-full gap-6 p-6 bg-gray-950 text-gray-100 ${customClass}`.trim()}
    >
      {/* Header & Controls Section */}
      <div class="flex flex-col gap-4 bg-gray-900/60 p-5 rounded-xl border border-gray-800/80 backdrop-blur-sm">
        {/* Top Title & Actions Bar */}
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-lg bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-xl">
              🧠
            </div>
            <div>
              <h1 class="text-lg font-bold text-gray-100 tracking-tight flex items-center gap-2">
                Memory Vault & Explorer
              </h1>
              <p class="text-xs text-gray-400">
                Persistent shared memory, cross-role context, and agent execution recalls
              </p>
            </div>
          </div>

          <div class="flex items-center gap-2 self-start sm:self-auto">
            {onRefresh && (
              <Button
                variant="secondary"
                size="sm"
                onClick={onRefresh}
                title="Refresh Memory Vault"
              >
                <span>🔄</span>
                <span>Refresh</span>
              </Button>
            )}
            <Button
              variant="primary"
              size="sm"
              onClick={onNewMemory}
              title="Create and save a new memory entry"
            >
              <span>➕</span>
              <span>New Memory</span>
            </Button>
          </div>
        </div>

        {/* Aggregate Metrics Bar */}
        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 pt-2 border-t border-gray-800/70">
          <div class="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-900 border border-gray-800">
            <span class="text-sm">🧠</span>
            <div class="flex flex-col">
              <span class="text-[10px] uppercase font-semibold tracking-wider text-gray-500">
                Total
              </span>
              <span id="memStatTotal" class="font-mono font-bold text-sm text-gray-200">
                {totalCount}
              </span>
            </div>
          </div>

          <div class="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-900 border border-gray-800">
            <span class="text-sm">📊</span>
            <div class="flex flex-col">
              <span class="text-[10px] uppercase font-semibold tracking-wider text-sky-400">
                Workflow
              </span>
              <span id="memStatWorkflow" class="font-mono font-bold text-sm text-sky-300">
                {workflowCount}
              </span>
            </div>
          </div>

          <div class="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-900 border border-gray-800">
            <span class="text-sm">🧩</span>
            <div class="flex flex-col">
              <span class="text-[10px] uppercase font-semibold tracking-wider text-purple-400">
                Node
              </span>
              <span class="font-mono font-bold text-sm text-purple-300">{nodeCount}</span>
            </div>
          </div>

          <div class="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-900 border border-gray-800">
            <span class="text-sm">🏷️</span>
            <div class="flex flex-col">
              <span class="text-[10px] uppercase font-semibold tracking-wider text-amber-400">
                Role
              </span>
              <span id="memStatRole" class="font-mono font-bold text-sm text-amber-300">
                {roleCount}
              </span>
            </div>
          </div>

          <div class="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 col-span-2 sm:col-span-1">
            <span class="text-sm">👁️</span>
            <div class="flex flex-col">
              <span class="text-[10px] uppercase font-semibold tracking-wider text-emerald-400">
                Recalls
              </span>
              <span class="font-mono font-bold text-sm text-emerald-300">{recallsCount}</span>
            </div>
          </div>
        </div>

        {/* Filters & Search Controls Row */}
        <div class="grid grid-cols-1 md:grid-cols-12 gap-3 items-end pt-1">
          <div class="md:col-span-6">
            <SearchInput
              placeholder="Search memories by key, summary, tag, or content..."
              value={searchQuery}
              onSearch={onSearchChange}
              id="memory-search-input"
            />
          </div>

          {availableRoles.length > 0 && (
            <div class="md:col-span-3">
              <Select
                options={roleOptions}
                value={selectedRole}
                onChange={(e) => onRoleFilterChange?.((e.currentTarget as HTMLSelectElement).value)}
                id="memory-role-select"
              />
            </div>
          )}

          <div class={availableRoles.length > 0 ? "md:col-span-3" : "md:col-span-6"}>
            <Select
              options={scopeOptions}
              value={selectedScope}
              onChange={(e) => onScopeFilterChange?.((e.currentTarget as HTMLSelectElement).value)}
              id="memory-scope-select"
            />
          </div>
        </div>
      </div>

      {/* Main Grid or Empty / Loading State */}
      <div id="memoriesGrid">
        {isLoading
          ? (
            <div class="flex flex-col items-center justify-center p-12 text-center text-gray-400 gap-3">
              <div class="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <p class="text-sm font-medium">Loading Memory Vault records...</p>
            </div>
          )
          : memories.length === 0
          ? (
            <EmptyState
              title="No memories found"
              description={searchQuery || selectedRole || selectedScope
                ? "No memories matched your search query or scope filter. Try clearing filters or searching for another term."
                : "The Memory Vault has no saved records yet. Save your first memory to persist knowledge across task runs and engineering roles."}
              icon="🧠"
              action={
                <Button variant="primary" size="md" onClick={onNewMemory}>
                  <span>➕</span>
                  <span>Save First Memory</span>
                </Button>
              }
            />
          )
          : (
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {memories.map((mem) => (
                <MemoryCard
                  key={mem.id}
                  memory={mem}
                  onCopy={onCopyMemory}
                  onDelete={onDeleteMemory}
                  onInspect={onInspectMemory}
                />
              ))}
            </div>
          )}
      </div>
    </div>
  );
}
