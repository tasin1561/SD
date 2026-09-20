import { Check, Minus, X } from 'lucide-react';
import type { ReactElement } from 'react';
import { Reveal } from '@/lib/reveal';
import { Chip, SectionHead, SpecBox } from './chrome';

/**
 * SEC 05 — MANIFEST.
 *
 * Three routes into India, compared line by line. The Skydrop column is
 * tinted and the tint runs the full height of the table, header
 * included, so the eye tracks one column down rather than reading nine
 * rows three times.
 *
 * Below `lg` the table becomes three route CARDS rather than a
 * horizontally scrolling table. A four-column table at 360px is either
 * unreadable or a sideways scroll nobody discovers; the card keeps
 * every value attached to the label it belongs to.
 */

type Cell =
  | { kind: 'text'; label: string }
  | { kind: 'yes'; label?: string }
  | { kind: 'no'; label?: string }
  | { kind: 'partial'; label: string };

interface Row {
  label: string;
  skydrop: Cell;
  diy: Cell;
  marketplace: Cell;
}

const ROWS: Row[] = [
  {
    label: 'Time to first dispatch',
    skydrop: { kind: 'text', label: '< 3 weeks' },
    diy: { kind: 'text', label: '6+ months' },
    marketplace: { kind: 'text', label: '1–2 months' },
  },
  {
    label: 'Capital before order one',
    skydrop: { kind: 'text', label: 'Pay per order' },
    diy: { kind: 'text', label: '₹50 lakh+' },
    marketplace: { kind: 'text', label: 'Low' },
  },
  {
    label: 'Indian entity required',
    skydrop: { kind: 'no', label: 'Not to start' },
    diy: { kind: 'yes', label: 'Yes' },
    marketplace: { kind: 'partial', label: 'Varies' },
  },
  {
    label: 'COD confirmed by phone',
    skydrop: { kind: 'yes', label: 'Every order' },
    diy: { kind: 'partial', label: 'Build the desk' },
    marketplace: { kind: 'no', label: 'No' },
  },
  {
    label: 'Stock held in India',
    skydrop: { kind: 'yes', label: 'Our warehouse' },
    diy: { kind: 'partial', label: 'Lease and staff it' },
    marketplace: { kind: 'partial', label: 'Their terms' },
  },
  {
    label: 'Returns handling',
    skydrop: { kind: 'text', label: 'Inspected, per item' },
    diy: { kind: 'text', label: 'Yours to solve' },
    marketplace: { kind: 'text', label: 'Limited visibility' },
  },
  {
    label: 'Brand and customer data',
    skydrop: { kind: 'text', label: 'Yours' },
    diy: { kind: 'text', label: 'Yours' },
    marketplace: { kind: 'text', label: 'Theirs' },
  },
  {
    label: 'Money back to Bangladesh',
    skydrop: { kind: 'text', label: 'Built in' },
    diy: { kind: 'text', label: 'Arrange it yourself' },
    marketplace: { kind: 'text', label: 'Marketplace terms' },
  },
];

const COLS = [
  { key: 'skydrop', name: 'Skydrop', code: 'route a', note: 'this service' },
  { key: 'diy', name: 'Do it yourself', code: 'route b', note: 'own Indian entity' },
  { key: 'marketplace', name: 'Marketplace', code: 'route c', note: 'sell on theirs' },
] as const;

export function Comparison(): ReactElement {
  return (
    <section id="manifest" className="border-t border-line bg-surface-band py-16 lg:py-24">
      <div className="mx-auto max-w-7xl px-5 sm:px-6">
        <SectionHead
          index="05"
          code="manifest"
          flag={<Chip>3 routes compared</Chip>}
          title="Skydrop, on your own, or on a marketplace."
          sub="The same eight questions asked of all three routes. Where a figure is an estimate rather than something we measure, it says so."
          aside={<SpecBox label="basis" value="typical BD seller · category agnostic" />}
        />

        {/* Mobile / tablet: one card per route. */}
        <Reveal className="space-y-4 lg:hidden">
          {COLS.map((col) => {
            const primary = col.key === 'skydrop';
            return (
              <div
                key={col.key}
                className="overflow-hidden rounded-lg border bg-surface-2"
                style={{
                  borderColor: primary ? 'var(--accent-line)' : 'var(--line)',
                }}
              >
                <div
                  className="flex items-center justify-between gap-3 border-b px-4 py-3"
                  style={{
                    background: primary ? 'var(--accent-tint)' : 'var(--surface-3)',
                    borderColor: primary ? 'var(--accent-line)' : 'var(--line)',
                  }}
                >
                  <div className="min-w-0">
                    <div
                      className={`text-[15px] font-bold ${primary ? 'text-sky' : 'text-fg-strong'}`}
                    >
                      {col.name}
                    </div>
                    <div className="mono-caps mt-0.5 text-fg-muted">{col.note}</div>
                  </div>
                  <Chip tone={primary ? 'accent' : 'neutral'} className="shrink-0">
                    {col.code}
                  </Chip>
                </div>
                <dl className="m-0 divide-y divide-line">
                  {ROWS.map((r) => (
                    <div
                      key={r.label}
                      className="flex items-baseline justify-between gap-4 px-4 py-2.5"
                    >
                      <dt className="min-w-0 text-[13px] text-fg-muted">{r.label}</dt>
                      <dd className="m-0 shrink-0 text-right text-[13px] font-medium">
                        <CellRender c={r[col.key]} highlight={primary} />
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            );
          })}
        </Reveal>

        {/* Desktop: the manifest table. */}
        <Reveal className="hidden lg:block">
          <div className="overflow-hidden rounded-lg border border-line bg-surface-2">
            <table className="w-full border-collapse text-left text-[14px]">
              <caption className="sr-only">
                Skydrop compared with building your own Indian operation and with selling on an
                Indian marketplace
              </caption>
              <thead>
                <tr className="panel-head">
                  <th scope="col" className="mono-caps w-[26%] px-5 py-4 text-fg-faint">
                    capability
                  </th>
                  {COLS.map((col) => {
                    const primary = col.key === 'skydrop';
                    return (
                      <th
                        key={col.key}
                        scope="col"
                        className="px-5 py-4 align-top"
                        style={
                          primary
                            ? {
                                background: 'var(--accent-tint)',
                                borderLeft: '1px solid var(--accent-line)',
                                borderRight: '1px solid var(--accent-line)',
                              }
                            : undefined
                        }
                      >
                        <div
                          className={`text-[15px] font-bold ${
                            primary ? 'text-sky' : 'text-fg-strong'
                          }`}
                        >
                          {col.name}
                        </div>
                        <div className="mono-caps mt-1 text-fg-muted">
                          {col.code} · {col.note}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {ROWS.map((r) => (
                  <tr key={r.label} className="border-t border-line">
                    <th scope="row" className="px-5 py-3.5 text-[14px] font-medium text-fg-strong">
                      {r.label}
                    </th>
                    <td
                      className="px-5 py-3.5"
                      style={{
                        background: 'var(--accent-tint)',
                        borderLeft: '1px solid var(--accent-line)',
                        borderRight: '1px solid var(--accent-line)',
                      }}
                    >
                      <CellRender c={r.skydrop} highlight />
                    </td>
                    <td className="px-5 py-3.5">
                      <CellRender c={r.diy} />
                    </td>
                    <td className="px-5 py-3.5">
                      <CellRender c={r.marketplace} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/**
 * A verdict is never carried by colour alone: each icon sits beside its
 * own word, and the icon itself is `aria-hidden` so a screen reader
 * reads the label once rather than announcing a decorative tick.
 */
function CellRender({ c, highlight }: { c: Cell; highlight?: boolean }): ReactElement {
  const strong = highlight ? 'font-semibold text-fg-strong' : 'text-fg-body';

  if (c.kind === 'yes') {
    return (
      <span className="inline-flex items-center justify-end gap-1.5 lg:justify-start">
        <Check size={14} className="shrink-0 text-green" aria-hidden="true" />
        <span className={strong}>{c.label ?? 'Yes'}</span>
      </span>
    );
  }
  if (c.kind === 'no') {
    return (
      <span className="inline-flex items-center justify-end gap-1.5 lg:justify-start">
        <X size={14} className="shrink-0 text-fg-faint" aria-hidden="true" />
        <span className={highlight ? 'font-semibold text-fg-strong' : 'text-fg-muted'}>
          {c.label ?? 'No'}
        </span>
      </span>
    );
  }
  if (c.kind === 'partial') {
    return (
      <span className="inline-flex items-center justify-end gap-1.5 lg:justify-start">
        <Minus size={14} className="shrink-0 text-saffron" aria-hidden="true" />
        <span className={highlight ? 'font-semibold text-fg-strong' : 'text-fg-muted'}>
          {c.label}
        </span>
      </span>
    );
  }
  return <span className={strong}>{c.label}</span>;
}
