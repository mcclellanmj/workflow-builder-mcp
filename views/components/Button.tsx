import type { ComponentChildren, JSX, VNode } from "preact";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends JSX.HTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  type?: "button" | "submit" | "reset";
  disabled?: boolean;
  children?: ComponentChildren;
  class?: string;
  className?: string;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-medium shadow-sm focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-900 border border-transparent",
  secondary:
    "bg-gray-800 hover:bg-gray-700 active:bg-gray-600 text-gray-200 font-medium border border-gray-600 focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 focus:ring-offset-gray-900 shadow-sm",
  danger:
    "bg-red-600 hover:bg-red-700 active:bg-red-800 text-white font-medium shadow-sm focus:ring-2 focus:ring-red-500 focus:ring-offset-2 focus:ring-offset-gray-900 border border-transparent",
  ghost:
    "bg-transparent hover:bg-gray-800 active:bg-gray-700 text-gray-300 hover:text-white font-medium border border-transparent focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 focus:ring-offset-gray-900",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "px-2.5 py-1 text-xs rounded",
  md: "px-3.5 py-2 text-sm rounded-md gap-1.5",
  lg: "px-5 py-2.5 text-base rounded-lg gap-2",
};

/**
 * Atomic Button component supporting primary, secondary, danger, and ghost variants.
 */
export function Button({
  variant = "primary",
  size = "md",
  type = "button",
  disabled = false,
  class: classProp,
  className,
  children,
  ...props
}: ButtonProps): VNode {
  const baseClasses =
    "inline-flex items-center justify-center transition-colors duration-150 focus:outline-none select-none disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none";
  const customClass = classProp || className || "";
  const combinedClasses = `${baseClasses} ${VARIANT_CLASSES[variant]} ${
    SIZE_CLASSES[size]
  } ${customClass}`.trim();

  return (
    <button
      type={type}
      disabled={disabled}
      class={combinedClasses}
      {...props}
    >
      {children}
    </button>
  );
}
