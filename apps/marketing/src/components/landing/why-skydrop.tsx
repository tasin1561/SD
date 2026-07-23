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
    title: 'Delhivery + backup couriers',
    body: 'API-primary; non-serviceable PINs quietly re-routed.',
  },
  {
    icon: RotateCcw,
    title: 'Transparent RTO',
    body: 'Returns inspected; restock or write-off is your call, per item.',
  },
  {
    icon: BarChart3,
    title: 'Operational reports',
    body: 'Confirm-rate, NDR-rate, RTO-rate, dispatch times — the numbers you need.',
  },
  {
    icon: Building2,
    title: 'You stay in Bangladesh',
    body: 'No Indian office, staff, or GST registration to start.',
  },
];

export function WhySkydrop(): ReactElement {
  return (
    <section id="why-skydrop" className="bg-surface py-16 lg:py-24">
      <div className="max-w-7xl mx-auto px-5 sm:px-8">
        <motion.div
          initial="hidden"
          whileInView="show"
          viewport={viewportOnce}
          variants={fadeUp}
        >
          <div className="inline-flex items-center gap-2 rounded-full bg-surface-2 border border-line px-3 py-1 text-[11px] font-mono uppercase tracking-wide text-fg-muted">
            Why Skydrop
          </div>
          <h2
            className="mt-4 font-display font-semibold text-fg-strong"
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
          {/* SIGNATURE cell — intentionally dark accent in both themes */}
          <motion.div
            variants={fadeUp}
            className="sm:col-span-2 lg:col-span-2 lg:row-span-2 relative overflow-hidden rounded-2xl p-8 lg:p-10"
            style={{
              background: 'var(--ink)',
              color: 'var(--white)',
              border: '1px solid rgba(255,255,255,0.08)',
            }}
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
              <div className="inline-flex items-center gap-2 self-start rounded-full border border-white/10 px-3 py-1 text-[10px] font-mono uppercase tracking-wide text-sky">
                Signature capability
              </div>
              <h3
                className="mt-6 font-display text-2xl lg:text-3xl font-semibold leading-tight tracking-tight"
                style={{ color: 'var(--white)' }}
              >
                Every COD order confirmed by phone.
              </h3>
              <p
                className="mt-4 text-[15px] max-w-[38ch]"
                style={{ color: 'var(--muted-dark)' }}
              >
                Agents log every attempt. Unreachable orders never dispatch.
                The single biggest lever on RTO — and the one nobody else
                bothers to pull.
              </p>

              <div className="mt-auto pt-10 grid grid-cols-2 gap-6">
                <div>
                  <div
                    className="text-[11px] uppercase tracking-wider mb-2"
                    style={{ color: 'var(--muted-dark)' }}
                  >
                    Skydrop target
                  </div>
                  <div className="font-mono text-4xl lg:text-5xl text-sky tracking-tight">
                    &lt;<Counter to={15} suffix="%" />
                  </div>
                  <div className="mt-1 text-xs" style={{ color: 'var(--muted-dark)' }}>
                    RTO rate
                  </div>
                </div>
                <div>
                  <div
                    className="text-[11px] uppercase tracking-wider mb-2"
                    style={{ color: 'var(--muted-dark)' }}
                  >
                    Industry
                  </div>
                  <div
                    className="font-mono text-4xl lg:text-5xl tracking-tight"
                    style={{ color: 'rgba(148,163,184,0.5)' }}
                  >
                    <Counter to={40} suffix="%+" />
                  </div>
                  <div className="mt-1 text-xs" style={{ color: 'var(--muted-dark)' }}>
                    without call-confirm
                  </div>
                </div>
              </div>
            </div>
          </motion.div>

          {/* 5 standard cells — theme-aware */}
          {STANDARD.map((c) => {
            const Icon = c.icon;
            return (
              <motion.div
                key={c.title}
                variants={fadeUp}
                className="group rounded-2xl bg-surface-2 border border-line p-6 transition-shadow duration-150 hover:shadow-lg"
              >
                <div className="flex items-start gap-4 h-full">
                  <div className="shrink-0 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-surface-3 border border-line text-sky">
                    <Icon size={19} aria-hidden="true" />
                  </div>
                  <div>
                    <h3 className="font-display text-base font-semibold text-fg-strong mb-1.5">
                      {c.title}
                    </h3>
                    <p className="text-sm text-fg-muted leading-relaxed">
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
