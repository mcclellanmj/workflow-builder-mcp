import type { ComponentChildren, JSX, VNode } from "preact";

export type TaskStatusVariant =
  | "open"
  | "in_progress"
  | "claimed"
  | "review"
  | "closed"
  | "blocked"
  | "neutral";

export type TaskPriorityVariant = "critical" | "high" | "medium" | "low";

export type BadgeVariant = TaskStatusVariant | TaskPriorityVariant | "role";

export type BadgeSize = "sm" | "md";

export interface BadgeProps extends Omit<JSX.HTMLAttributes<HTMLSpanElement>, "role"> {
  variant?: BadgeVariant;
  status?: string;
  priority?: string;
  role?: string;
  size?: BadgeSize;
  pill?: boolean;
  children?: ComponentChildren;
  class?: string;
  className?: string;
}

const VARIANT_CLASSES: Record<string, string> = {
  // Task statuses
  open: "bg-sky-950/60 text-sky-400 border border-sky-800/60",
  in_progress: "bg-amber-950/60 text-amber-400 border border-amber-800/60",
  claimed: "bg-amber-950/60 text-amber-400 border border-amber-800/60",
  review: "bg-purple-950/60 text-purple-400 border border-purple-800/60",
  closed: "bg-emerald-950/60 text-emerald-400 border border-emerald-800/60",
  blocked: "bg-rose-950/60 text-rose-400 border border-rose-800/60",
  neutral: "bg-slate-800 text-slate-300 border border-slate-700",

  // Priorities
  critical: "bg-red-950/80 text-red-300 border border-red-700/80 font-semibold",
  high: "bg-orange-950/60 text-orange-400 border border-orange-800/60 font-medium",
  medium: "bg-yellow-950/60 text-yellow-400 border border-yellow-800/60",
  low: "bg-slate-800/80 text-slate-400 border border-slate-700",

  // Role tag
  role: "bg-indigo-950/70 text-indigo-300 border border-indigo-800/70 font-mono",
};

const SIZE_CLASSES: Record<BadgeSize, string> = {
  sm: "px-2 py-0.5 text-xs",
  md: "px-2.5 py-1 text-xs",
};

function resolveVariant(
  variantProp?: BadgeVariant,
  status?: string,
  priority?: string,
  role?: string,
): string {
  if (variantProp) return variantProp;
  if (role) return "role";
  if (priority && priority in VARIANT_CLASSES) return priority;
  if (status && status in VARIANT_CLASSES) return status;
  if (status === "wontfix") return "neutral";
  return "neutral";
}

/**
 * Atomic Badge component supporting task statuses, priority pills, and role tags.
 */
export function Badge({
  variant,
  status,
  priority,
  role,
  size = "sm",
  pill = true,
  children,
  class: classProp,
  className,
  ...props
}: BadgeProps): VNode {
  const resolved = resolveVariant(variant, status, priority, role);
  const colorClasses = VARIANT_CLASSES[resolved] ?? VARIANT_CLASSES.neutral;
  const roundedClass = pill ? "rounded-full" : "rounded";
  const customClass = classProp || className || "";

  const baseClasses =
    "inline-flex items-center gap-1 font-medium tracking-wide uppercase select-none";
  const combinedClasses = `${baseClasses} ${colorClasses} ${
    SIZE_CLASSES[size]
  } ${roundedClass} ${customClass}`.trim();

  // Determine display label if no children provided
  let content = children;
  if (content === undefined || content === null) {
    if (role) {
      content = `@${role}`;
    } else if (priority) {
      content = priority;
    } else if (status) {
      content = status.replace(/_/g, " ");
    }
  }

  return (
    <span class={combinedClasses} {...props}>
      {content}
    </span>
  );
}
