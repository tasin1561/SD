'use client';

import type { ReactElement, ReactNode } from 'react';
import { Check, OctagonX } from 'lucide-react';
import { useAsyncState } from '../use-async-state';
import '../micro.css';
import './parachute-progress.css';

export interface ParachuteProgressProps<T> {
  label: ReactNode;
  task: () => Promise<T>;
  successLabel: (value: T) => ReactNode;
  errorLabel?: ReactNode;
  /** Keep the result on screen (Infinity) or return to idle after this many ms. */
  settleMs?: number;
  className?: string;
  /** Fires with the real result — the caller may render it outside the pill. */
  onSettled?: (result: { ok: true; value: T } | { ok: false; error: unknown }) => void;
}

/**
 * 1 · Parachute progress. The pill becomes a bar, a parcel descends under
 * a canopy while the REAL task runs, and the landing is the result —
 * never before the response (`useAsyncState`, min busy = the descent).
 */
export function ParachuteProgress<T>({
  label,
  task,
  successLabel,
  errorLabel = 'Something went wrong — try again',
  settleMs = Infinity,
  className,
  onSettled,
}: ParachuteProgressProps<T>): ReactElement {
  const s = useAsyncState<T>({ minBusyMs: 2400, settleMs, ...(onSettled ? { onSettled } : {}) });
  return (
    <span className={`mi mi-para ${className ?? ''}`} {...s.a11y}>
      <button
        type="button"
        className="mi-para__btn"
        onClick={() => void s.run(task)}
        disabled={s.phase === 'busy'}
      >
        {label}
      </button>
      <span className="mi-para__stage" aria-hidden>
        <span className="mi-para__sky">
          <svg className="mi-para__chute" viewBox="0 0 26 26" fill="none">
            <path
              className="canopy"
              d="M2 12c1-6 5-9 11-9s10 3 11 9c-3-2-6-2-8 0-2-2-4-2-6 0-2-2-5-2-8 0z"
              fill="currentColor"
              opacity=".85"
            />
            <path d="M4 12l7 7M22 12l-7 7" stroke="currentColor" strokeWidth="1.2" />
            <rect
              x="9"
              y="17"
              width="8"
              height="7"
              rx="1.2"
              fill="var(--saffron-fill)"
              stroke="var(--saffron-on-fill)"
              strokeWidth=".8"
            />
          </svg>
        </span>
        <span className="mi-para__bar" />
      </span>
      <span className="mi-para__result" role="status">
        {s.phase === 'success' && s.value !== undefined ? (
          <>
            <Check size={18} aria-hidden="true" />
            {successLabel(s.value)}
          </>
        ) : null}
        {s.phase === 'error' ? (
          <>
            <OctagonX size={18} aria-hidden="true" />
            {errorLabel}
          </>
        ) : null}
      </span>
    </span>
  );
}
