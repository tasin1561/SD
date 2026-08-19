'use client';

import type { ReactElement, ReactNode } from 'react';

/**
 * One numbered stop on the journey.
 *
 * Numbered because the order is real — a consignment cannot be dispatched
 * before it is counted, or labelled before there is anything to label —
 * which is the one case where numbering encodes something true rather
 * than decorating a list.
 */
export function Step({
  n,
  title,
  state,
  children,
}: {
  readonly n: number;
  readonly title: string;
  /** A short factual line: what happened here, or what is waiting. */
  readonly state: ReactNode;
  readonly children?: ReactNode;
}): ReactElement {
  return (
    <section className="border-border-subtle border-t py-4 first:border-t-0">
      <div className="flex items-start gap-3">
        <span className="text-text-muted mt-0.5 font-mono text-xs tabular-nums">
          {String(n).padStart(2, '0')}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-text-bright text-sm font-medium">{title}</h3>
          <p className="text-text-muted mt-0.5 text-sm">{state}</p>
          {children !== undefined && <div className="mt-3">{children}</div>}
        </div>
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
    return (
      <span className="text-text-muted tabular-nums">{expected} expected, not yet counted</span>
    );
  }
  const diff = counted - expected;
  return (
    <span className="tabular-nums">
      {counted} of {expected}
      {diff === 0 ? (
        ''
      ) : (
        <span
          // Arbitrary-value token reference, the same shape feedback.tsx
          // uses. Not a hardcoded hex (FE-6) — the value still comes from
          // tokens.css and follows the theme.
          className={
            diff < 0 ? 'text-[var(--status-failed-fg)]' : 'text-[var(--status-pending-fg)]'
          }
        >
          {' '}
          — {Math.abs(diff)} {diff < 0 ? shortWord : overWord}
        </span>
      )}
    </span>
  );
}
