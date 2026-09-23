'use client';

import { clsx } from 'clsx';
import { Check, OctagonX } from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from 'react';
import './parachute-progress.css';

export type ParachuteState = 'running' | 'done' | 'failed';

export interface ParachuteProgressProps {
  /** What is happening — "Importing 240 orders". Also the progressbar's name. */
  label: string;
  /** 0–100 from the real operation; null/undefined = indeterminate (no fake numbers). */
  value?: number | null | undefined;
  state?: ParachuteState | undefined;
  /** A second line: "118 of 240 rows" or the failure reason, verbatim. */
  detail?: ReactNode;
  doneLabel?: string | undefined;
  failedLabel?: string | undefined;
  className?: string | undefined;
}

/**
 * Parachute progress (storytelling 01) — determinate progress for long
 * operations (CSV import, bulk actions). A parcel rides the fill head under
 * a canopy and sinks toward the line as the REAL `value` rises; at done the
 * canopy folds, the parcel lands and becomes a check with the word
 * "Complete". Failed turns the line red with a stop icon and words.
 *
 * With no `value` it is honest about not knowing: no percentage, the
 * parcel sways at the middle and a segment travels the line. That loop
 * pauses off-screen and on a hidden tab. `role="progressbar"`; the end
 * state is announced politely.
 */
export function ParachuteProgress({
  label,
  value,
  state = 'running',
  detail,
  doneLabel = 'Complete',
  failedLabel = 'Failed',
  className,
}: ParachuteProgressProps): ReactElement {
  const root = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  const num = typeof value === 'number' && Number.isFinite(value) ? value : null;
  const known = num !== null;
  const pct = state === 'done' ? 100 : num !== null ? Math.min(100, Math.max(0, num)) : 50;
  const indeterminate = state === 'running' && !known;

  // Loops only run while someone can see them.
  useEffect(() => {
    if (!indeterminate) return;
    const el = root.current;
    let inView = true;
    const sync = (): void => setPaused(!inView || document.hidden);
    const io =
      typeof IntersectionObserver === 'undefined' || el === null
        ? null
        : new IntersectionObserver((entries) => {
            inView = entries.some((e) => e.isIntersecting);
            sync();
          });
    if (io && el) io.observe(el);
    document.addEventListener('visibilitychange', sync);
    return () => {
      io?.disconnect();
      document.removeEventListener('visibilitychange', sync);
    };
  }, [indeterminate]);

  const status =
    state === 'done'
      ? doneLabel
      : state === 'failed'
        ? failedLabel
        : known
          ? `${Math.round(pct)}%`
          : 'Working…';

  return (
    <div
      ref={root}
      className={clsx('sk-chute', className)}
      data-state={state}
      data-indeterminate={indeterminate || undefined}
      data-paused={paused || undefined}
      style={{ '--p': pct } as CSSProperties}
    >
      <div className="sk-chute__head">
        <span className="sk-chute__label">{label}</span>
        <span className="sk-chute__status sk-figure">
          {state === 'done' ? <Check size={14} strokeWidth={2.6} aria-hidden /> : null}
          {state === 'failed' ? <OctagonX size={14} aria-hidden /> : null}
          {status}
        </span>
      </div>
      <div
        className="sk-chute__track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={known || state === 'done' ? Math.round(pct) : undefined}
        aria-valuetext={status}
      >
        <span className="sk-chute__rider" aria-hidden>
          <span className="sk-chute__drop">
            <svg className="sk-chute__art" viewBox="0 0 26 30" focusable="false">
              <g className="sk-chute__canopy">
                <path d="M2 12c1-6 5-9 11-9s10 3 11 9c-3-2-6-2-8 0-2-2-4-2-6 0-2-2-5-2-8 0z" />
                <path className="sk-chute__lines" d="M4 12l7 8M22 12l-7 8M13 12v8" />
              </g>
              <rect className="sk-chute__parcel" x="8.5" y="19" width="9" height="8" rx="1.4" />
              <path className="sk-chute__tape" d="M12 19h2v8h-2z" />
            </svg>
            <Check className="sk-chute__check" size={18} strokeWidth={3} />
          </span>
        </span>
        <span className="sk-chute__bar">
          <span className="sk-chute__fill" />
        </span>
      </div>
      {detail ? <div className="sk-chute__detail">{detail}</div> : null}
      <span className="sk-chute__live" aria-live="polite">
        {state === 'running' ? '' : `${label}: ${status}`}
      </span>
    </div>
  );
}
