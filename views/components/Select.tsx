import type { ComponentChildren, JSX, VNode } from "preact";

export interface SelectOption {
  value: string | number;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends JSX.HTMLAttributes<HTMLSelectElement> {
  label?: string;
  helperText?: string;
  error?: string;
  options?: SelectOption[];
  id?: string;
  value?: string | number;
  disabled?: boolean;
  required?: boolean;
  children?: ComponentChildren;
  class?: string;
  className?: string;
}

const BASE_SELECT_CLASSES =
  "w-full appearance-none rounded-md bg-gray-900 border text-gray-100 text-sm pl-3 pr-10 py-2 transition-colors duration-150 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed";

const NORMAL_RING_CLASSES =
  "border-gray-700 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30";

const ERROR_RING_CLASSES =
  "border-red-500 focus:border-red-500 focus:ring-2 focus:ring-red-500/30 text-red-100";

/**
 * Atomic Select dropdown component with options array or children, label, and focus rings.
 */
export function Select({
  label,
  helperText,
  error,
  options,
  id,
  value,
  disabled = false,
  required = false,
  children,
  class: classProp,
  className,
  ...props
}: SelectProps): VNode {
  const customClass = classProp || className || "";
  const ringClasses = error ? ERROR_RING_CLASSES : NORMAL_RING_CLASSES;
  const selectClasses = `${BASE_SELECT_CLASSES} ${ringClasses} ${customClass}`.trim();

  return (
    <div class="w-full flex flex-col gap-1.5">
      {label && (
        <label htmlFor={id} class="text-xs font-medium text-gray-300 flex items-center gap-1">
          {label}
          {required && <span class="text-red-400">*</span>}
        </label>
      )}
      <div class="relative flex items-center">
        <select
          id={id}
          value={value}
          disabled={disabled}
          required={required}
          class={selectClasses}
          {...props}
        >
          {options
            ? options.map((opt) => (
              <option key={opt.value} value={opt.value} disabled={opt.disabled}>
                {opt.label}
              </option>
            ))
            : children}
        </select>
        <span class="absolute right-3 pointer-events-none text-gray-400" aria-hidden="true">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </span>
      </div>
      {error && <p class="text-xs text-red-400 mt-0.5">{error}</p>}
      {!error && helperText && <p class="text-xs text-gray-400 mt-0.5">{helperText}</p>}
    </div>
  );
}
