import type { ComponentChildren, VNode } from "preact";
import { Button, type ButtonVariant } from "../components/Button.tsx";

export type ErrorCardVariant = "expired" | "unauthorized" | "error" | "warning";

export interface ErrorCardProps {
  /** Variant of the error card which sets default icon, color accents, and messaging */
  variant?: ErrorCardVariant;
  /** Card title / headline (defaults to variant-specific headline if not provided) */
  title?: string;
  /** Card description message (defaults to variant-specific description) */
  description?: string;
  /** Custom icon to override default variant icon */
  icon?: ComponentChildren;
  /** URL for the return or action button (defaults to "/") */
  actionHref?: string;
  /** Text label for the action button */
  actionText?: string;
  /** Optional click handler for the action button */
  onActionClick?: () => void;
  /** Button style variant */
  buttonVariant?: ButtonVariant;
  /** Additional custom content to render inside the card */
  children?: ComponentChildren;
  /** Additional CSS classes for outer container */
  class?: string;
  className?: string;
}

interface VariantConfig {
  defaultTitle: string;
  defaultDescription: string;
  defaultActionText: string;
  accentColor: string;
  iconBg: string;
  iconBorder: string;
  iconColor: string;
  buttonVariant: ButtonVariant;
}

const VARIANT_CONFIGS: Record<ErrorCardVariant, VariantConfig> = {
  expired: {
    defaultTitle: "Share Link Expired",
    defaultDescription:
      "This visualization link has reached its expiration time and is no longer active. To view this workflow, please request a new share link or run the workflow_visualize tool again.",
    defaultActionText: "Go to Dashboard",
    accentColor: "text-red-400",
    iconBg: "bg-red-950/60",
    iconBorder: "border-red-800/80",
    iconColor: "text-red-400",
    buttonVariant: "primary",
  },
  unauthorized: {
    defaultTitle: "Access Restricted",
    defaultDescription:
      "Viewing this workflow requires a valid share ticket, active Passkey login session, or Bearer token.",
    defaultActionText: "Sign In with Passkey",
    accentColor: "text-amber-400",
    iconBg: "bg-amber-950/60",
    iconBorder: "border-amber-800/80",
    iconColor: "text-amber-400",
    buttonVariant: "primary",
  },
  error: {
    defaultTitle: "Workflow Error",
    defaultDescription:
      "An unexpected error occurred while attempting to retrieve or visualize this workflow. Please verify the workflow ID and your permissions.",
    defaultActionText: "Return to Dashboard",
    accentColor: "text-rose-400",
    iconBg: "bg-rose-950/60",
    iconBorder: "border-rose-800/80",
    iconColor: "text-rose-400",
    buttonVariant: "danger",
  },
  warning: {
    defaultTitle: "Notice",
    defaultDescription:
      "This resource is unavailable or has restricted access under the current session.",
    defaultActionText: "Go to Dashboard",
    accentColor: "text-yellow-400",
    iconBg: "bg-yellow-950/60",
    iconBorder: "border-yellow-800/80",
    iconColor: "text-yellow-400",
    buttonVariant: "secondary",
  },
};

function renderDefaultIcon(variant: ErrorCardVariant): VNode {
  switch (variant) {
    case "expired":
      return (
        <svg
          class="w-7 h-7"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.75"
            d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      );
    case "unauthorized":
      return (
        <svg
          class="w-7 h-7"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.75"
            d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
          />
        </svg>
      );
    case "error":
      return (
        <svg
          class="w-7 h-7"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.75"
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
      );
    case "warning":
      return (
        <svg
          class="w-7 h-7"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.75"
            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      );
  }
}

/**
 * Reusable error, unauthorized, and expired ticket card Preact component.
 * Uses Tailwind CSS consistent with BaseLayout and atomic components.
 */
export function ErrorCard({
  variant = "error",
  title,
  description,
  icon,
  actionHref = "/",
  actionText,
  onActionClick,
  buttonVariant,
  children,
  class: classProp,
  className,
}: ErrorCardProps): VNode {
  const config = VARIANT_CONFIGS[variant];
  const headline = title ?? config.defaultTitle;
  const desc = description ?? config.defaultDescription;
  const btnLabel = actionText ?? config.defaultActionText;
  const btnVariant = buttonVariant ?? config.buttonVariant;

  const customClass = classProp || className || "";

  return (
    <div
      class={`flex flex-col items-center justify-center p-6 sm:p-10 min-h-[400px] w-full max-w-lg mx-auto ${customClass}`
        .trim()}
    >
      <div class="w-full bg-gray-900/90 border border-gray-700/80 rounded-2xl p-8 text-center shadow-2xl backdrop-blur-md">
        {/* Status Icon */}
        <div
          class={`mx-auto w-14 h-14 rounded-2xl flex items-center justify-center mb-5 border ${config.iconBg} ${config.iconBorder} ${config.iconColor} shadow-inner`}
        >
          {icon ?? renderDefaultIcon(variant)}
        </div>

        {/* Headline */}
        <h1 class={`text-xl font-bold tracking-tight mb-3 ${config.accentColor}`}>
          {headline}
        </h1>

        {/* Description */}
        <p class="text-sm text-gray-400 leading-relaxed max-w-md mx-auto mb-6">
          {desc}
        </p>

        {/* Optional Children */}
        {children && <div class="mb-6">{children}</div>}

        {/* Action Button */}
        <div class="flex items-center justify-center gap-3">
          {actionHref
            ? (
              <a href={actionHref} class="inline-block no-underline">
                <Button
                  variant={btnVariant}
                  size="md"
                  onClick={onActionClick}
                  class="font-semibold shadow-md"
                >
                  {btnLabel}
                </Button>
              </a>
            )
            : (
              <Button
                variant={btnVariant}
                size="md"
                onClick={onActionClick}
                class="font-semibold shadow-md"
              >
                {btnLabel}
              </Button>
            )}
        </div>
      </div>
    </div>
  );
}
