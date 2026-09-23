'use client';

import { clsx } from 'clsx';
import { Check, CircleAlert } from 'lucide-react';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ClipboardEvent,
  type CSSProperties,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { reducedMotion } from '../motion/motion';
import './segmented-code.css';

/**
 * SegmentedCode (storytelling 10, link-and-merge). One box per character:
 * typing advances, Backspace steps back, a paste fills every box, and the
 * boxes form ONE labelled group. `onChange` reports the joined value on
 * every edit and `onComplete` once every box is filled; with `name`, a
 * hidden input carries the value into a form.
 *
 * `status` is the CALLER's verdict on the real check, never guessed here:
 *   success  the boxes link, turn green and merge into a check with
 *            `successText`
 *   error    the row shakes and takes the danger tint; `errorText` shows
 *            with its icon
 * Reduced motion jumps straight to the end state. Typing again reports the
 * new value — the caller should set `status` back to `idle`.
 *
 * Focus is never taken on mount unless `autoFocus` is passed.
 */
export type SegmentedCodeStatus = 'idle' | 'success' | 'error';

export interface SegmentedCodeProps {
  readonly length: number;
  /** The group's accessible name, also shown above the boxes. */
  readonly label: string;
  readonly hideLabel?: boolean | undefined;
  readonly value?: string | undefined;
  readonly defaultValue?: string | undefined;
  readonly onChange?: ((value: string) => void) | undefined;
  readonly onComplete?: ((value: string) => void) | undefined;
  /** Digits only (default) or letters and digits. */
  readonly charset?: 'numeric' | 'alphanumeric' | undefined;
  readonly status?: SegmentedCodeStatus | undefined;
  readonly successText?: ReactNode;
  readonly errorText?: ReactNode;
  readonly hint?: ReactNode;
  readonly name?: string | undefined;
  readonly autoFocus?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  readonly autoComplete?: string | undefined;
  readonly className?: string | undefined;
  readonly id?: string | undefined;
}

function clean(raw: string, charset: 'numeric' | 'alphanumeric'): string {
  return charset === 'numeric'
    ? raw.replace(/\D/g, '')
    : raw.replace(/[^0-9a-z]/gi, '').toUpperCase();
}

export function SegmentedCode({
  length,
  label,
  hideLabel = false,
  value,
  defaultValue,
  onChange,
  onComplete,
  charset = 'numeric',
  status = 'idle',
  successText = 'Verified',
  errorText,
  hint,
  name,
  autoFocus = false,
  disabled = false,
  autoComplete = 'one-time-code',
  className,
  id: idProp,
}: SegmentedCodeProps): ReactElement {
  const autoId = useId();
  const id = idProp ?? `sk-sc-${autoId}`;
  const [own, setOwn] = useState(() => clean(defaultValue ?? '', charset).slice(0, length));
  const code = value !== undefined ? clean(value, charset).slice(0, length) : own;
  const chars = Array.from({ length }, (_, i) => code[i] ?? '');
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const [instant, setInstant] = useState(false);

  useEffect(() => {
    if (status !== 'idle') setInstant(reducedMotion());
  }, [status]);

  function commit(next: string): void {
    const v = next.slice(0, length);
    if (value === undefined) setOwn(v);
    onChange?.(v);
    if (v.length === length) onComplete?.(v);
  }

  function setAt(i: number, ch: string): void {
    const arr = chars.slice();
    arr[i] = ch;
    // Keep the value contiguous: a box after an empty one cannot hold a char.
    const firstGap = arr.indexOf('');
    const joined = (firstGap < 0 ? arr : arr.slice(0, firstGap)).join('');
    commit(joined);
    if (ch !== '') refs.current[Math.min(joined.length, length - 1)]?.focus();
  }

  function keyDown(i: number, e: KeyboardEvent<HTMLInputElement>): void {
    const k = e.key;
    const accepted = charset === 'numeric' ? /^\d$/.test(k) : /^[0-9a-z]$/i.test(k);
    if (accepted && !e.metaKey && !e.ctrlKey && !e.altKey) {
      // Handled here, not in onChange: typing the character a box already
      // holds fires no change event, so the caret would never advance.
      e.preventDefault();
      setAt(Math.min(i, code.length), clean(k, charset));
      return;
    }
    if (k === 'Backspace') {
      e.preventDefault();
      if (chars[i] !== '') {
        commit(code.slice(0, i));
        refs.current[i]?.focus();
      } else if (i > 0) {
        commit(code.slice(0, i - 1));
        refs.current[i - 1]?.focus();
      }
    } else if (k === 'ArrowLeft' && i > 0) {
      e.preventDefault();
      refs.current[i - 1]?.focus();
    } else if (k === 'ArrowRight' && i < length - 1) {
      e.preventDefault();
      refs.current[Math.min(i + 1, code.length)]?.focus();
    }
  }

  function paste(e: ClipboardEvent<HTMLInputElement>): void {
    const text = clean(e.clipboardData.getData('text'), charset).slice(0, length);
    if (text === '') return;
    e.preventDefault();
    commit(text);
    refs.current[Math.min(text.length, length - 1)]?.focus();
  }

  const mid = (length - 1) / 2;
  const hasHint = hint !== undefined && hint !== null && hint !== false && hint !== '';
  const labelId = `${id}-label`;

  return (
    <div
      className={clsx('sk-seg', className)}
      data-status={status}
      data-instant={instant || undefined}
      style={{ '--seg-n': length } as CSSProperties}
    >
      <span className={clsx('sk-seg__label', hideLabel && 'sk-seg__sr')} id={labelId}>
        {label}
      </span>
      <div
        className="sk-seg__row"
        role="group"
        aria-labelledby={labelId}
        aria-describedby={hasHint ? `${id}-hint` : undefined}
      >
        {chars.map((c, i) => (
          <input
            key={i}
            ref={(el) => {
              refs.current[i] = el;
            }}
            id={i === 0 ? id : undefined}
            className="sk-seg__box"
            style={{ '--off': (mid - i).toFixed(2), '--i': i } as CSSProperties}
            type="text"
            inputMode={charset === 'numeric' ? 'numeric' : 'text'}
            pattern={charset === 'numeric' ? '[0-9]*' : undefined}
            autoComplete={i === 0 ? autoComplete : 'off'}
            autoCapitalize={charset === 'numeric' ? undefined : 'characters'}
            maxLength={i === 0 ? length : 1}
            value={c}
            disabled={disabled}
            autoFocus={i === 0 && autoFocus}
            data-filled={c !== '' || undefined}
            aria-label={`Character ${i + 1} of ${length}`}
            aria-invalid={status === 'error' || undefined}
            onChange={(e) => {
              // A mobile keyboard or an autofill may still deliver through
              // change; a whole code arriving in one box is treated as a paste.
              const got = clean(e.target.value, charset);
              if (got.length > 1) commit(got);
              else setAt(Math.min(i, code.length), got);
            }}
            onKeyDown={(e) => keyDown(i, e)}
            onPaste={paste}
            onFocus={(e) => e.target.select()}
          />
        ))}
        {chars.slice(1).map((_, i) => (
          <span
            key={`l${i}`}
            className="sk-seg__link"
            aria-hidden
            style={{ '--i': i, '--at': i + 1 } as CSSProperties}
          />
        ))}
        <span className="sk-seg__done" aria-hidden>
          <span className="sk-seg__done-icon">
            <Check size={18} strokeWidth={3} />
          </span>
          {successText}
        </span>
      </div>
      <p className="sk-seg__verdict" role="status">
        {status === 'success' ? <span className="sk-seg__sr">{successText}</span> : null}
        {status === 'error' && errorText !== undefined && errorText !== null ? (
          <>
            <CircleAlert size={14} aria-hidden />
            <span>{errorText}</span>
          </>
        ) : null}
      </p>
      {hasHint ? (
        <p className="sk-seg__hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
      {name !== undefined ? <input type="hidden" name={name} value={code} /> : null}
    </div>
  );
}
