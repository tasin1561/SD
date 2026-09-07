'use client';

/*
  A CLIENT module now, and it has to be.
  
  These carry a disclosure with `useState` behind it, and a hook in a
  module a server component imports does not fail at the hook — it fails
  at the import, because what a server component receives from a client
  module is a client REFERENCE rather than the function. The same trap
  the theme init script documents. Marking the module is what puts the
  boundary in the right place; without it any page that is still a
  server component breaks at build, and the ones that are already
  `'use client'` would go on working, so the failure would look random.
*/
import { clsx } from 'clsx';
import { helpSubject, useHelpDisclosure } from './help-disclosure';
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

/**
 * A labelled control.
 *
 * THREE kinds of text can sit under it and they are not the same thing:
 *
 *   `error`  — always shown. The submit was refused.
 *   `notice` — always shown. Something the reader did not ask about and
 *              needs anyway: "we may not deliver to this PIN". A warning
 *              folded behind a click is read after the mistake.
 *   `hint`   — folded behind the (i) beside the label. Guidance for
 *              somebody who is unsure, which is most useful the first
 *              few times and is clutter for ever after.
 *
 * The hint stays reachable even when there is an error — it used to be
 * replaced by one, and the hint is often exactly what explains the
 * refusal. It is collapsed anyway, so it costs no space.
 */
export function FormField({
  label,
  htmlFor,
  hint,
  notice,
  error,
  required,
  children,
  className,
}: {
  readonly label?: ReactNode;
  readonly htmlFor?: string;
  readonly hint?: ReactNode;
  /** A warning. Always visible — never fold this behind the (i). */
  readonly notice?: ReactNode;
  readonly error?: ReactNode;
  readonly required?: boolean;
  readonly children: ReactNode;
  readonly className?: string;
}): ReactElement {
  const help = useHelpDisclosure(helpSubject(label, 'this field'), hint);
  return (
    <div className={clsx('space-y-1', className)}>
      {label && (
        // The trigger is a SIBLING of the <label>, never inside it. A
        // <button> is a labelable element, so a label wrapping one
        // starts describing the button instead of the field: clicking
        // the label text would toggle the help rather than focus the
        // input, and every `getByLabelText` in the suite resolved to the
        // (i). Caught by seven admin tests, and it would have reached a
        // screen reader as the field having no name.
        <div className="flex items-center gap-1">
          <Label htmlFor={htmlFor}>
            {label}
            {required && <span className="text-critical ml-0.5">*</span>}
          </Label>
          {help.trigger}
        </div>
      )}
      {children}
      {error ? <div className="text-critical text-xs">{error}</div> : null}
      {notice ? <div className="text-[var(--status-pending-fg)] text-xs">{notice}</div> : null}
      {help.panel ? <div className="text-text-faint pt-0.5 text-xs">{help.panel}</div> : null}
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
