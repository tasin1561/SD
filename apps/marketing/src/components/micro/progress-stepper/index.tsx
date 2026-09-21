'use client';

import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import { reducedMotion } from '../motion';
import '../micro.css';
import './progress-stepper.css';

export interface ProgressStep {
  id: string;
  title: string;
  icon: ReactNode;
  /** Shown in the panel under the current step. */
  body?: ReactNode;
}

/**
 * 29 · Progress stepper (u34). Icons inside the steps, the connector
 * fills with accent up to the current step, completed steps turn solid
 * with a check, the current one wears a glow ring, labels change colour
 * with state. It advances on a timer once in view (paused on hover or
 * focus) and any step can be picked; the panel below cross-fades to the
 * picked step. `role=tablist` semantics — the steps ARE the tabs.
 */
export function ProgressStepper({
  steps,
  intervalMs = 3200,
  label,
  className,
}: {
  steps: readonly ProgressStep[];
  intervalMs?: number;
  label: string;
  className?: string;
}): ReactElement {
  const [current, setCurrent] = useState(0);
  const [paused, setPaused] = useState(false);
  const [inView, setInView] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => setInView(es.some((e) => e.isIntersecting)), {
      threshold: 0.35,
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!inView || paused || reducedMotion() || document.hidden) return;
    const t = window.setInterval(() => setCurrent((c) => (c + 1) % steps.length), intervalMs);
    return () => window.clearInterval(t);
  }, [inView, paused, intervalMs, steps.length]);

  const fill = steps.length > 1 ? (current / (steps.length - 1)) * 100 : 0;
  const cur = steps[current];
  return (
    <div
      ref={root}
      className={`mi mi-pstep ${className ?? ''}`}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      <div
        className="mi-pstep__rail"
        role="tablist"
        aria-label={label}
        style={{ '--fill': `${fill}%` } as React.CSSProperties}
      >
        {steps.map((s, i) => {
          const state = i < current ? 'done' : i === current ? 'current' : 'todo';
          return (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={i === current}
              aria-controls={`pstep-${s.id}`}
              className="mi-pstep__step"
              data-state={state}
              onClick={() => setCurrent(i)}
            >
              <span className="mi-pstep__node" aria-hidden>
                <span className="mi-pstep__ico">{s.icon}</span>
                <span className="mi-pstep__check">
                  <Check size={14} strokeWidth={3} />
                </span>
              </span>
              <span className="mi-pstep__label">
                <span className="mi-pstep__n tabular">{String(i + 1).padStart(2, '0')}</span>
                {s.title}
              </span>
            </button>
          );
        })}
      </div>
      {cur?.body ? (
        <div key={cur.id} id={`pstep-${cur.id}`} role="tabpanel" className="mi-pstep__panel">
          {cur.body}
        </div>
      ) : null}
    </div>
  );
}
