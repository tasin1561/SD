'use client';

import { clsx } from 'clsx';
import { CircleAlert, CircleCheck, TriangleAlert } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ForwardedRef,
  type MutableRefObject,
  type ReactElement,
  type ReactNode,
} from 'react';
import './text-field.css';

/**
 * The shared shell under every text-like field (text, text area, phone,
 * select, date, password, combobox). One look, one set of ids, so the
 * floating label, the notch, the icon chip, the helper line and the counter
 * behave identically wherever a value is typed.
 *
 * The label is NOTCHED into the border: floated, it sits centred on the top
 * edge with a two-tone background (transparent above the line, the input
 * surface below) so the border breaks behind it without a <fieldset>.
 */
export type FieldStatus = 'valid' | 'invalid';

/** The message props every field takes, named as the legacy `FormField`. */
export interface FieldMessages {
  /** The field's name, floated into the border once it holds a value. */
  readonly label?: ReactNode;
  /** Guidance under the field. */
  readonly hint?: ReactNode;
  /** Alias of `hint`. */
  readonly help?: ReactNode;
  /** A warning that is not a refusal ("we may not deliver to this PIN"). */
  readonly notice?: ReactNode;
  /** The refusal. Sets `aria-invalid` and is announced. */
  readonly error?: ReactNode;
  /** The leading icon, drawn in a chip. */
  readonly icon?: ReactNode;
}

export function hasContent(node: ReactNode): boolean {
  return node !== undefined && node !== null && node !== false && node !== '';
}

/** The ids a field's messages carry, and the `aria-describedby` they make. */
export function fieldIds(id: string): {
  readonly hint: string;
  readonly notice: string;
  readonly error: string;
  readonly count: string;
} {
  return { hint: `${id}-hint`, notice: `${id}-notice`, error: `${id}-error`, count: `${id}-count` };
}

export function describedBy(
  id: string,
  parts: {
    readonly hint?: ReactNode;
    readonly notice?: ReactNode;
    readonly error?: ReactNode;
    readonly counter?: boolean;
    readonly extra?: string | undefined;
  },
): string | undefined {
  const ids = fieldIds(id);
  const list = [
    hasContent(parts.error) ? ids.error : null,
    hasContent(parts.notice) ? ids.notice : null,
    hasContent(parts.hint) ? ids.hint : null,
    parts.counter === true ? ids.count : null,
    parts.extra ?? null,
  ].filter((x): x is string => x !== null && x !== '');
  return list.length > 0 ? list.join(' ') : undefined;
}

function toText(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (Array.isArray(v)) return v.join(',');
  return String(v);
}

/**
 * The field's current text, for the counter, the floated label and the
 * password criteria. Controlled when `value` is given, else tracked from
 * the change events — and re-read from the element after mount, so a
 * browser autofill or a restored form still floats the label.
 */
export function useFieldText<T extends HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
  value: unknown,
  defaultValue: unknown,
  node: MutableRefObject<T | null>,
): { readonly text: string; readonly track: (next: string) => void } {
  const controlled = value !== undefined;
  const [own, setOwn] = useState<string>(() => toText(defaultValue));
  useEffect(() => {
    if (controlled) return;
    const el = node.current;
    if (el && el.value !== own) setOwn(el.value);
    // Mount only: afterwards the change events keep it.
  }, []);
  const track = useCallback(
    (next: string): void => {
      if (!controlled) setOwn(next);
    },
    [controlled],
  );
  return { text: controlled ? toText(value) : own, track };
}

/** One ref for the component, forwarded to the caller as well. */
export function useMergedRef<T>(
  forwarded: ForwardedRef<T>,
): readonly [MutableRefObject<T | null>, (el: T | null) => void] {
  const inner = useRef<T | null>(null);
  const setRef = useCallback(
    (el: T | null): void => {
      inner.current = el;
      if (typeof forwarded === 'function') forwarded(el);
      else if (forwarded) forwarded.current = el;
    },
    [forwarded],
  );
  return [inner, setRef] as const;
}

export interface FieldShellProps extends FieldMessages {
  readonly id: string;
  readonly required?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  /** Keep the label floated (a placeholder, a select, a date, a prefix). */
  readonly float: boolean;
  readonly status?: FieldStatus | undefined;
  readonly counter?: { readonly count: number; readonly max: number } | undefined;
  /** Before the control, after the icon chip (the phone prefix). */
  readonly lead?: ReactNode;
  /** After the control (the password toggle, a chevron). */
  readonly trail?: ReactNode;
  /** Under the helper line (the password meter). */
  readonly after?: ReactNode;
  readonly multiline?: boolean | undefined;
  /** An extra class on the root, for a variant's own CSS. */
  readonly variant?: string | undefined;
  readonly className?: string | undefined;
  readonly children: ReactNode;
}

export function FieldShell({
  id,
  label,
  hint,
  help,
  notice,
  error,
  icon,
  required,
  disabled,
  float,
  status,
  counter,
  lead,
  trail,
  after,
  multiline,
  variant,
  className,
  children,
}: FieldShellProps): ReactElement {
  const ids = fieldIds(id);
  const guidance = hint ?? help;
  const invalid = hasContent(error) || status === 'invalid';
  const near = counter !== undefined && counter.max > 0 && counter.count >= counter.max * 0.9;
  // Only a display-only counter can go over; it says so, it does not block.
  const over = counter !== undefined && counter.count > counter.max;
  return (
    <div
      className={clsx('sk-field', variant, className)}
      data-float={float || undefined}
      data-invalid={invalid || undefined}
      data-disabled={disabled === true || undefined}
      data-multiline={multiline === true || undefined}
      data-icon={hasContent(icon) || undefined}
      data-status={status}
    >
      <div className="sk-field__control">
        {hasContent(icon) ? (
          <span className="sk-field__icon" aria-hidden>
            {icon}
          </span>
        ) : null}
        {lead}
        {children}
        {hasContent(label) ? (
          <label className="sk-field__label" htmlFor={id}>
            <span className="sk-field__label-text">
              {label}
              {required === true ? (
                <span className="sk-field__req" aria-hidden>
                  *
                </span>
              ) : null}
            </span>
          </label>
        ) : null}
        {status === 'valid' ? (
          <span className="sk-field__status" data-kind="valid" aria-hidden>
            <CircleCheck size={18} />
          </span>
        ) : status === 'invalid' ? (
          <span className="sk-field__status" data-kind="invalid" aria-hidden>
            <CircleAlert size={18} />
          </span>
        ) : null}
        {trail}
      </div>
      {hasContent(error) || hasContent(notice) || hasContent(guidance) || counter !== undefined ? (
        <div className="sk-field__foot">
          <div className="sk-field__msgs" aria-live="polite">
            {hasContent(error) ? (
              <p className="sk-field__msg" data-kind="error" id={ids.error}>
                <CircleAlert size={14} aria-hidden />
                <span>{error}</span>
              </p>
            ) : null}
            {hasContent(notice) ? (
              <p className="sk-field__msg" data-kind="notice" id={ids.notice}>
                <TriangleAlert size={14} aria-hidden />
                <span>{notice}</span>
              </p>
            ) : null}
            {hasContent(guidance) ? (
              <p className="sk-field__msg" data-kind="hint" id={ids.hint}>
                {guidance}
              </p>
            ) : null}
          </div>
          {counter !== undefined ? (
            <span
              className="sk-field__count sk-figure"
              id={ids.count}
              data-near={near || undefined}
              data-over={over || undefined}
            >
              <span aria-hidden>
                {counter.count.toLocaleString('en-IN')} / {counter.max.toLocaleString('en-IN')}
              </span>
              <span className="sk-field__sr">
                {counter.count} of {counter.max} characters
              </span>
            </span>
          ) : null}
        </div>
      ) : null}
      {after}
    </div>
  );
}
