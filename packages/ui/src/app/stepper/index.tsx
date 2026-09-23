'use client';

import { clsx } from 'clsx';
import { Check } from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from 'react';
import { reducedMotion } from '../motion/motion';
import './stepper.css';

export interface StepperStep {
  /** In `sections` mode: the id of the section element it tracks. */
  readonly id: string;
  readonly label: string;
  readonly icon?: ReactNode;
  /** A short line under the label (wizard mode). */
  readonly description?: string | undefined;
}

interface Common {
  readonly steps: readonly StepperStep[];
  /** Names the stepper for assistive tech. */
  readonly label: string;
  /** Stick the progress header to the top (`--sk-sticky-top`). */
  readonly sticky?: boolean;
  readonly className?: string | undefined;
}

export type StepperProps =
  | (Common & {
      readonly mode: 'wizard';
      /** 0-based index of the current step. */
      readonly current: number;
      /** Called when a reachable step is clicked. */
      readonly onStepChange?: ((index: number) => void) | undefined;
      /** Which steps may be clicked. Default: those already completed. */
      readonly navigable?: 'completed' | 'any' | 'none';
      /** The current step's content; it rises in when the step changes. */
      readonly children?: ReactNode;
    })
  | (Common & {
      readonly mode: 'sections';
      /** Offset from the top at which a section counts as "the one in view". */
      readonly scrollOffset?: number;
    });

/**
 * Stepper (u34). An icon inside each step; the connector fills with
 * accent as steps complete; completed steps turn solid with a check; the
 * current step wears a glow ring; labels change colour with state.
 *
 *   mode="wizard"    the steps drive content: `current` is the step shown,
 *                    `children` is its content (it rises in on change)
 *   mode="sections"  a PROGRESS HEADER over one existing long form: it
 *                    watches the section elements named by the step ids,
 *                    marks the one in view as current and those above it
 *                    as passed, and a click scrolls to (and focuses) a
 *                    section. It hides and unmounts NOTHING — the form
 *                    stays one form.
 *
 * Steps are an ordered list; the current one carries
 * `aria-current="step"` and each state is spoken, so colour is never the
 * only signal.
 */
export function Stepper(props: StepperProps): ReactElement {
  const { steps, label, sticky = false, className } = props;
  const [inView, setInView] = useState(0);
  const offset = props.mode === 'sections' ? (props.scrollOffset ?? 120) : 0;
  // The ids' contents, so a caller rebuilding the array each render does
  // not re-subscribe the observer each render.
  const idsKey = steps.map((s) => s.id).join('|');
  const stepsRef = useRef(steps);
  stepsRef.current = steps;

  useEffect(() => {
    if (props.mode !== 'sections') return;
    const list = stepsRef.current;
    const els = list
      .map((s) => document.getElementById(s.id))
      .filter((el): el is HTMLElement => el !== null);
    if (els.length === 0) return;
    const pick = (): void => {
      // The current section is the last one whose top has passed the line.
      let idx = 0;
      els.forEach((el, i) => {
        if (el.getBoundingClientRect().top - offset <= 1) idx = i;
      });
      // At the very bottom of the page the last section is current even if
      // it is too short to reach the line.
      const doc = document.documentElement;
      if (window.innerHeight + window.scrollY >= doc.scrollHeight - 2) idx = els.length - 1;
      const id = els[idx]?.id;
      const stepIndex = list.findIndex((s) => s.id === id);
      setInView(stepIndex < 0 ? 0 : stepIndex);
    };
    pick();
    // IntersectionObserver wakes the check only when a section crosses the
    // band; no scroll listener runs on every frame.
    const io =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver(pick, {
            rootMargin: `-${offset}px 0px -40% 0px`,
            threshold: [0, 1],
          });
    els.forEach((el) => io?.observe(el));
    window.addEventListener('resize', pick);
    return () => {
      io?.disconnect();
      window.removeEventListener('resize', pick);
    };
  }, [props.mode, idsKey, offset]);

  const current = props.mode === 'wizard' ? props.current : inView;
  const n = steps.length;
  const fill = n > 1 ? Math.min(1, Math.max(0, current / (n - 1))) : 0;

  const clickable = (i: number): boolean => {
    if (props.mode === 'sections') return true;
    const nav = props.navigable ?? 'completed';
    if (nav === 'none' || props.onStepChange === undefined) return false;
    return nav === 'any' ? i !== current : i < current;
  };

  const onStep = (i: number): void => {
    if (props.mode === 'wizard') {
      props.onStepChange?.(i);
      return;
    }
    const step = steps[i];
    const el = step === undefined ? null : document.getElementById(step.id);
    if (el === null) return;
    const top = el.getBoundingClientRect().top + window.scrollY - offset + 8;
    window.scrollTo({ top, behavior: reducedMotion() ? 'auto' : 'smooth' });
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
    el.focus({ preventScroll: true });
  };

  return (
    <div className={clsx('sk-stepper', className)} data-sticky={sticky ? '1' : undefined}>
      <ol
        className="sk-stepper__rail"
        aria-label={label}
        style={{ '--n': n, '--fill': fill } as CSSProperties}
      >
        {steps.map((s, i) => {
          const state = i < current ? 'done' : i === current ? 'current' : 'todo';
          const canClick = clickable(i);
          const inner = (
            <>
              <span className="sk-stepper__node" aria-hidden>
                <span className="sk-stepper__ico">
                  {s.icon ?? <span className="sk-figure">{i + 1}</span>}
                </span>
                <span className="sk-stepper__check">
                  <Check size={16} strokeWidth={3} />
                </span>
              </span>
              <span className="sk-stepper__text">
                <span className="sk-stepper__label">{s.label}</span>
                {s.description !== undefined && (
                  <span className="sk-stepper__desc">{s.description}</span>
                )}
                <span className="sk-stepper__sr">
                  {state === 'done' ? ', completed' : state === 'current' ? ', current step' : ''}
                </span>
              </span>
            </>
          );
          return (
            <li
              key={s.id}
              className="sk-stepper__step"
              data-state={state}
              aria-current={state === 'current' ? 'step' : undefined}
            >
              {canClick ? (
                <button type="button" className="sk-stepper__hit" onClick={() => onStep(i)}>
                  {inner}
                </button>
              ) : (
                <span className="sk-stepper__hit">{inner}</span>
              )}
            </li>
          );
        })}
      </ol>
      {props.mode === 'wizard' && props.children !== undefined && (
        <div key={current} className="sk-stepper__panel">
          {props.children}
        </div>
      )}
    </div>
  );
}
