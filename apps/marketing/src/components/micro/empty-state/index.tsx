import type { ReactElement, ReactNode } from 'react';
import './empty-state.css';

/**
 * 24 · Empty state (u27). A friendly animated illustration — a parcel
 * under a magnifier that sweeps, on a soft gradient wash — a title, one
 * helpful line, and ONE primary action. Never a sad face: "not found" is
 * an invitation to the next step, not a verdict. CSS only; the sweep is a
 * transform and pauses under reduced motion.
 */
export function EmptyState({
  title,
  body,
  action,
  tone = 'blue',
  className,
}: {
  title: string;
  body: string;
  action?: ReactNode;
  tone?: 'blue' | 'saffron' | 'green';
  className?: string;
}): ReactElement {
  return (
    <div className={`mi mi-empty ${className ?? ''}`} data-tone={tone} role="status">
      {/* Two stacked <svg>s in one box: the bob runs on the wrapper and the lens
          sweep on its own overlay — HTML-level boxes, so both composite. A
          transform on an SVG <g> is laid out on the main thread every frame. */}
      <span className="mi-empty__artwrap">
        <svg className="mi-empty__art" viewBox="0 0 120 84" aria-hidden>
          <g className="mi-empty__box">
            <path d="M34 36l26-12 26 12v26L60 74 34 62z" fill="var(--e-box)" />
            <path
              d="M34 36l26 12 26-12M60 48v26"
              fill="none"
              stroke="var(--e-edge)"
              strokeWidth="1.5"
            />
            <path d="M47 30l26 12v10l-4-2v-7L43 31z" fill="var(--e-tape)" />
          </g>
          <circle className="mi-empty__spark" cx="28" cy="22" r="2" fill="var(--e-ring)" />
          <circle
            className="mi-empty__spark mi-empty__spark--2"
            cx="100"
            cy="66"
            r="1.6"
            fill="var(--e-ring)"
          />
        </svg>
        <svg className="mi-empty__art mi-empty__lens" viewBox="0 0 120 84" aria-hidden>
          <circle
            cx="78"
            cy="30"
            r="13"
            fill="var(--e-glass)"
            stroke="var(--e-ring)"
            strokeWidth="3"
          />
          <path d="M88 40l10 10" stroke="var(--e-ring)" strokeWidth="4" strokeLinecap="round" />
        </svg>
      </span>
      <p className="mi-empty__title">{title}</p>
      <p className="mi-empty__body">{body}</p>
      {action ? <div className="mi-empty__action">{action}</div> : null}
    </div>
  );
}
