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
import './paper-plane-send.css';

export type PaperPlaneSendButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'children' | 'type' | 'aria-label'
> & {
  /** The REAL request, fired on click at t = 0. The plane flies only if it resolves. */
  onAction: () => Promise<unknown>;
  /** Idle label — and the accessible name, throughout. */
  label: string;
  busyLabel?: string | undefined;
  /** What the button says once the plane has gone — "Reply sent". */
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

/** The morph: fold into the plane, fly off. The button is back when it ends. */
const FLY_MS = 700;
/** How long "done" / the error rests on the button before idle (from the result). */
const SETTLE_MS = 2000;
/** Reduced motion: how long the pill beside the button stays. */
const PILL_MS = 3000;

/**
 * Paper-plane send (storytelling 03-04) — the BUTTON folds into the plane.
 *
 * Click → busy (disabled, `aria-busy`, the busy label rolls in) while the
 * real request runs. On a REAL success only: the pill folds down to a
 * square, the label fades, a paper plane pops out of it, banks back, and
 * flies off up-right trailing a dashed line; the button springs back green
 * with a check and `doneLabel` — enabled again 0.7 s after the result, then
 * idle. On error: no plane — a shake, red, `errorLabel`.
 *
 * Only this button is busy: no overlay, no focus move, so the next reply
 * can be typed at once. The art is `aria-hidden`, `pointer-events: none`
 * and clipped to the button's own box plus a small margin. The accessible
 * name stays `label`; results go to a polite live region. Reduced motion:
 * no fold — the button returns at once and a green pill appears beside it.
 */
export function PaperPlaneSendButton({
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
}: PaperPlaneSendButtonProps): ReactElement {
  const [flying, setFlying] = useState(0);
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
          setFlying((n) => n + 1);
          later(() => setFlying(0), FLY_MS);
        }
      }
      onSettled?.(outcome);
    },
  });

  const phase = s.phase === 'success' && pill ? 'idle' : s.phase;
  const story = flying > 0 ? 'fly' : phase;
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
    <span className={clsx('sk-plane', fullWidth && 'sk-plane--full', className)}>
      <span className="sk-plane__box" data-story={story}>
        <Button
          {...rest}
          type={type}
          variant={variant}
          size={size}
          fullWidth={fullWidth}
          icon={lead}
          className="sk-async sk-plane__btn"
          data-phase={flying > 0 ? 'busy' : phase}
          aria-label={label}
          aria-busy={s.phase === 'busy' || undefined}
          disabled={disabled === true || s.phase === 'busy' || flying > 0}
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
        <span className="sk-plane__art" aria-hidden>
          {flying > 0 ? (
            <svg key={flying} className="sk-plane__plane" viewBox="0 0 28 28" focusable="false">
              <path className="sk-plane__trail" d="M1 22c3-1.5 6-1.5 9 .5" pathLength={1} />
              <path className="sk-plane__wing" d="M3 13.5 25 4l-6.5 20-5.2-7.3z" />
              <path className="sk-plane__fold" d="m13.3 16.7 11.7-12.7-15.4 10.2z" />
            </svg>
          ) : null}
        </span>
      </span>
      {pill ? (
        <span className="sk-plane__pill" aria-hidden>
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
