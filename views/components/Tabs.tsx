import type { ComponentChildren, VNode } from "preact";

export interface TabItem {
  id: string;
  label: string;
  count?: number | string;
  icon?: ComponentChildren;
  href?: string;
  disabled?: boolean;
}

export interface TabsProps {
  tabs: TabItem[];
  activeTab?: string;
  onTabChange?: (id: string) => void;
  ariaLabel?: string;
  class?: string;
  className?: string;
}

/**
 * Tab navigation strip for switching between views (e.g. Tasks, Memory, Journals).
 */
export function Tabs({
  tabs,
  activeTab,
  onTabChange,
  ariaLabel = "Navigation Tabs",
  class: classProp,
  className,
}: TabsProps): VNode {
  const customClass = classProp || className || "";

  return (
    <nav
      class={`flex space-x-2 border-b border-gray-800 overflow-x-auto ${customClass}`.trim()}
      aria-label={ariaLabel}
    >
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        const baseClasses =
          "group inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors duration-150 select-none whitespace-nowrap focus:outline-none";
        const stateClasses = isActive
          ? "border-blue-500 text-blue-400 font-semibold"
          : tab.disabled
          ? "border-transparent text-gray-600 cursor-not-allowed opacity-50"
          : "border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-600";

        const content = (
          <>
            {tab.icon && (
              <span
                class={`w-4 h-4 flex items-center justify-center ${
                  isActive ? "text-blue-400" : "text-gray-500 group-hover:text-gray-300"
                }`}
              >
                {tab.icon}
              </span>
            )}
            <span>{tab.label}</span>
            {tab.count !== undefined && (
              <span
                class={`ml-1 px-1.5 py-0.5 rounded-full text-xs ${
                  isActive
                    ? "bg-blue-950/80 text-blue-300 border border-blue-800/60"
                    : "bg-gray-800 text-gray-400 group-hover:bg-gray-750"
                }`}
              >
                {tab.count}
              </span>
            )}
          </>
        );

        if (tab.href) {
          return (
            <a
              key={tab.id}
              href={tab.href}
              class={`${baseClasses} ${stateClasses}`}
              aria-current={isActive ? "page" : undefined}
            >
              {content}
            </a>
          );
        }

        return (
          <button
            key={tab.id}
            type="button"
            disabled={tab.disabled}
            onClick={() => onTabChange?.(tab.id)}
            class={`${baseClasses} ${stateClasses}`}
            aria-current={isActive ? "true" : undefined}
          >
            {content}
          </button>
        );
      })}
    </nav>
  );
}
