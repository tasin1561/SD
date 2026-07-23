'use client';

import { motion } from 'framer-motion';
import {
  Database,
  Truck,
  RotateCcw,
  BarChart3,
  Building2,
  type LucideIcon,
} from 'lucide-react';
import type { ReactElement } from 'react';
import { fadeUp, staggerContainer, viewportOnce } from '@/lib/motion';
import { Counter } from './counter';

interface Cell {
  icon: LucideIcon;
  title: string;
  body: string;
}

const STANDARD: Cell[] = [
  {
    icon: Database,
    title: 'A real WMS, not a spreadsheet',
    body: 'Bins, batches, append-only stock ledger, low-stock alerts.',
  },
  {
    icon: Truck,
    title: 'Delhivery + backups',
    body: 'API-primary; non-serviceable PINs quietly re-routed.',
  },
  {
    icon: RotateCcw,
    title: 'Transparent RTO',
    body: 'Returns inspected; restock or write-off is your call.',
  },
  {
    icon: BarChart3,
    title: 'Operational reports',
    body: 'Confirm-rate, NDR-rate, RTO-rate, dispatch times.',
  },
  {
    icon: Building2,
    title: 'You stay in BD',
    body: 'No Indian office, staff, or GST registration to start.',
  },
];

/**
 * Bento layout (desktop, lg+): 3-col × 3-row grid.
 *   ┌────────────────┬─────┐
 *   │                │  1  │
 *   │    LARGE       ├─────┤
 *   │ (call-confirm) │  2  │
 *   ├─────┬─────┬────┴─────┤
 *   │  3  │  4  │    5     │
 *   └─────┴─────┴──────────┘
 * Auto-flow places the standard cells around the row-span/col-span
 * large one. Mobile: single-column stack.
 */
export function WhySkydrop(): ReactElement {
  return (
    <section id="why-skydrop" className="bg-paper py-16 lg:py-24">
      <div className="max-w-7xl mx-auto px-5 sm:px-8">
        <motion.div
          initial="hidden"
          whileInView="show"
          viewport={viewportOnce}
          variants={fadeUp}
        >
          <div className="inline-flex items-center gap-2 rounded-full bg-white border border-border-light px-3 py-1 text-[11px] font-mono uppercase tracking-wide text-muted">
            Why Skydrop
          </div>
          <h2
            className="mt-4 font-display font-semibold text-ink"
            style={{
              fontSize: 'clamp(1.75rem, 3.5vw, 2.75rem)',
              letterSpacing: '-0.02em',
            }}
          >
            Built specifically for the BD → IN lane.
          </h2>
        </motion.div>

        <motion.div
          className="mt-10 lg:mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 lg:auto-rows-fr"
          initial="hidden"
          whileInView="show"
          viewport={viewportOnce}
          variants={staggerContainer}
        >
          {/* Large hero cell */}
          <motion.div
            variants={fadeUp}
            className="sm:col-span-2 lg:col-span-2 lg:row-span-2 relative overflow-hidden rounded-2xl bg-ink text-white p-8 lg:p-10 border border-[var(--border-dark)]"
          >
            <div
              aria-hidden
              className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full blur-3xl opacity-40"
              style={{
                background:
                  'radial-gradient(closest-side, rgba(56,189,248,0.6), transparent)',
              }}
            />

            <div className="relative flex flex-col h-full">
              <div className="inline-flex items-center gap-2 self-start rounded-full border border-[var(--border-dark)] px-3 py-1 text-[10px] font-mono uppercase tracking-wide text-sky">
                Signature capability
              </div>
              <h3 className="mt-6 font-display text-2xl lg:text-3xl font-semibold text-white leading-tight tracking-tight">
                Call-confirmed COD orders — every single one.
              </h3>
              <p className="mt-4 text-[15px] text-[var(--muted-dark)] max-w-[38ch]">
                Agents log every attempt; unreachable orders never dispatch.
                The single biggest lever on RTO.
              </p>

              <div className="mt-auto pt-10 grid grid-cols-2 gap-6">
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-[var(--muted-dark)] mb-2">
                    Skydrop target
                  </div>
                  <div className="font-mono text-4xl lg:text-5xl text-sky tracking-tight">
                    &lt;<Counter to={15} suffix="%" />
                  </div>
                  <div className="mt-1 text-xs text-[var(--muted-dark)]">
                    RTO rate
                  </div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-[var(--muted-dark)] mb-2">
                    Industry
                  </div>
                  <div className="font-mono text-4xl lg:text-5xl text-[var(--muted-dark)]/50 tracking-tight">
                    <Counter to={40} suffix="%+" />
                  </div>
                  <div className="mt-1 text-xs text-[var(--muted-dark)]">
                    without call-confirm
                  </div>
                </div>
              </div>
            </div>
          </motion.div>

          {/* 5 standard cells — auto-flow into the remaining slots */}
          {STANDARD.map((c) => {
            const Icon = c.icon;
            return (
              <motion.div
                key={c.title}
                variants={fadeUp}
                className="group rounded-2xl bg-white border border-border-light p-6 transition-shadow duration-150 hover:shadow-lg"
              >
                <div className="flex items-start gap-4 h-full">
                  <div className="shrink-0 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-ink text-sky">
                    <Icon size={19} aria-hidden="true" />
                  </div>
                  <div>
                    <h3 className="font-display text-base font-semibold text-ink mb-1.5">
                      {c.title}
                    </h3>
                    <p className="text-sm text-muted leading-relaxed">
                      {c.body}
                    </p>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </motion.div>
      </div>
    </section>
  );
}
