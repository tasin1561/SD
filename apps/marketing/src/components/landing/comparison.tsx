'use client';

import { motion } from 'framer-motion';
import { Check, X } from 'lucide-react';
import type { ReactElement } from 'react';
import { fadeUp, viewportOnce } from '@/lib/motion';

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
    <section className="bg-surface-2 py-16 lg:py-24">
      <div className="max-w-7xl mx-auto px-5 sm:px-8">
        <motion.div
          initial="hidden"
          whileInView="show"
          viewport={viewportOnce}
          variants={fadeUp}
        >
          <div className="inline-flex items-center gap-2 rounded-full bg-surface border border-line px-3 py-1 text-[11px] font-mono uppercase tracking-wide text-fg-muted">
            Comparison
          </div>
          <h2
            className="mt-4 font-display font-semibold text-fg-strong"
            style={{
              fontSize: 'clamp(1.75rem, 3.5vw, 2.75rem)',
              letterSpacing: '-0.02em',
            }}
          >
            Skydrop vs doing it alone.
          </h2>
        </motion.div>

        <motion.div
          className="mt-10 lg:mt-14"
          initial="hidden"
          whileInView="show"
          viewport={viewportOnce}
          variants={fadeUp}
        >
          {/* Mobile card view */}
          <div className="lg:hidden space-y-4">
            {(['skydrop', 'diy', 'marketplace'] as const).map((col) => (
              <div
                key={col}
                className={
                  col === 'skydrop'
                    ? 'rounded-2xl border p-6'
                    : 'rounded-2xl border border-line bg-surface p-6'
                }
                style={
                  col === 'skydrop'
                    ? {
                        borderColor: 'color-mix(in oklab, var(--sky) 40%, transparent)',
                        background:
                          'color-mix(in oklab, var(--sky) 6%, var(--surface))',
                      }
                    : undefined
                }
              >
                <div
                  className={`font-display text-lg font-semibold mb-4 ${
                    col === 'skydrop' ? 'text-sky-deep' : 'text-fg-strong'
                  }`}
                >
                  {colHeader(col)}
                </div>
                <dl className="space-y-3">
                  {ROWS.map((r) => (
                    <div
                      key={r.label}
                      className="flex items-baseline justify-between gap-4 border-t border-line pt-3"
                    >
                      <dt className="text-sm text-fg-body">{r.label}</dt>
                      <dd className="text-sm font-medium text-fg-strong text-right">
                        <CellRender c={r[col]} highlight={col === 'skydrop'} />
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>

          {/* Desktop table view */}
          <div className="hidden lg:block overflow-hidden rounded-2xl border border-line bg-surface">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left px-6 py-5 font-medium text-fg-muted uppercase tracking-wider text-xs w-1/3">
                    Capability
                  </th>
                  <th
                    className="text-left px-6 py-5"
                    style={{
                      background:
                        'color-mix(in oklab, var(--sky) 6%, var(--surface))',
                      borderLeft:
                        '1px solid color-mix(in oklab, var(--sky) 25%, transparent)',
                      borderRight:
                        '1px solid color-mix(in oklab, var(--sky) 25%, transparent)',
                    }}
                  >
                    <div className="inline-flex items-center gap-2 font-display text-base font-semibold text-sky-deep">
                      <span className="h-2 w-2 rounded-full bg-sky" aria-hidden />
                      Skydrop
                    </div>
                    <div className="mt-0.5 text-[11px] font-normal text-fg-muted">
                      This service
                    </div>
                  </th>
                  <th className="text-left px-6 py-5">
                    <div className="font-display text-base font-semibold text-fg-strong">
                      DIY Indian setup
                    </div>
                    <div className="mt-0.5 text-[11px] font-normal text-fg-muted">
                      Do it yourself
                    </div>
                  </th>
                  <th className="text-left px-6 py-5">
                    <div className="font-display text-base font-semibold text-fg-strong">
                      Marketplace
                    </div>
                    <div className="mt-0.5 text-[11px] font-normal text-fg-muted">
                      Amazon / Flipkart Global
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody className="border-t border-line">
                {ROWS.map((r, i) => (
                  <tr
                    key={r.label}
                    className={i > 0 ? 'border-t border-line' : ''}
                  >
                    <td className="px-6 py-5 text-fg-strong font-medium">
                      {r.label}
                    </td>
                    <td
                      className="px-6 py-5 text-fg-strong"
                      style={{
                        background:
                          'color-mix(in oklab, var(--sky) 4%, transparent)',
                        borderLeft:
                          '1px solid color-mix(in oklab, var(--sky) 15%, transparent)',
                        borderRight:
                          '1px solid color-mix(in oklab, var(--sky) 15%, transparent)',
                      }}
                    >
                      <CellRender c={r.skydrop} highlight />
                    </td>
                    <td className="px-6 py-5 text-fg-strong">
                      <CellRender c={r.diy} />
                    </td>
                    <td className="px-6 py-5 text-fg-strong">
                      <CellRender c={r.marketplace} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>
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
        <Check size={16} className="text-green" aria-hidden="true" />
        <span className={highlight ? 'text-fg-strong font-medium' : 'text-fg-body'}>
          {c.label ?? 'Yes'}
        </span>
      </span>
    );
  }
  if (c.kind === 'no') {
    return (
      <span className="inline-flex items-center gap-2">
        <X size={16} className="text-fg-muted" aria-hidden="true" />
        <span className="text-fg-muted">{c.label ?? 'No'}</span>
      </span>
    );
  }
  return (
    <span className={highlight ? 'text-fg-strong font-medium' : 'text-fg-body'}>
      {c.label}
    </span>
  );
}
