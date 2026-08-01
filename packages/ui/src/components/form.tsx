import { clsx } from 'clsx';
import {
  forwardRef,
  type InputHTMLAttributes,
  type LabelHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

/**
 * Minimal form primitives styled with tokens. Label + Input + Textarea
 * + Select + FieldError + FieldHint. The form layout (vertical stack
 * / spacing / wrapping) is the consumer's; these are atoms.
 */

export function FormField({
  label,
  htmlFor,
  hint,
  error,
  required,
  children,
  className,
}: {
  readonly label?: ReactNode;
  readonly htmlFor?: string;
  readonly hint?: ReactNode;
  readonly error?: ReactNode;
  readonly required?: boolean;
  readonly children: ReactNode;
  readonly className?: string;
}): ReactElement {
  return (
    <div className={clsx('space-y-1', className)}>
      {label && (
        <Label htmlFor={htmlFor}>
          {label}
          {required && <span className="text-critical ml-0.5">*</span>}
        </Label>
      )}
      {children}
      {error ? (
        <div className="text-critical text-xs">{error}</div>
      ) : hint ? (
        <div className="text-text-faint text-xs">{hint}</div>
      ) : null}
    </div>
  );
}

export function Label({ className, ...rest }: LabelHTMLAttributes<HTMLLabelElement>): ReactElement {
  return <label className={clsx('block text-text-muted text-xs', className)} {...rest} />;
}

/**
 * `sd-field` is the hook for two mobile rules that live in tokens.css
 * and cannot be expressed per-call-site:
 *
 *   1. The width DEFAULT (full width), declared in Tailwind's `base`
 *      layer so a call site's own `w-80` / `w-[220px]` — a utility, and
 *      utilities beat base — actually wins. It used to be a literal
 *      `w-full` here, which is also a utility: two utilities, and the
 *      winner is decided by Tailwind's generated source order rather
 *      than by which one the author wrote at the call site. In practice
 *      `w-full` won for `<select>`, so every filter dropdown stretched
 *      the full row on desktop while the search box beside it kept its
 *      intended width.
 *
 *      Below `sm` the rule flips to `!important` full width regardless:
 *      those pinned desktop numbers produce a ragged column of
 *      mismatched fields on a phone, and any number wider than the
 *      viewport overflows the page.
 *
 *   2. 16px text on touch devices. Mobile Safari ZOOMS THE PAGE when
 *      you focus an input whose font-size is under 16px, and does not
 *      zoom back out — the 13px `text-sm` here is exactly the trigger.
 *
 * `min-h-[38px]` is the touch-target floor; py-1.5 alone gave a 30px
 * control.
 */
const inputBase =
  'sd-field min-h-[38px] px-2.5 py-1.5 rounded-[5px] bg-bg border border-border text-text-bright text-sm placeholder:text-text-faint focus:border-accent focus:outline-none transition-colors disabled:opacity-50';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref): ReactElement {
    return <input ref={ref} className={clsx(inputBase, className)} {...rest} />;
  },
);

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, rows = 3, ...rest }, ref): ReactElement {
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={clsx(inputBase, 'leading-snug resize-y', className)}
      {...rest}
    />
  );
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...rest }, ref): ReactElement {
    return (
      <select ref={ref} className={clsx(inputBase, 'pr-7', className)} {...rest}>
        {children}
      </select>
    );
  },
);

export function FormActions({ children }: { children: ReactNode }): ReactElement {
  return <div className="flex items-center justify-end gap-2 pt-2">{children}</div>;
}
