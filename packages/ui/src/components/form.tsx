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

export function Label({
  className,
  ...rest
}: LabelHTMLAttributes<HTMLLabelElement>): ReactElement {
  return (
    <label
      className={clsx('block text-text-muted text-xs', className)}
      {...rest}
    />
  );
}

const inputBase =
  'w-full px-2.5 py-1.5 rounded-[5px] bg-bg border border-border text-text-bright text-sm placeholder:text-text-faint focus:border-accent focus:outline-none transition-colors disabled:opacity-50';

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
