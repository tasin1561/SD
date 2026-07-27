import { Database, Truck, RotateCcw, BarChart3, Building2, type LucideIcon } from 'lucide-react';
import type { ReactElement } from 'react';
import { Reveal } from '@/lib/reveal';
import { TiltPanel } from '@/lib/tilt';
import { SectionHeader } from './section-header';
import { Counter } from './counter';
import { CallLog } from './call-log';

/**
 * SEC 04 — INSTRUMENTS. Bento: one signature cell (call-confirm, with
 * a live outcome log + RTO counters) and five instrument cells.
 */

interface Cell {
  icon: LucideIcon;
  title: string;
  body: string;
}

const CELLS: Cell[] = [
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
    <section id="why-skydrop" className="bg-surface py-20 lg:py-28 border-t border-line">
      <div className="max-w-7xl mx-auto px-5 sm:px-8">
        <SectionHeader
          index="04"
          code="INSTRUMENTS"
          title="Built specifically for the BD → IN lane."
          sub="Not a generic aggregator with a corridor bolted on — every instrument below exists because this lane demands it."
        />

        <div className="persp mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
          {/* Signature cell — subtle tilt + pointer glow */}
          <Reveal className="sm:col-span-2 lg:col-span-4 lg:row-span-3">
            <TiltPanel max={2.5} className="h-full">
              <div className="panel ticks relative overflow-hidden p-7 lg:p-9 h-full">
                <div
                  aria-hidden
                  className="pointer-events-none absolute -right-28 -top-28 h-72 w-72 rounded-full"
                  style={{
                    background: 'radial-gradient(closest-side, var(--glow), transparent)',
                    opacity: 0.55,
                  }}
                />

                <div className="relative flex flex-col h-full">
                  <span className="telemetry text-sky">signature instrument</span>
                  <h3 className="mt-5 font-display text-2xl lg:text-3xl font-semibold text-fg-strong leading-tight tracking-tight">
                    Every COD order confirmed by phone.
                  </h3>
                  <p className="mt-3 text-[15px] text-fg-body max-w-[44ch]">
                    Agents log every attempt. Unreachable orders are held at NDR — they never
                    dispatch. The single biggest lever on RTO, and the one nobody else bothers to
                    pull.
                  </p>

                  <div className="mt-6">
                    <CallLog />
                  </div>

                  <div className="mt-auto pt-8 grid grid-cols-2 gap-6">
                    <div>
                      <div className="telemetry text-fg-muted mb-2">skydrop target</div>
                      <div className="font-mono text-4xl lg:text-5xl text-sky tracking-tight">
                        &lt;
                        <Counter to={15} suffix="%" />
                      </div>
                      <div className="mt-1 text-xs text-fg-muted">RTO rate</div>
                    </div>
                    <div>
                      <div className="telemetry text-fg-muted mb-2">industry</div>
                      <div className="font-mono text-4xl lg:text-5xl text-fg-muted/60 tracking-tight">
                        <Counter to={40} suffix="%+" />
                      </div>
                      <div className="mt-1 text-xs text-fg-muted">without call-confirm</div>
                    </div>
                  </div>
                </div>
                <div aria-hidden className="glow-follow" />
              </div>
            </TiltPanel>
          </Reveal>

          {/* Instrument cells */}
          {CELLS.map((c, i) => {
            const Icon = c.icon;
            return (
              <Reveal
                key={c.title}
                delay={(i + 1) * 60}
                className={`group panel tilt-card p-6 hover:border-line-strong ${
                  i < 3 ? 'lg:col-span-2' : 'lg:col-span-3'
                }`}
              >
                <div className="flex items-center gap-4 h-full">
                  <div className="shrink-0 inline-flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-surface-3 text-sky">
                    <Icon size={18} aria-hidden="true" />
                  </div>
                  <div>
                    <h3 className="font-display text-base font-semibold text-fg-strong mb-1.5">
                      {c.title}
                    </h3>
                    <p className="text-sm text-fg-body leading-relaxed">{c.body}</p>
                  </div>
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
