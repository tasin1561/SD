'use client';

import { clsx } from 'clsx';
import { Check, LoaderCircle, OctagonX } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Button, type ButtonSize, type ButtonVariant } from '../button';
import { reducedMotion, sleep } from '../motion/motion';
import './async-button.css';

export type AsyncPhase = 'idle' | 'busy' | 'success' | 'error';

export type AsyncOutcome<T> = { ok: true; value: T } | { ok: false; error: unknown };

export interface AsyncStateOptions<T> {
  /** The busy state shows at least this long — the REAL request starts at t=0. */
  minBusyMs?: number | undefined;
  /** How long success/error rests before returning to idle; Infinity keeps it. */
  settleMs?: number | undefined;
  onSettled?: ((result: AsyncOutcome<T>) => void) | undefined;
}

export interface AsyncState<T> {
  phase: AsyncPhase;
  /** The last resolved value — defined while phase is 'success'. */
  value: T | undefined;
  error: unknown;
  run: (task: () => Promise<T>) => Promise<AsyncOutcome<T>>;
  reset: () => void;
}

/**
 * The ONE place the "honest busy state" contract is encoded (ported from
 * apps/marketing's use-async-state).
 *
 * `run(task)` fires the real request immediately and, in parallel, waits
 * `minBusyMs` — so a success (or error) frame appears no earlier than the
 * minimum AND never before the real result. Under reduced motion the floor
 * is 0: nothing animates, so there is nothing to wait for. A component
 * never sets its own success; it reads `phase`.
 */
export function useAsyncState<T = unknown>({
  minBusyMs = 600,
  settleMs = 1600,
  onSettled,
}: AsyncStateOptions<T> = {}): AsyncState<T> {
  const [phase, setPhase] = useState<AsyncPhase>('idle');
  const [value, setValue] = useState<T | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const seq = useRef(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const reset = useCallback((): void => {
    seq.current += 1;
    setPhase('idle');
    setError(null);
  }, []);

  const run = useCallback(
    async (task: () => Promise<T>): Promise<AsyncOutcome<T>> => {
      const mine = ++seq.current;
      setError(null);
      setPhase('busy');
      const floor = reducedMotion() ? Promise.resolve() : sleep(minBusyMs);
      const [outcome] = await Promise.all([
        task().then(
          (v): AsyncOutcome<T> => ({ ok: true, value: v }),
          (err: unknown): AsyncOutcome<T> => ({ ok: false, error: err }),
        ),
        floor,
      ]);
      if (!alive.current || mine !== seq.current) return outcome; // unmounted, reset() or a newer run() won
      if (outcome.ok) {
        setValue(outcome.value);
        setPhase('success');
      } else {
        setError(outcome.error);
        setPhase('error');
      }
      onSettled?.(outcome);
      if (Number.isFinite(settleMs)) {
        await sleep(settleMs);
        if (alive.current && mine === seq.current) setPhase('idle');
      }
      return outcome;
    },
    [minBusyMs, settleMs, onSettled],
  );

  return { phase, value, error, run, reset };
}

export interface AsyncButtonLabels {
  idle: string;
  busy: string;
  done?: string | undefined;
  error?: string | undefined;
}

export type AsyncButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> & {
  /** The real request. The button is busy exactly while it runs (plus `minBusyMs`). */
  onAction?: (() => Promise<unknown>) | undefined;
  /** Controlled phase, for a caller that owns the request itself. */
  state?: AsyncPhase | undefined;
  labels: AsyncButtonLabels;
  variant?: ButtonVariant | undefined;
  size?: ButtonSize | undefined;
  /** The idle icon; busy / done / error icons are fixed. */
  icon?: ReactNode;
  fullWidth?: boolean | undefined;
  minBusyMs?: number | undefined;
  settleMs?: number | undefined;
  onSettled?: ((result: AsyncOutcome<unknown>) => void) | undefined;
  /** Plain click, for the controlled mode. */
  onClick?: ButtonHTMLAttributes<HTMLButtonElement>['onClick'];
};

/**
 * Rolling-label state button (storytelling 05). Idle → busy → done / error:
 * the four labels sit in one strip that ROLLS vertically to the current
 * phase; the icon loops only while busy and becomes a check or a stop sign
 * on the result. Wired to a real promise (`onAction`) or a controlled
 * `state`; never fakes a result.
 *
 * The accessible name is the idle label throughout (the strip is
 * aria-hidden); the phase is announced through a polite live region
 * beside the button. Busy = `aria-busy` + disabled. An error stays on the
 * control until clicked again (retry) or `settleMs` passes.
 */
export function AsyncButton({
  onAction,
  state,
  labels,
  variant = 'primary',
  size = 'md',
  icon,
  fullWidth,
  minBusyMs = 600,
  settleMs = 1600,
  onSettled,
  onClick,
  className,
  disabled,
  'aria-label': ariaLabel,
  ...rest
}: AsyncButtonProps): ReactElement {
  const s = useAsyncState<unknown>({ minBusyMs, settleMs, onSettled });
  const phase: AsyncPhase = state ?? s.phase;
  const done = labels.done ?? 'Done';
  const failed = labels.error ?? 'Failed, try again';

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
    phase === 'busy' ? labels.busy : phase === 'success' ? done : phase === 'error' ? failed : '';

  return (
    <>
      <Button
        {...rest}
        variant={variant}
        size={size}
        fullWidth={fullWidth}
        icon={lead}
        className={clsx('sk-async', className)}
        data-phase={phase}
        aria-label={ariaLabel ?? labels.idle}
        aria-busy={phase === 'busy' || undefined}
        disabled={disabled === true || phase === 'busy'}
        onClick={(e) => {
          onClick?.(e);
          if (onAction && state === undefined && !e.defaultPrevented) void s.run(onAction);
        }}
      >
        <span className="sk-async__window" aria-hidden>
          <span className="sk-async__strip">
            <span>{labels.idle}</span>
            <span>{labels.busy}</span>
            <span>{done}</span>
            <span>{failed}</span>
          </span>
        </span>
      </Button>
      <span className="sk-async__live" aria-live="polite" role="status">
        {announce}
      </span>
    </>
  );
}
