import type { ComponentChildren, VNode } from "preact";

export interface EmptyStateProps {
  title?: string;
  description?: string;
  icon?: ComponentChildren;
  action?: ComponentChildren;
  children?: ComponentChildren;
  class?: string;
  className?: string;
}

/**
 * Placeholder component for zero-state lists, empty search results, or initial states.
 */
export function EmptyState({
  title = "No items found",
  description,
  icon,
  action,
  children,
  class: classProp,
  className,
}: EmptyStateProps): VNode {
  const customClass = classProp || className || "";

  return (
    <div
      class={`flex flex-col items-center justify-center p-8 text-center rounded-xl border border-dashed border-gray-800 bg-gray-900/30 ${customClass}`
        .trim()}
    >
      <div class="w-12 h-12 rounded-full bg-gray-800/80 border border-gray-700/60 flex items-center justify-center text-gray-400 mb-3.5">
        {icon ?? (
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.5"
              d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
            />
          </svg>
        )}
      </div>

      {title && (
        <h3 class="text-sm font-semibold text-gray-200 mb-1">
          {title}
        </h3>
      )}

      {description && (
        <p class="text-xs text-gray-400 max-w-sm mb-4">
          {description}
        </p>
      )}

      {action && <div class="mt-2">{action}</div>}

      {children && <div class="mt-4">{children}</div>}
    </div>
  );
}
