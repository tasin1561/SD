'use client';

import { clsx } from 'clsx';
import { Check } from 'lucide-react';
import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { ms, reducedMotion } from '../motion/motion';
import './paper-plane-send.css';

export interface PaperPlaneSendProps {
  /**
   * Bump this AFTER the reply was really sent (a counter, or the new
   * message id). 0 / null never plays; each new value plays once.
   */
  play: number | string | null;
  /** The one-line confirmation left behind — "Reply sent to Menev Store". */
  message: ReactNode;
  /** The send button the plane leaves from. Never disabled or covered. */
  children?: ReactNode;
  /** Clear the confirmation after this many ms; default 4000. Infinity keeps it. */
  clearAfterMs?: number | undefined;
  onFinished?: (() => void) | undefined;
  className?: string | undefined;
}

const SEQUENCE_MS = 1000;

/**
 * Paper-plane send (storytelling 03-04) — the sent sequence for a ticket
 * reply. After the caller's real request succeeds, a paper plane lifts off
 * beside the send button and flies away on a rising curve; a "Sent" line
 * with a check is left behind (≤ 1.2 s).
 *
 * The art is `pointer-events: none` and hidden from assistive tech; the
 * confirmation is a polite status. Focus is never moved, so the person can
 * type the next reply straight away. Reduced motion: the line appears.
 */
export function PaperPlaneSend({
  play,
  message,
  children,
  clearAfterMs = 4000,
  onFinished,
  className,
}: PaperPlaneSendProps): ReactElement {
  const [shown, setShown] = useState<number | string | null>(null);

  useEffect(() => {
    if (play === null || play === 0 || play === '') return;
    setShown(play);
    const end = window.setTimeout(() => onFinished?.(), reducedMotion() ? 0 : ms(SEQUENCE_MS));
    const clear = Number.isFinite(clearAfterMs)
      ? window.setTimeout(() => setShown(null), ms(clearAfterMs))
      : undefined;
    return () => {
      window.clearTimeout(end);
      if (clear !== undefined) window.clearTimeout(clear);
    };
    // onFinished is a callback, not a trigger: only a new `play` replays.
  }, [play, clearAfterMs]);

  return (
    <span className={clsx('sk-plane', className)}>
      {children}
      <span className="sk-plane__stage">
        {shown !== null ? (
          <span key={String(shown)} className="sk-plane__run">
            <span className="sk-plane__done" aria-hidden>
              <Check size={15} strokeWidth={2.6} />
              <span>{message}</span>
            </span>
            <svg className="sk-plane__plane" viewBox="0 0 28 28" aria-hidden focusable="false">
              <path className="sk-plane__wing" d="M3 13.5 25 4l-6.5 20-5.2-7.3z" />
              <path className="sk-plane__fold" d="m13.3 16.7 11.7-12.7-15.4 10.2z" />
              <path className="sk-plane__trail" d="M2 20c3-1 5-1 8 1" />
            </svg>
          </span>
        ) : null}
        <span className="sk-plane__live" role="status" aria-live="polite">
          {shown !== null ? message : ''}
        </span>
      </span>
    </span>
  );
}
