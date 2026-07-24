import { Check, X } from 'lucide-react';
import type { ReactElement } from 'react';
import { Reveal } from '@/lib/reveal';
import { SectionHeader } from './section-header';

/**
 * SEC 05 — MANIFEST. Route options compared like a shipping manifest;
 * Skydrop column phosphor-tinted.
 */

type Cell =
  | { kind: 'text'; label: string }
  | { kind: 'yes'; label?: string }
  | { kind: 'no'; label?: string };

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
    label: 'Capital required',
    skydrop: { kind: 'text', label: 'Pay per order' },
    diy: { kind: 'text', label: '₹50 lakh+' },
    marketplace: { kind: 'text', label: 'Low' },
  },
  {
    label: 'COD call-confirm',
    skydrop: { kind: 'yes' },
    diy: { kind: 'text', label: 'Build it yourself' },
    marketplace: { kind: 'no' },
  },
  {
    label: 'RTO handling',
    skydrop: { kind: 'text', label: 'Inspected + write-back' },
    diy: { kind: 'text', label: 'Your problem' },
    marketplace: { kind: 'text', label: 'Opaque' },
  },
  {
    label: 'Brand & customer data',
    skydrop: { kind: 'text', label: 'Yours' },
    diy: { kind: 'text', label: 'Yours' },
    marketplace: { kind: 'text', label: 'Theirs' },
  },
  {
    label: 'Remittance to Bangladesh',
    skydrop: { kind: 'text', label: 'Built-in' },
    diy: { kind: 'text', label: 'DIY banking' },
    marketplace: { kind: 'text', label: 'Marketplace terms' },
  },
];

export function Comparison(): ReactElement {
  return (
    <section className="bg-surface-2/40 py-20 lg:py-28 border-t border-line">
      <div className="max-w-7xl mx-auto px-5 sm:px-8">
        <SectionHeader
          index="05"
          code="MANIFEST"
          title="Skydrop vs doing it alone."
          sub="Three routes into India, compared line by line."
        />

        <Reveal className="mt-12">
          {/* Mobile card view */}
          <div className="lg:hidden space-y-4">
            {(['skydrop', 'diy', 'marketplace'] as const).map((col) => (
              <div
                key={col}
                className={col === 'skydrop' ? 'rounded-xl border p-6' : 'panel p-6'}
                style={
                  col === 'skydrop'
                    ? {
                        borderColor: 'color-mix(in oklab, var(--sky) 45%, transparent)',
                        background: 'color-mix(in oklab, var(--sky) 7%, var(--surface-2))',
                      }
                    : undefined
                }
              >
                <div className="flex items-baseline justify-between">
                  <div
                    className={`font-display text-lg font-semibold ${
                      col === 'skydrop' ? 'text-sky' : 'text-fg-strong'
                    }`}
                  >
                    {colHeader(col)}
                  </div>
                  <span className="telemetry text-fg-muted">
                    {col === 'skydrop' ? 'RTE A' : col === 'diy' ? 'RTE B' : 'RTE C'}
                  </span>
                </div>
                <dl className="mt-4 space-y-3">
                  {ROWS.map((r) => (
                    <div
                      key={r.label}
                      className="flex items-baseline justify-between gap-4 border-t border-line pt-3"
                    >
                      <dt className="text-sm text-fg-body">{r.label}</dt>
                      <dd className="text-sm font-medium text-fg-strong text-right m-0">
                        <CellRender c={r[col]} highlight={col === 'skydrop'} />
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>

          {/* Desktop manifest table */}
          <div className="hidden lg:block overflow-hidden rounded-xl border border-line bg-surface-2">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line">
                  <th className="text-left px-6 py-5 telemetry text-fg-muted w-1/3">
                    capability
                  </th>
                  <th
                    className="text-left px-6 py-5"
                    style={{
                      background: 'color-mix(in oklab, var(--sky) 7%, transparent)',
                      borderLeft: '1px solid color-mix(in oklab, var(--sky) 30%, transparent)',
                      borderRight: '1px solid color-mix(in oklab, var(--sky) 30%, transparent)',
                    }}
                  >
                    <div className="flex items-center gap-2 font-display text-base font-semibold text-sky">
                      <span aria-hidden className="status-dot h-1.5 w-1.5 rounded-full bg-sky" />
                      Skydrop
                    </div>
                    <div className="telemetry mt-1 text-fg-muted">rte a · this service</div>
                  </th>
                  <th className="text-left px-6 py-5">
                    <div className="font-display text-base font-semibold text-fg-strong">
                      DIY Indian setup
                    </div>
                    <div className="telemetry mt-1 text-fg-muted">rte b</div>
                  </th>
                  <th className="text-left px-6 py-5">
                    <div className="font-display text-base font-semibold text-fg-strong">
                      Marketplace
                    </div>
                    <div className="telemetry mt-1 text-fg-muted">rte c</div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map((r, i) => (
                  <tr
                    key={r.label}
                    className={`stagger-row stagger-row-${i + 1}${i > 0 ? ' border-t border-line' : ''}`}
                  >
                    <td className="px-6 py-4.5 text-fg-strong font-medium">{r.label}</td>
                    <td
                      className="px-6 py-4.5 text-fg-strong"
                      style={{
                        background: 'color-mix(in oklab, var(--sky) 4%, transparent)',
                        borderLeft: '1px solid color-mix(in oklab, var(--sky) 18%, transparent)',
                        borderRight: '1px solid color-mix(in oklab, var(--sky) 18%, transparent)',
                      }}
                    >
                      <CellRender c={r.skydrop} highlight />
                    </td>
                    <td className="px-6 py-4.5">
                      <CellRender c={r.diy} />
                    </td>
                    <td className="px-6 py-4.5">
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

function colHeader(col: 'skydrop' | 'diy' | 'marketplace'): string {
  if (col === 'skydrop') return 'Skydrop';
  if (col === 'diy') return 'DIY Indian setup';
  return 'Marketplace';
}

function CellRender({ c, highlight }: { c: Cell; highlight?: boolean }): ReactElement {
  if (c.kind === 'yes') {
    return (
      <span className="inline-flex items-center gap-2">
        <Check size={15} className="text-green" aria-hidden="true" />
        <span className={highlight ? 'text-fg-strong font-medium' : 'text-fg-body'}>
          {c.label ?? 'Yes'}
        </span>
      </span>
    );
  }
  if (c.kind === 'no') {
    return (
      <span className="inline-flex items-center gap-2">
        <X size={15} className="text-fg-muted" aria-hidden="true" />
        <span className="text-fg-muted">{c.label ?? 'No'}</span>
      </span>
    );
  }
  return (
    <span className={highlight ? 'text-fg-strong font-medium' : 'text-fg-body'}>{c.label}</span>
  );
}
