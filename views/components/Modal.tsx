import type { ComponentChildren, VNode } from "preact";

export type ModalSize = "sm" | "md" | "lg" | "xl" | "2xl";

export interface ModalProps {
  isOpen?: boolean;
  onClose?: () => void;
  title?: ComponentChildren;
  children?: ComponentChildren;
  footer?: ComponentChildren;
  size?: ModalSize;
  id?: string;
  class?: string;
  className?: string;
}

const SIZE_CLASSES: Record<ModalSize, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-xl",
  "2xl": "max-w-2xl",
};

/**
 * Accessible dialog container with backdrop, card container, header, body, and footer.
 */
export function Modal({
  isOpen = false,
  onClose,
  title,
  children,
  footer,
  size = "md",
  id = "modal-dialog",
  class: classProp,
  className,
}: ModalProps): VNode | null {
  if (!isOpen) {
    return null;
  }

  const titleId = `${id}-title`;
  const customClass = classProp || className || "";
  const cardClasses = `relative w-full ${
    SIZE_CLASSES[size]
  } mx-4 bg-gray-900 border border-gray-800 rounded-xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden ${customClass}`
    .trim();

  return (
    <div
      class="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? titleId : undefined}
      id={id}
    >
      <div class={cardClasses} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        {(title || onClose) && (
          <div class="flex items-center justify-between px-6 py-4 border-b border-gray-800 bg-gray-900/50">
            {title
              ? (
                <h2 id={titleId} class="text-base font-semibold text-gray-100">
                  {title}
                </h2>
              )
              : <div />}
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close dialog"
                class="rounded-lg p-1.5 text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-600"
              >
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            )}
          </div>
        )}

        {/* Body */}
        <div class="px-6 py-4 overflow-y-auto flex-1 text-sm text-gray-300">
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div class="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-800 bg-gray-950/40">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
