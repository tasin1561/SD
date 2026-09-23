'use client';

import { clsx } from 'clsx';
import { Check, CircleCheck, LoaderCircle, OctagonX } from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { useAsyncState, type AsyncOutcome } from '../async-button';
import { Button, type ButtonSize, type ButtonVariant } from '../button';
import { ms, reducedMotion } from '../motion/motion';
import './van-drive-off.css';

export type VanDriveOffButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'children' | 'type' | 'aria-label'
> & {
  /** The REAL request, fired on click at t = 0. The van plays only if it resolves. */
  onAction: () => Promise<unknown>;
  /** Idle label — and the accessible name, throughout. */
  label: string;
  busyLabel?: string | undefined;
  /** What the button says once the van has left — "Order created". */
  doneLabel?: string | undefined;
  errorLabel?: string | undefined;
  variant?: ButtonVariant | undefined;
  size?: ButtonSize | undefined;
  fullWidth?: boolean | undefined;
  /** The idle icon; busy / done / error icons are fixed. */
  icon?: ReactNode;
  /** `submit` validates the form (native `reportValidity`) and then runs `onAction`. */
  type?: 'button' | 'submit' | undefined;
  onSettled?: ((outcome: AsyncOutcome<unknown>) => void) | undefined;
};

/** The morph: shrink into the van, drive off. The button is back when it ends. */
const DRIVE_MS = 700;
/** How long "done" / the error rests on the button before idle (from the result). */
const SETTLE_MS = 2000;
/** Reduced motion: how long the pill beside the button stays. */
const PILL_MS = 3000;

/**
 * Van drive-off (storytelling 02) — the BUTTON becomes the van.
 *
 * Click → busy (disabled, `aria-busy`, the busy label rolls in) while the
 * real request runs. On a REAL success only: the pill shrinks to a van's
 * length, the label fades, a van grows out of it and drives off right with
 * speed lines, and the button springs back green with a check and
 * `doneLabel` — enabled again 0.7 s after the result (≤ 1.2 s even on a
 * slow frame), then idle. On error: no van — a shake, red, `errorLabel`.
 *
 * Only this button is busy: no overlay, no focus move. The art is
 * `aria-hidden`, `pointer-events: none` and clipped to the button's own box
 * (a small clip margin), so it can never widen the page. The accessible
 * name stays `label`; results go to a polite live region. Reduced motion:
 * no morph — the button returns at once and a green pill appears beside it.
 */
export function VanDriveOffButton({
  onAction,
  label,
  busyLabel = 'Working…',
  doneLabel = 'Done',
  errorLabel = 'Failed, try again',
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  icon,
  type = 'button',
  onSettled,
  onClick,
  disabled,
  className,
  ...rest
}: VanDriveOffButtonProps): ReactElement {
  const [driving, setDriving] = useState(0);
  const [pill, setPill] = useState(false);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const pending = timers.current; // one array for the life of the button
    return () => {
      for (const t of pending) window.clearTimeout(t);
    };
  }, []);

  const later = (fn: () => void, base: number): void => {
    timers.current.push(window.setTimeout(fn, ms(base)));
  };

  const s = useAsyncState<unknown>({
    minBusyMs: 500,
    settleMs: SETTLE_MS,
    onSettled: (outcome) => {
      if (outcome.ok) {
        if (reducedMotion()) {
          setPill(true);
          later(() => setPill(false), PILL_MS);
        } else {
          setDriving((n) => n + 1);
          later(() => setDriving(0), DRIVE_MS);
        }
      }
      onSettled?.(outcome);
    },
  });

  const phase = s.phase === 'success' && pill ? 'idle' : s.phase;
  const story = driving > 0 ? 'drive' : phase;
  const lead =
    phase === 'busy' ? (
      <LoaderCircle size={16} className="sk-async__spin" />
    ) : phase === 'success' ? (
      <Check size={16} strokeWidth={2.6} />
    ) : phase === 'error' ? (
      <OctagonX size={16} />
    ) : (
      icon
    );
  const announce =
    s.phase === 'busy'
      ? busyLabel
      : s.phase === 'success'
        ? doneLabel
        : s.phase === 'error'
          ? errorLabel
          : '';

  const handleClick = (e: MouseEvent<HTMLButtonElement>): void => {
    onClick?.(e);
    if (e.defaultPrevented) return;
    if (type === 'submit') {
      const form = e.currentTarget.form;
      if (form !== null && !form.reportValidity()) return;
      e.preventDefault();
    }
    void s.run(onAction);
  };

  return (
    <span className={clsx('sk-van', fullWidth && 'sk-van--full', className)}>
      <span className="sk-van__box" data-story={story}>
        <Button
          {...rest}
          type={type}
          variant={variant}
          size={size}
          fullWidth={fullWidth}
          icon={lead}
          className="sk-async sk-van__btn"
          data-phase={driving > 0 ? 'busy' : phase}
          aria-label={label}
          aria-busy={s.phase === 'busy' || undefined}
          disabled={disabled === true || s.phase === 'busy' || driving > 0}
          onClick={handleClick}
        >
          <span className="sk-async__window" aria-hidden>
            <span className="sk-async__strip">
              <span>{label}</span>
              <span>{busyLabel}</span>
              <span>{doneLabel}</span>
              <span>{errorLabel}</span>
            </span>
          </span>
        </Button>
        <span className="sk-van__art" aria-hidden>
          {driving > 0 ? (
            <svg key={driving} className="sk-van__truck" viewBox="0 0 64 32" focusable="false">
              <path className="sk-van__lines" d="M2 13h11M5 18h9M1 23h10" pathLength={1} />
              <path className="sk-van__cargo" d="M16 6h24v18H16z" />
              <path className="sk-van__cab" d="M40 11h9l7 7v6H40z" />
              <path className="sk-van__glass" d="M43 13h5.2l4.3 4.5H43z" />
              <path className="sk-van__mark" d="M22 12h6v6h-6z" />
              <g className="sk-van__wheel">
                <circle cx="24" cy="25" r="4" />
                <path d="M24 22v6" />
              </g>
              <g className="sk-van__wheel">
                <circle cx="48" cy="25" r="4" />
                <path d="M48 22v6" />
              </g>
            </svg>
          ) : null}
        </span>
      </span>
      {pill ? (
        <span className="sk-van__pill" aria-hidden>
          <CircleCheck size={15} />
          {doneLabel}
        </span>
      ) : null}
      <span className="sk-async__live" role="status" aria-live="polite">
        {announce}
      </span>
    </span>
  );
}
