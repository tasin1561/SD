import type { ReactElement, ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Two marks the invite form still uses (`LiveDot`, `Chip`). The rest of
 * the PRECISION LOGISTICS chrome retired with Phase 6 of the COURIER
 * redesign.
 *
 * They live together in one file on purpose. Each is three lines of
 * markup, and the thing that matters about them is that they AGREE:
 * a chip on the hero and a chip in the manifest must be the same
 * object, or the page reads as several designs stacked. Spread across
 * eight section files they drift within a week — the same argument
 * `BinPolicyService` makes about five call sites each deciding what a
 * flag means.
 */

/* ── Status dot ──────────────────────────────────────────────────────
 * A live indicator is a dot with a ping ring behind it. Both halves are
 * `aria-hidden`: the state is always written beside it in words, never
 * carried by the colour alone.
 */
export function LiveDot({ tone = 'green' }: { tone?: 'green' | 'sky' | 'red' }): ReactElement {
  const fill = tone === 'green' ? 'bg-green' : tone === 'red' ? 'bg-red' : 'bg-accent-fill';
  return (
    <span aria-hidden className="relative inline-flex h-2 w-2 shrink-0">
      <span className={cn('status-ping absolute inline-flex h-full w-full rounded-full', fill)} />
      <span className={cn('status-dot relative inline-flex h-2 w-2 rounded-full', fill)} />
    </span>
  );
}

/* ── Chip ────────────────────────────────────────────────────────────
 * A small tinted mono tag: a status, a count, a verdict. Tones carry a
 * tint, a hairline ring and a foreground computed against that tint —
 * never a fill with an untested label on it.
 */
export type ChipTone = 'neutral' | 'accent' | 'good' | 'warn' | 'bad';

const CHIP_TONE: Record<ChipTone, string> = {
  neutral: 'bg-surface-3 text-fg-muted border-line',
  accent: 'bg-accent-tint text-sky border-accent-line',
  good: 'bg-green-tint text-green border-green-line',
  warn: 'bg-saffron-tint text-saffron border-saffron-line',
  bad: 'bg-red-tint text-red border-red-line',
};

export function Chip({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: ChipTone;
  children: ReactNode;
  className?: string;
}): ReactElement {
  return (
    <span
      className={cn(
        // `whitespace-nowrap` + `shrink-0`: a chip that wraps stops being
        // a chip. In the hero's four-column readout `BEFORE DISPATCH`
        // broke across two lines and dragged the value beside it onto two
        // as well — the strip read as a paragraph rather than a gauge.
        // It keeps its width and the value beside it gives way instead.
        'mono-caps inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-sm border px-2 py-1',
        CHIP_TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
