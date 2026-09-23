'use client';

import { clsx } from 'clsx';
import { Check, Ellipsis, MapPin, Package, RotateCcw, X } from 'lucide-react';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from 'react';
import { useLoopVisible } from '../motion/use-loop-visible';
import './timeline.css';

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export type TimelineStepState = 'done' | 'current' | 'todo' | 'skipped';
export type TimelineTone = 'default' | 'failed' | 'returning';

export interface TimelineStep {
  readonly id: string;
  readonly label: ReactNode;
  readonly state: TimelineStepState;
  readonly description?: ReactNode;
  readonly location?: ReactNode;
  /** The time chip — "12 Sep, 14:52". Omit for a step still to come. */
  readonly time?: ReactNode;
  /** A failed or returning step colours its dot (and the fill, when current). */
  readonly tone?: TimelineTone | undefined;
  /** Replaces the check / dot glyph. */
  readonly icon?: ReactNode;
}

export interface TimelineHeader {
  readonly icon?: ReactNode;
  /** "Order", "Parcel". */
  readonly title?: ReactNode;
  /** The id — rendered mono (`sk-ident`). */
  readonly id?: ReactNode;
  /** A `StatusChip`. */
  readonly status?: ReactNode;
  /** An ETA chip in the corner. */
  readonly eta?: ReactNode;
}

const STATE_WORD: Record<TimelineStepState, string> = {
  done: 'Completed',
  current: 'Current step',
  todo: 'Still to come',
  skipped: 'Skipped',
};

/**
 * Timeline (u17) — the ONE journey timeline for tracking and all three
 * consoles. Data in by props; no fetching.
 *
 * A vertical list whose connector is FILLED up to the current step
 * (measured, so steps of any height line up; the fill grows once on
 * mount). Completed steps carry checks, the current step pulses (paused
 * off-screen and on a hidden tab), every step can carry a time chip, a
 * description and a location. A `failed` or `returning` tone recolours a
 * step — and the fill, when that step is the current one. Optional
 * header (icon, id, status chip, ETA), "On the way" progress bar and
 * expected-delivery row.
 *
 * Each step's state is also spoken ("Completed", "Current step" …), and
 * the current step carries `aria-current="step"`: colour is never the
 * only signal.
 */
export function Timeline({
  steps,
  header,
  progress,
  expected,
  label = 'Journey',
  stateWords,
  collapseEarlier,
  className,
}: {
  readonly steps: readonly TimelineStep[];
  readonly header?: TimelineHeader | undefined;
  /** 0–100 and the words beside it ("On the way"). */
  readonly progress?: { readonly value: number; readonly label: string } | undefined;
  readonly expected?:
    | { readonly label?: string; readonly day: ReactNode; readonly time?: ReactNode }
    | undefined;
  readonly label?: string;
  /** The spoken state words, translated ("Completed" → "पूरा हुआ"). */
  readonly stateWords?: Partial<Record<TimelineStepState, string>> | undefined;
  /**
   * Fold the steps before the last `keep` ones that lead up to the current
   * step behind one button, so on a long journey the current step is on
   * screen without scrolling. `{n}` in the labels is the hidden count. The
   * button stays where it is after expanding (as `hideLabel`), so focus is
   * never lost. Omit to show every step.
   */
  readonly collapseEarlier?:
    | { readonly keep: number; readonly showLabel: string; readonly hideLabel: string }
    | undefined;
  readonly className?: string | undefined;
}): ReactElement {
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const play = useLoopVisible(rootRef);
  const [armed, setArmed] = useState(false);

  let reach = -1;
  steps.forEach((s, i) => {
    if (s.state === 'done' || s.state === 'current') reach = i;
  });
  const reachStep = reach >= 0 ? steps[reach] : undefined;
  const fillTone = reachStep?.tone ?? 'default';

  const [expanded, setExpanded] = useState(false);
  const foldable = collapseEarlier === undefined ? 0 : Math.max(0, reach - collapseEarlier.keep);
  // Folding a single step saves nothing: it would swap one row for a button.
  const canFold = foldable >= 2;
  const hidden = canFold && !expanded ? foldable : 0;
  const shown = hidden > 0 ? steps.slice(hidden) : steps;
  // The fold row carries a dot too, so the rail stays continuous.
  const domReach = reach < 0 ? -1 : reach - hidden + (canFold ? 1 : 0);

  useIsoLayoutEffect(() => {
    const list = listRef.current;
    if (list === null) return;
    const measure = (): void => {
      const dots = Array.from(list.querySelectorAll<HTMLElement>('.sk-tl__dot'));
      const first = dots[0];
      const last = dots[dots.length - 1];
      if (first === undefined || last === undefined) return;
      const base = list.getBoundingClientRect().top;
      const center = (d: HTMLElement): number => {
        const r = d.getBoundingClientRect();
        return r.top - base + r.height / 2;
      };
      const top = center(first);
      const height = Math.max(0, center(last) - top);
      const target = domReach >= 0 ? dots[domReach] : undefined;
      const fill = target === undefined || height === 0 ? 0 : (center(target) - top) / height;
      list.style.setProperty('--rail-top', `${top}px`);
      list.style.setProperty('--rail-h', `${height}px`);
      list.style.setProperty('--fill', String(Math.min(1, Math.max(0, fill))));
    };
    measure();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    ro?.observe(list);
    return () => ro?.disconnect();
  }, [steps, domReach, hidden]);

  // Grow the fill once, after the first measurement.
  useEffect(() => {
    const id = window.requestAnimationFrame(() => setArmed(true));
    return () => window.cancelAnimationFrame(id);
  }, []);

  const pct = progress === undefined ? 0 : Math.min(100, Math.max(0, progress.value));

  return (
    <div
      ref={rootRef}
      className={clsx('sk-tl', className)}
      data-play={play ? '1' : '0'}
      data-armed={armed ? '1' : undefined}
      data-fill-tone={fillTone}
    >
      {header !== undefined && (
        <div className="sk-tl__head">
          <span className="sk-tl__head-icon" aria-hidden>
            {header.icon ?? <Package size={18} />}
          </span>
          <span className="sk-tl__head-id">
            {header.title !== undefined && (
              <span className="sk-tl__head-title">{header.title}</span>
            )}
            {header.id !== undefined && (
              <span className="sk-ident sk-tl__head-ident">{header.id}</span>
            )}
          </span>
          <span className="sk-tl__head-side">
            {header.status}
            {header.eta !== undefined && <span className="sk-tl__time">{header.eta}</span>}
          </span>
        </div>
      )}
      <ol ref={listRef} className="sk-tl__steps" aria-label={label}>
        {canFold && collapseEarlier !== undefined && (
          <li className="sk-tl__step sk-tl__fold" data-state="done" data-tone="default">
            <span className="sk-tl__dot" aria-hidden>
              <Ellipsis size={12} strokeWidth={3} />
            </span>
            <button
              type="button"
              className="sk-tl__fold-btn"
              aria-expanded={expanded}
              onClick={() => setExpanded((e) => !e)}
            >
              {(expanded ? collapseEarlier.hideLabel : collapseEarlier.showLabel).replace(
                '{n}',
                String(foldable),
              )}
            </button>
          </li>
        )}
        {shown.map((s) => {
          const tone = s.tone ?? 'default';
          const glyph =
            s.icon ??
            (s.state === 'done' ? (
              tone === 'failed' ? (
                <X size={12} strokeWidth={3} />
              ) : tone === 'returning' ? (
                <RotateCcw size={11} strokeWidth={3} />
              ) : (
                <Check size={12} strokeWidth={3} />
              )
            ) : s.state === 'current' && tone === 'failed' ? (
              <X size={12} strokeWidth={3} />
            ) : s.state === 'current' && tone === 'returning' ? (
              <RotateCcw size={11} strokeWidth={3} />
            ) : null);
          return (
            <li
              key={s.id}
              className="sk-tl__step"
              data-state={s.state}
              data-tone={tone}
              aria-current={s.state === 'current' ? 'step' : undefined}
            >
              <span className="sk-tl__dot" aria-hidden>
                {glyph}
              </span>
              <span className="sk-tl__body">
                <span className="sk-tl__label">
                  <span className="sk-tl__sr">{`${stateWords?.[s.state] ?? STATE_WORD[s.state]}: `}</span>
                  {s.label}
                </span>
                {s.description !== undefined && (
                  <span className="sk-tl__desc">{s.description}</span>
                )}
                {s.location !== undefined && (
                  <span className="sk-tl__loc">
                    <MapPin size={12} aria-hidden />
                    {s.location}
                  </span>
                )}
              </span>
              {s.time !== undefined && <span className="sk-tl__time sk-figure">{s.time}</span>}
            </li>
          );
        })}
      </ol>
      {progress !== undefined && (
        <div className="sk-tl__progress">
          <div className="sk-tl__progress-head">
            <span className="sk-tl__progress-label">{progress.label}</span>
            <span className="sk-tl__progress-pct sk-figure">{Math.round(pct)}%</span>
          </div>
          <span
            className="sk-tl__bar"
            role="progressbar"
            aria-label={progress.label}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(pct)}
          >
            <span
              className="sk-tl__bar-fill"
              style={{ '--pct': String(pct / 100) } as CSSProperties}
            />
          </span>
        </div>
      )}
      {expected !== undefined && (
        <div className="sk-tl__eta">
          <span className="sk-tl__eta-label">{expected.label ?? 'Expected delivery'}</span>
          <span className="sk-tl__eta-day">{expected.day}</span>
          {expected.time !== undefined && (
            <span className="sk-tl__time sk-figure">{expected.time}</span>
          )}
        </div>
      )}
    </div>
  );
}
