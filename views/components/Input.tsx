import type { JSX, VNode } from "preact";

export interface InputProps extends JSX.HTMLAttributes<HTMLInputElement> {
  label?: string;
  helperText?: string;
  error?: string;
  id?: string;
  name?: string;
  value?: string | number;
  defaultValue?: string | number;
  type?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  class?: string;
  className?: string;
}

export interface SearchInputProps extends Omit<InputProps, "onSearch"> {
  onSearch?: (value: string) => void;
}

export interface TextareaProps extends JSX.HTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  helperText?: string;
  error?: string;
  id?: string;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  required?: boolean;
  class?: string;
  className?: string;
}

const BASE_INPUT_CLASSES =
  "w-full rounded-md bg-gray-900 border text-gray-100 placeholder-gray-500 text-sm px-3 py-2 transition-colors duration-150 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed";

const NORMAL_RING_CLASSES =
  "border-gray-700 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30";

const ERROR_RING_CLASSES =
  "border-red-500 focus:border-red-500 focus:ring-2 focus:ring-red-500/30 text-red-100";

/**
 * Atomic Input component with label, helper, error text, and focus rings.
 */
export function Input({
  label,
  helperText,
  error,
  id,
  type = "text",
  disabled = false,
  required = false,
  class: classProp,
  className,
  ...props
}: InputProps): VNode {
  const customClass = classProp || className || "";
  const ringClasses = error ? ERROR_RING_CLASSES : NORMAL_RING_CLASSES;
  const inputClasses = `${BASE_INPUT_CLASSES} ${ringClasses} ${customClass}`.trim();

  return (
    <div class="w-full flex flex-col gap-1.5">
      {label && (
        <label htmlFor={id} class="text-xs font-medium text-gray-300 flex items-center gap-1">
          {label}
          {required && <span class="text-red-400">*</span>}
        </label>
      )}
      <input
        id={id}
        type={type}
        disabled={disabled}
        required={required}
        class={inputClasses}
        {...props}
      />
      {error && <p class="text-xs text-red-400 mt-0.5">{error}</p>}
      {!error && helperText && <p class="text-xs text-gray-400 mt-0.5">{helperText}</p>}
    </div>
  );
}

/**
 * Search Input with magnifying glass icon.
 */
export function SearchInput({
  label,
  helperText,
  error,
  id,
  disabled = false,
  class: classProp,
  className,
  onSearch,
  onInput,
  ...props
}: SearchInputProps): VNode {
  const customClass = classProp || className || "";
  const ringClasses = error ? ERROR_RING_CLASSES : NORMAL_RING_CLASSES;
  const inputClasses = `${BASE_INPUT_CLASSES} pl-9 ${ringClasses} ${customClass}`.trim();

  const handleInput: JSX.GenericEventHandler<HTMLInputElement> = (e) => {
    if (onSearch) {
      onSearch((e.currentTarget as HTMLInputElement).value);
    }
    if (onInput) {
      // deno-lint-ignore no-explicit-any
      (onInput as any)(e);
    }
  };

  return (
    <div class="w-full flex flex-col gap-1.5">
      {label && (
        <label htmlFor={id} class="text-xs font-medium text-gray-300">
          {label}
        </label>
      )}
      <div class="relative flex items-center">
        <span class="absolute left-3 pointer-events-none text-gray-400" aria-hidden="true">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </span>
        <input
          id={id}
          type="search"
          disabled={disabled}
          class={inputClasses}
          onInput={handleInput}
          {...props}
        />
      </div>
      {error && <p class="text-xs text-red-400 mt-0.5">{error}</p>}
      {!error && helperText && <p class="text-xs text-gray-400 mt-0.5">{helperText}</p>}
    </div>
  );
}

/**
 * Atomic Textarea component with label, helper, error text, and focus rings.
 */
export function Textarea({
  label,
  helperText,
  error,
  id,
  rows = 3,
  disabled = false,
  required = false,
  class: classProp,
  className,
  ...props
}: TextareaProps): VNode {
  const customClass = classProp || className || "";
  const ringClasses = error ? ERROR_RING_CLASSES : NORMAL_RING_CLASSES;
  const textareaClasses =
    `${BASE_INPUT_CLASSES} resize-y min-h-[5rem] ${ringClasses} ${customClass}`.trim();

  return (
    <div class="w-full flex flex-col gap-1.5">
      {label && (
        <label htmlFor={id} class="text-xs font-medium text-gray-300 flex items-center gap-1">
          {label}
          {required && <span class="text-red-400">*</span>}
        </label>
      )}
      <textarea
        id={id}
        rows={rows}
        disabled={disabled}
        required={required}
        class={textareaClasses}
        {...props}
      />
      {error && <p class="text-xs text-red-400 mt-0.5">{error}</p>}
      {!error && helperText && <p class="text-xs text-gray-400 mt-0.5">{helperText}</p>}
    </div>
  );
}
