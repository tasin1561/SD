import type { ReactElement, ReactNode } from 'react';
import { Reveal } from '@/lib/reveal';
import { cn } from '@/lib/cn';

/**
 * PRECISION LOGISTICS chrome — the handful of marks every section on
 * this page is assembled from.
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

/* ── Section eyebrow ─────────────────────────────────────────────────
 * `SEC 02 // DIAGNOSTICS` in a bordered chip with a live dot. This is
 * the page's spine: it tells you where you are in a long scroll without
 * a nav that follows you down it.
 */
export function Eyebrow({
  index,
  code,
  tone = 'neutral',
}: {
  index: string;
  code: string;
  // `| undefined` explicitly: the project runs `exactOptionalPropertyTypes`,
  // so an optional prop that is FORWARDED from another optional (SectionHead
  // passes its own `tone` straight through) has to admit undefined by type,
  // not merely by absence.
  tone?: ChipTone | undefined;
}): ReactElement {
  return (
    <span
      className={cn(
        'mono-caps inline-flex items-center gap-2 rounded-sm border px-2.5 py-1.5',
        tone === 'neutral' ? 'border-line bg-surface-band text-fg-muted' : CHIP_TONE[tone],
      )}
    >
      <LiveDot tone={tone === 'bad' ? 'red' : tone === 'accent' ? 'sky' : 'green'} />
      <span className="text-fg-strong">SEC {index}</span>
      <span aria-hidden className="text-fg-faint">
        {'//'}
      </span>
      <span>{code}</span>
    </span>
  );
}

/* ── Section header block ────────────────────────────────────────────
 * Eyebrow + optional right-hand chip, then a 12-column split of
 * headline against an optional spec box. The bottom hairline is what
 * turns a heading into a header BAR — the single cheapest mark for
 * making a marketing page read as an instrument.
 */
export function SectionHead({
  index,
  code,
  tone,
  flag,
  title,
  sub,
  aside,
}: {
  index: string;
  code: string;
  tone?: ChipTone;
  flag?: ReactNode;
  title: string;
  sub?: string;
  aside?: ReactNode;
}): ReactElement {
  return (
    <Reveal className="border-b border-line pb-7 mb-9">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <Eyebrow index={index} code={code} tone={tone} />
        {flag}
      </div>
      <div className="grid gap-5 lg:grid-cols-12 lg:items-end">
        <div className={aside ? 'lg:col-span-8' : 'lg:col-span-9'}>
          <h2
            className="text-fg-strong"
            style={{
              fontSize: 'clamp(1.75rem, 3.4vw, 2.5rem)',
              letterSpacing: '-0.025em',
              lineHeight: 1.12,
            }}
          >
            {title}
          </h2>
          {sub ? (
            <p className="mt-3 max-w-3xl text-[15px] leading-relaxed text-fg-body">{sub}</p>
          ) : null}
        </div>
        {aside ? <div className="lg:col-span-4 lg:flex lg:justify-end">{aside}</div> : null}
      </div>
    </Reveal>
  );
}

/* ── Spec box ────────────────────────────────────────────────────────
 * The small bordered "label over value" block that sits at the end of a
 * header row. Mono both ways, because both halves are reference data.
 */
export function SpecBox({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}): ReactElement {
  return (
    <div
      className={cn(
        'w-full rounded-sm border border-line bg-surface-band px-3.5 py-3 lg:w-auto',
        className,
      )}
    >
      <div className="mono-caps text-fg-faint">{label}</div>
      <div className="figure-mono mt-1 text-[13px] font-semibold text-fg-strong">{value}</div>
    </div>
  );
}

/* ── Data strip ──────────────────────────────────────────────────────
 * A row of readouts in one bordered container, divided by hairlines
 * rather than separated by gaps. The gap version reads as three cards;
 * the divided version reads as one instrument with three gauges, which
 * is the whole difference between this design and a card grid.
 *
 * `divide-y md:divide-y-0 md:divide-x` is what makes it stack on a
 * phone without any of the cells changing.
 */
export function DataStrip({
  items,
  columns = 3,
}: {
  items: { label: string; value: string; chip?: ReactNode }[];
  columns?: 2 | 3 | 4;
}): ReactElement {
  const cols =
    columns === 2 ? 'md:grid-cols-2' : columns === 4 ? 'md:grid-cols-4' : 'md:grid-cols-3';
  return (
    <div
      className={cn(
        'grid grid-cols-1 divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface-2 md:divide-x md:divide-y-0',
        cols,
      )}
    >
      {items.map((it) => (
        <div key={it.label} className="flex items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <div className="mono-caps text-fg-faint">{it.label}</div>
            <div className="figure-mono mt-1 text-[17px] font-semibold text-fg-strong">
              {it.value}
            </div>
          </div>
          {it.chip}
        </div>
      ))}
    </div>
  );
}

/* ── Cluster ─────────────────────────────────────────────────────────
 * A titled panel holding hairline-divided cells. The header bar sits a
 * surface step above its own body, which is what stops a long page of
 * panels reading as an undifferentiated stack.
 */
export function Cluster({
  title,
  meta,
  icon,
  children,
  className,
}: {
  title: string;
  meta?: string;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}): ReactElement {
  return (
    <div className={cn('overflow-hidden rounded-lg border border-line bg-surface-2', className)}>
      <div className="panel-head flex flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-2">
          {icon ? (
            <span aria-hidden className="shrink-0 text-sky">
              {icon}
            </span>
          ) : null}
          <span className="mono-caps text-fg-strong">{title}</span>
        </div>
        {meta ? <span className="mono-caps text-fg-faint">{meta}</span> : null}
      </div>
      {children}
    </div>
  );
}
