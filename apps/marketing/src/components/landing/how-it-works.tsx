import { PackageOpen, PhoneCall, Truck, MapPinned, type LucideIcon } from 'lucide-react';
import type { ReactElement } from 'react';
import { Reveal } from '@/lib/reveal';
import { SectionHeader } from './section-header';

/**
 * SEC 03 — FLIGHT PLAN. Four phases on a corridor rail; the desktop
 * rail draws in via the CSS .rail-draw transition when its Reveal
 * wrapper flips data-shown.
 */

interface Phase {
  n: string;
  icon: LucideIcon;
  title: string;
  body: string;
}

const PHASES: Phase[] = [
  {
    n: 'PHASE 01',
    icon: PackageOpen,
    title: 'Ship stock once',
    body: 'You send inventory to our Indian warehouse. We receive it into a real WMS — bin-level, batch, FIFO/FEFO.',
  },
  {
    n: 'PHASE 02',
    icon: PhoneCall,
    title: 'We confirm by phone',
    body: 'Every buyer gets a call before dispatch. No answer → re-attempted; unreachable → NDR-routed, never shipped blind.',
  },
  {
    n: 'PHASE 03',
    icon: Truck,
    title: 'Pick, pack, dispatch',
    body: 'Confirmed orders ship through Delhivery’s API. Non-serviceable PINs hand off to a backup courier automatically.',
  },
  {
    n: 'PHASE 04',
    icon: MapPinned,
    title: 'Tracked to the door',
    body: 'Webhook tracking, public AWB lookup for your buyers, inspected RTOs with transparent stock write-back.',
  },
];

export function HowItWorks(): ReactElement {
  return (
    <section id="how-it-works" className="relative bg-surface-2/40 py-20 lg:py-28 border-t border-line overflow-hidden">
      <div aria-hidden className="console-grid absolute inset-0 opacity-60" />
      <div className="relative max-w-7xl mx-auto px-5 sm:px-8">
        <SectionHeader
          index="03"
          code="FLIGHT PLAN"
          title="Four phases, end-to-end."
          sub="One corridor, fully instrumented — from your first stock shipment to COD hitting your ledger."
        />

        <Reveal className="mt-14 relative">
          {/* Mobile vertical rail */}
          <div aria-hidden className="lg:hidden absolute left-[21px] top-1 bottom-1 w-px bg-line-strong" />
          {/* Desktop horizontal rail — draws when parent reveals */}
          <div aria-hidden className="hidden lg:block absolute top-[21px] left-0 right-0 h-px bg-line">
            <div
              className="rail-draw h-full"
              style={{
                background:
                  'linear-gradient(90deg, var(--sky), color-mix(in oklab, var(--green) 70%, transparent))',
              }}
            />
          </div>

          <ol className="grid gap-10 lg:gap-6 lg:grid-cols-4 list-none p-0 m-0">
            {PHASES.map((p, i) => {
              const Icon = p.icon;
              const last = i === PHASES.length - 1;
              return (
                <Reveal as="li" key={p.n} delay={i * 60} className="relative pl-14 lg:pl-0">
                  <div className="absolute left-0 top-0 lg:relative lg:mb-6">
                    <div
                      className={`phase-node phase-node-${i + 1} inline-flex h-[42px] w-[42px] items-center justify-center rounded-xl border bg-surface-2 ${
                        last ? 'border-green/50 text-green' : 'border-line-strong text-sky'
                      }`}
                    >
                      <Icon size={18} aria-hidden="true" />
                    </div>
                  </div>
                  <div className="telemetry text-fg-muted mb-2">{p.n}</div>
                  <h3 className="font-display text-lg lg:text-xl font-semibold text-fg-strong mb-2">
                    {p.title}
                  </h3>
                  <p className="text-[15px] text-fg-body leading-relaxed max-w-[44ch]">
                    {p.body}
                  </p>
                </Reveal>
              );
            })}
          </ol>
        </Reveal>
      </div>
    </section>
  );
}
