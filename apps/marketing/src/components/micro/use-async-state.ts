'use client';

import { useCallback, useRef, useState } from 'react';
import { reducedMotion, sleep } from './motion';

export type AsyncPhase = 'idle' | 'busy' | 'success' | 'error';

export interface AsyncStateOptions<T> {
  /** The busy animation plays at least this long — but the REAL request starts at t=0. */
  minBusyMs?: number;
  /** How long success/error rests before returning to idle; Infinity keeps it. */
  settleMs?: number;
  onSettled?: (result: { ok: true; value: T } | { ok: false; error: unknown }) => void;
}

export interface AsyncState<T> {
  phase: AsyncPhase;
  /** The last resolved value — defined while phase is 'success'. */
  value: T | undefined;
  error: unknown;
  run: (task: () => Promise<T>) => Promise<void>;
  reset: () => void;
  /** Spread onto the interactive element. */
  a11y: { 'aria-busy': boolean; 'aria-live': 'polite'; 'data-phase': AsyncPhase };
}

/**
 * The ONE place the "honest busy state" contract is encoded.
 *
 * `run(task)` fires the real request immediately and, in parallel, waits
 * `minBusyMs` — so a success (or error) frame appears no earlier than the
 * minimum AND never before the real result. Under reduced motion the
 * minimum is 0: nothing is animating, so there is nothing to wait for.
 * A component never sets its own success; it reads `phase`.
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

  const reset = useCallback((): void => {
    seq.current += 1;
    setPhase('idle');
    setError(null);
  }, []);

  const run = useCallback(
    async (task: () => Promise<T>): Promise<void> => {
      const mine = ++seq.current;
      setError(null);
      setPhase('busy');
      const floor = reducedMotion() ? Promise.resolve() : sleep(minBusyMs);
      const [outcome] = await Promise.all([
        task().then(
          (value) => ({ ok: true as const, value }),
          (err: unknown) => ({ ok: false as const, error: err }),
        ),
        floor,
      ]);
      if (mine !== seq.current) return; // reset() or a newer run() won
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
        if (mine === seq.current) setPhase('idle');
      }
    },
    [minBusyMs, settleMs, onSettled],
  );

  return {
    phase,
    value,
    error,
    run,
    reset,
    a11y: { 'aria-busy': phase === 'busy', 'aria-live': 'polite', 'data-phase': phase },
  };
}
