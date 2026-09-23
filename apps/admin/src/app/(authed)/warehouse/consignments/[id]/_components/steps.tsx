'use client';

import { Check } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';

/**
 * One numbered stop on the journey.
 *
 * Numbered because the order is real — a consignment cannot be dispatched
 * before it is counted, or labelled before there is anything to label —
 * which is the one case where numbering encodes something true rather
 * than decorating a list. The number sits in a node that turns solid with
 * a check once the stop is behind the consignment, so the rail reads the
 * same way as the stepper above it.
 */
export function Step({
  n,
  id,
  title,
  state,
  phase = 'todo',
  children,
}: {
  readonly n: number;
  /** The anchor the journey stepper names. */
  readonly id?: string | undefined;
  readonly title: string;
  /** A short factual line: what happened here, or what is waiting. */
  readonly state: ReactNode;
  /** Where the consignment is relative to this stop — presentation only. */
  readonly phase?: 'done' | 'current' | 'todo';
  readonly children?: ReactNode;
}): ReactElement {
  return (
    <section
      id={id}
      className="cns-step"
      data-phase={phase}
      aria-labelledby={id ? `${id}-title` : undefined}
    >
      <span className="cns-step__node" aria-hidden>
        {phase === 'done' ? (
          <Check size={14} strokeWidth={3} />
        ) : (
          <span className="sk-figure">{n}</span>
        )}
      </span>
      <div className="cns-step__body">
        <h3 id={id ? `${id}-title` : undefined} className="cns-step__title">
          {title}
        </h3>
        <p className="cns-step__state">{state}</p>
        {children !== undefined && <div className="cns-step__content">{children}</div>}
      </div>
    </section>
  );
}

/**
 * A counted quantity against what was expected, with the gap stated in
 * words rather than left for the reader to subtract.
 *
 * Short and over are DIFFERENT facts and both are normal — a count moves
 * in either direction and neither blocks anything — so this never renders
 * one as an error.
 */
export function Variance({
  expected,
  counted,
  shortWord = 'short',
  overWord = 'over',
}: {
  readonly expected: number;
  readonly counted: number | null;
  readonly shortWord?: string;
  readonly overWord?: string;
}): ReactElement {
  if (counted === null) {
    return <span className="stk-muted sk-figure">{expected} expected, not yet counted</span>;
  }
  const diff = counted - expected;
  return (
    <span className="sk-figure">
      {counted} of {expected}
      {diff === 0 ? (
        ''
      ) : (
        <span className="stk-tone" data-tone={diff < 0 ? 'bad' : 'warn'}>
          {' '}
          — {Math.abs(diff)} {diff < 0 ? shortWord : overWord}
        </span>
      )}
    </span>
  );
}
