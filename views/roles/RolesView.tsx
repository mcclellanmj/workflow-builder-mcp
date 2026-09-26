import type { VNode } from "preact";
import { Button, EmptyState, SearchInput } from "../components/index.ts";

// Helper to emit raw event handler attributes in SSR without TypeScript JSX type errors
// deno-lint-ignore no-explicit-any
const rawAttr = (attrs: Record<string, any>): any => attrs;

export interface RoleItem {
  id?: string;
  name: string;
  description?: string;
  workflowId?: string;
  createdAt?: string;
  updatedAt?: string;
  taskCount?: number;
}

export interface RolesViewProps {
  roles?: (RoleItem | string)[];
  searchQuery?: string;
  isLoading?: boolean;
  onSearchChange?: (query: string) => void;
  onNewRole?: () => void;
  onRefresh?: () => void;
  onInspectRole?: (roleName: string) => void;
  class?: string;
  className?: string;
}

function normalizeRoles(roles: (RoleItem | string)[]): RoleItem[] {
  return roles.map((r) => (typeof r === "string" ? { name: r } : r));
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
 * RolesView provides a unified Roles Catalog and Directory with role cards,
 * job description previews (<500 chars), journal indicators, task count badges,
 * and drill-down into role details.
 */
export function RolesView({
  roles = [],
  searchQuery = "",
  isLoading = false,
  onSearchChange,
  onNewRole,
  onRefresh,
  class: classProp,
  className,
}: RolesViewProps): VNode {
  const customClass = classProp || className || "";
  const normalizedRoles = normalizeRoles(roles);

  // Filter roles based on search query
  const filteredRoles = normalizedRoles.filter((r) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    const matchName = r.name.toLowerCase().includes(q);
    const matchDesc = (r.description || "").toLowerCase().includes(q);
    return matchName || matchDesc;
  });

  return (
    <div
      class={`flex flex-col min-h-full gap-6 p-6 bg-gray-950 text-gray-100 ${customClass}`.trim()}
    >
      {/* Header & Controls Section */}
      <div class="flex flex-col gap-4 bg-gray-900/60 p-5 rounded-xl border border-gray-800/80 backdrop-blur-sm">
        {/* Title Bar & Actions */}
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-lg bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-xl">
              👥
            </div>
            <div>
              <h1 class="text-lg font-bold text-gray-100 tracking-tight flex items-center gap-2">
                Engineering Roles Catalog
              </h1>
              <p class="text-xs text-gray-400">
                Directory of agent roles, operational job descriptions, and assigned tasks
              </p>
            </div>
          </div>

          <div class="flex items-center gap-2 self-start sm:self-auto flex-wrap">
            <Button
              variant="secondary"
              size="sm"
              onClick={onRefresh}
              title="Refresh Roles"
              {...rawAttr({ onclick: "loadRoles(true)" })}
            >
              <span>🔄</span>
              <span>Refresh</span>
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={onNewRole}
              title="Define a new engineering role"
              {...rawAttr({ onclick: "openNewRoleModal()" })}
            >
              <span>➕</span>
              <span>New Role</span>
            </Button>
          </div>
        </div>

        {/* Metrics Row */}
        <div class="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-2 border-t border-gray-800/70">
          <div class="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-900 border border-gray-800">
            <span class="text-sm">👥</span>
            <div class="flex flex-col">
              <span class="text-[10px] uppercase font-semibold tracking-wider text-gray-500">
                Total Roles
              </span>
              <span id="statRoles" class="font-mono font-bold text-sm text-gray-200">
                {normalizedRoles.length}
              </span>
            </div>
          </div>

          <div class="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-900 border border-gray-800">
            <span class="text-sm">🎯</span>
            <div class="flex flex-col">
              <span class="text-[10px] uppercase font-semibold tracking-wider text-indigo-400">
                Job Descriptions
              </span>
              <span class="font-mono font-bold text-sm text-indigo-300">
                {normalizedRoles.filter((r) => r.description && r.description.trim()).length}
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
                {filteredRoles.length}
              </span>
            </div>
          </div>
        </div>

        {/* Search Bar */}
        <div class="pt-1">
          <SearchInput
            placeholder="Search roles by name, job description snippet, or journal content..."
            value={searchQuery}
            onSearch={onSearchChange}
            id="journal-search-input"
          />
        </div>
      </div>

      {/* Main Roles Grid */}
      <div id="rolesGrid">
        {isLoading
          ? (
            <div class="flex flex-col items-center justify-center p-12 text-center text-gray-400 gap-3">
              <div class="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <p class="text-sm font-medium">Loading engineering roles...</p>
            </div>
          )
          : filteredRoles.length === 0
          ? (
            <EmptyState
              title="No roles found"
              description={searchQuery
                ? "No roles match your search keyword. Try clearing your search query."
                : "No engineering roles defined yet. Create your first role with a job description to organize tasks and agent handoffs."}
              icon="👥"
              action={
                <Button
                  variant="primary"
                  size="md"
                  onClick={onNewRole}
                  {...rawAttr({ onclick: "openNewRoleModal()" })}
                >
                  <span>➕</span>
                  <span>Define First Role</span>
                </Button>
              }
            />
          )
          : (
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredRoles.map((role) => {
                const colors = getRoleColor(role.name);
                const initial = role.name.trim().charAt(0).toUpperCase() || "R";

                return (
                  <div
                    key={role.id || role.name}
                    class="group relative flex flex-col justify-between gap-3 p-5 rounded-xl bg-gray-900/90 border border-gray-800 hover:border-gray-700 transition-all duration-150 shadow-sm hover:shadow-md cursor-pointer"
                    data-role={role.name}
                    {...rawAttr({ onclick: `openRoleDetailModal('${role.name}')` })}
                  >
                    {/* Top: Avatar, Role Title */}
                    <div class="flex flex-col gap-2.5">
                      <div class="flex items-start justify-between gap-3">
                        <div class="flex items-center gap-2.5 min-w-0">
                          <div
                            class={`w-10 h-10 rounded-lg flex items-center justify-center font-mono font-bold text-base border ${colors.bg} ${colors.text} ${colors.border} shadow-sm shrink-0`}
                          >
                            {initial}
                          </div>
                          <div class="flex flex-col min-w-0">
                            <span class="font-mono font-bold text-sm text-gray-100 truncate group-hover:text-blue-400 transition-colors">
                              @{role.name}
                            </span>
                            <span class="text-[11px] text-gray-500 font-mono">
                              {role.createdAt
                                ? `Created ${new Date(role.createdAt).toLocaleDateString()}`
                                : "Active Role"}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Job Description Snippet (< 500 chars) */}
                      <div class="mt-1">
                        {role.description
                          ? (
                            <p class="text-xs text-gray-300 line-clamp-3 leading-relaxed">
                              {role.description}
                            </p>
                          )
                          : (
                            <p class="text-xs text-gray-500 italic">
                              No job description defined. Click Inspect to add responsibilities.
                            </p>
                          )}
                      </div>
                    </div>

                    {/* Actions Footer */}
                    <div class="flex items-center justify-between pt-3 border-t border-gray-800/80 gap-2">
                      <button
                        type="button"
                        class="inline-flex items-center gap-1 text-xs font-semibold text-blue-400 hover:text-blue-300 transition-colors"
                        {...rawAttr({
                          onclick: `event.stopPropagation(); openRoleDetailModal('${role.name}')`,
                        })}
                      >
                        <span>🔍</span>
                        <span>Inspect Role</span>
                      </button>

                      <div class="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          class="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors"
                          title="View tasks for this role"
                          {...rawAttr({
                            onclick: `event.stopPropagation(); viewRoleTasks('${role.name}')`,
                          })}
                        >
                          <span>📋</span>
                          <span>Tasks</span>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
      </div>
    </div>
  );
}
