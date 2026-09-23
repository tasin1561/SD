'use client';

import { clsx } from 'clsx';
import { CircleCheck } from 'lucide-react';
import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { ms, reducedMotion } from '../motion/motion';
import './van-drive-off.css';

export interface VanDriveOffProps {
  /**
   * Bump this AFTER the real request succeeds (a success counter, or the
   * new order's id). 0 / null never plays. Each new value plays once.
   */
  play: number | string | null;
  /** The confirmation the van reveals — "Order SD-2026-38-000101 created". */
  message: ReactNode;
  /** The control the van drives out of (the "Create order" button). Stays usable. */
  children?: ReactNode;
  /** Clear the confirmation after this many ms; omit to keep it. */
  clearAfterMs?: number | undefined;
  /** Fires when the sequence has ended (at once under reduced motion). */
  onFinished?: (() => void) | undefined;
  className?: string | undefined;
}

const SEQUENCE_MS = 1100;

/**
 * Van drive-off (storytelling 02) — the success sequence for "Create
 * order". It plays ONLY after the caller's real request has succeeded:
 * a van pulls out from beside the button, speed lines trail it, it drives
 * off to the right and leaves a green confirmation pill behind (≤ 1.2 s).
 *
 * Non-blocking by construction: the art is `pointer-events: none` and
 * `aria-hidden`, nothing takes focus, and `children` (the button) is never
 * disabled or covered, so the next order can be started at once. The
 * confirmation is a polite status. Under reduced motion the pill simply
 * appears.
 */
export function VanDriveOff({
  play,
  message,
  children,
  clearAfterMs,
  onFinished,
  className,
}: VanDriveOffProps): ReactElement {
  const [shown, setShown] = useState<number | string | null>(null);

  useEffect(() => {
    if (play === null || play === 0 || play === '') return;
    setShown(play);
    const end = window.setTimeout(() => onFinished?.(), reducedMotion() ? 0 : ms(SEQUENCE_MS));
    const clear =
      clearAfterMs !== undefined && Number.isFinite(clearAfterMs)
        ? window.setTimeout(() => setShown(null), ms(clearAfterMs))
        : undefined;
    return () => {
      window.clearTimeout(end);
      if (clear !== undefined) window.clearTimeout(clear);
    };
    // onFinished is a callback, not a trigger: only a new `play` replays.
  }, [play, clearAfterMs]);

  return (
    <span className={clsx('sk-van', className)}>
      {children}
      <span className="sk-van__stage">
        {shown !== null ? (
          <span key={String(shown)} className="sk-van__run">
            <span className="sk-van__done" aria-hidden>
              <CircleCheck size={16} aria-hidden />
              <span>{message}</span>
            </span>
            <svg className="sk-van__truck" viewBox="0 0 64 32" aria-hidden focusable="false">
              <g className="sk-van__lines">
                <path d="M1 13h10M4 18h8M0 23h9" />
              </g>
              <path className="sk-van__cargo" d="M16 6h24v18H16z" />
              <path className="sk-van__cab" d="M40 11h9l7 7v6H40z" />
              <path className="sk-van__glass" d="M43 13h5.2l4.3 4.5H43z" />
              <path className="sk-van__mark" d="M22 12h6v6h-6z" />
              <g className="sk-van__wheel">
                <circle cx="24" cy="25" r="4" />
                <path d="M24 22v6" />
              </g>
              <g className="sk-van__wheel sk-van__wheel--b">
                <circle cx="48" cy="25" r="4" />
                <path d="M48 22v6" />
              </g>
            </svg>
          </span>
        ) : null}
        <span className="sk-van__live" role="status" aria-live="polite">
          {shown !== null ? message : ''}
        </span>
      </span>
    </span>
  );
}
