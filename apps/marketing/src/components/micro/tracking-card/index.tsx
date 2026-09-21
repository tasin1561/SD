import type { ReactElement, ReactNode } from 'react';
import { Check, Package } from 'lucide-react';
import './tracking-card.css';

export interface TrackingStep {
  label: string;
  /** Short helper under the label. */
  detail?: string;
  /** Time chip; omitted for a future step. */
  time?: string;
  state: 'done' | 'current' | 'todo';
}

/**
 * 25 · Tracking card (u17). Header with the parcel icon, the order id and
 * a status chip; a vertical timeline whose connector fills up to the
 * current step (done steps carry checks, the current one pulses); a time
 * chip per step; a progress bar with its own label; the expected-delivery
 * row with day and time chips. CSS only — the fill is a scaleY on the
 * connector, the pulse a box-shadow keyframe.
 */
export function TrackingCard({
  orderId,
  status,
  steps,
  progress,
  progressLabel,
  expectedDay,
  expectedTime,
  badge,
  className,
}: {
  orderId: string;
  status: string;
  steps: readonly TrackingStep[];
  /** 0–100 */
  progress: number;
  progressLabel: string;
  expectedDay: string;
  expectedTime?: string;
  /** e.g. "Sample" — sits in the header corner. */
  badge?: ReactNode;
  className?: string | undefined;
}): ReactElement {
  const current = Math.max(
    0,
    steps.findIndex((s) => s.state === 'current'),
  );
  const fill = steps.length > 1 ? (current / (steps.length - 1)) * 100 : 0;
  return (
    <div className={`mi mi-track ${className ?? ''}`}>
      <div className="mi-track__head">
        <span className="mi-track__icon" aria-hidden>
          <Package size={18} />
        </span>
        <span className="mi-track__id">
          <span className="mi-track__label">Order</span>
          <span className="tabular">{orderId}</span>
        </span>
        <span className="mi-track__status">{status}</span>
        {badge ? <span className="mi-track__badge">{badge}</span> : null}
      </div>
      <ol className="mi-track__steps" style={{ '--fill': `${fill}%` } as React.CSSProperties}>
        {steps.map((s) => (
          <li key={s.label} className="mi-track__step" data-state={s.state}>
            <span className="mi-track__dot" aria-hidden>
              {s.state === 'done' ? <Check size={11} strokeWidth={3} /> : null}
            </span>
            <span className="mi-track__text">
              <span className="mi-track__name">{s.label}</span>
              {s.detail ? <span className="mi-track__detail">{s.detail}</span> : null}
            </span>
            {s.time ? <span className="mi-track__time tabular">{s.time}</span> : null}
          </li>
        ))}
      </ol>
      <div
        className="mi-track__bar"
        role="progressbar"
        aria-valuenow={progress}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={progressLabel}
      >
        <span className="mi-track__bar-label">{progressLabel}</span>
        <span className="mi-track__bar-track">
          <span className="mi-track__bar-fill" style={{ transform: `scaleX(${progress / 100})` }} />
        </span>
      </div>
      <div className="mi-track__eta">
        <span className="mi-track__label">Expected delivery</span>
        <span className="mi-track__eta-day">{expectedDay}</span>
        {expectedTime ? <span className="mi-track__time tabular">{expectedTime}</span> : null}
      </div>
    </div>
  );
}
