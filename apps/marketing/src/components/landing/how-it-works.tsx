import { PackageOpen, PhoneCall, Truck, MapPinned, type LucideIcon } from 'lucide-react';
import type { ReactElement } from 'react';
import { Reveal } from '@/lib/reveal';
import { Chip, SectionHead, SpecBox } from './chrome';

/**
 * SEC 03 — FLIGHT PLAN.
 *
 * Four phases on a corridor rail. Each phase is a panel with its own
 * header bar and a readout of what actually runs inside it, because
 * "we pick and pack" is a claim anybody can make and "FIFO/FEFO batch
 * allocation, scanned at the bench" is a description of a building.
 *
 * The rail is a single hairline with a gradient that draws itself in
 * when the section reveals — it is the only ornamental motion on the
 * page, and it is carrying meaning: left to right is the parcel's
 * direction of travel.
 */

interface Phase {
  n: string;
  icon: LucideIcon;
  title: string;
  body: string;
  runs: string[];
  tone: 'accent' | 'good';
}

const PHASES: Phase[] = [
  {
    n: 'phase 01',
    icon: PackageOpen,
    title: 'Ship your stock once',
    body: 'You send inventory to our Indian warehouse — one consignment, not one parcel per order. We count it in and it becomes sellable stock you can watch.',
    runs: ['Bin-level put-away', 'Batches, FIFO/FEFO', 'Append-only stock ledger'],
    tone: 'accent',
  },
  {
    n: 'phase 02',
    icon: PhoneCall,
    title: 'We phone every buyer',
    body: 'An order is not dispatched because it was placed. Our call desk reaches the customer first and confirms the order, the address and the amount they will pay.',
    runs: ['Every attempt logged', 'No answer → re-queued', 'Unreachable → held, never shipped'],
    tone: 'accent',
  },
  {
    n: 'phase 03',
    icon: Truck,
    title: 'Pick, pack, dispatch',
    body: 'Confirmed orders are picked against the batch they were reserved from, verified at the pack bench by scanning what goes in the box, and booked with a courier.',
    runs: ['Scanned into the box', 'Waybill via courier API', 'Refused lane → second courier'],
    tone: 'accent',
  },
  {
    n: 'phase 04',
    icon: MapPinned,
    title: 'Delivered, or properly returned',
    body: 'Tracking runs off courier scans. What comes back is opened and inspected — and the COD that was collected is remitted to you in Bangladesh.',
    runs: ['Public tracking · EN + HI', 'Returns inspected per item', 'COD remitted to BD'],
    tone: 'good',
  },
];

export function HowItWorks(): ReactElement {
  return (
    <section
      id="how-it-works"
      className="relative overflow-hidden border-t border-line bg-surface-band py-16 lg:py-24"
    >
      <div aria-hidden className="dots-bg absolute inset-0" />
      <div className="relative mx-auto max-w-7xl px-5 sm:px-6">
        <SectionHead
          index="03"
          code="flight plan"
          tone="accent"
          flag={<Chip tone="accent">4 phases · end to end</Chip>}
          title="Four phases, end to end."
          sub="One corridor, instrumented the whole way — from the first consignment you send us to the COD landing back in your account."
          aside={<SpecBox label="you operate" value="phase 00 · you sell" />}
        />

        <Reveal className="relative">
          {/* Rail — vertical on a phone, horizontal from lg. */}
          <div
            aria-hidden
            className="absolute bottom-2 left-[19px] top-2 w-px bg-line-strong lg:hidden"
          />
          <div
            aria-hidden
            className="absolute left-0 right-0 top-[19px] hidden h-px bg-line lg:block"
          >
            <div
              className="rail-draw h-full"
              style={{
                background:
                  'linear-gradient(90deg, var(--accent-fill), color-mix(in srgb, var(--green) 75%, transparent))',
              }}
            />
          </div>

          <ol className="m-0 grid list-none gap-6 p-0 lg:grid-cols-4 lg:gap-5">
            {PHASES.map((p, i) => {
              const Icon = p.icon;
              return (
                <Reveal as="li" key={p.n} delay={i * 70} className="relative pl-14 lg:pl-0">
                  {/* Node */}
                  <div className="absolute left-0 top-0 lg:relative lg:mb-5">
                    <div
                      className={`inline-flex h-10 w-10 items-center justify-center rounded-md border bg-surface-2 ${
                        p.tone === 'good'
                          ? 'border-green-line text-green'
                          : 'border-accent-line text-sky'
                      }`}
                    >
                      <Icon size={17} aria-hidden="true" />
                    </div>
                  </div>

                  <div className="overflow-hidden rounded-lg border border-line bg-surface-2">
                    <div className="panel-head flex items-center justify-between gap-2 px-4 py-2.5">
                      <span className="mono-caps text-fg-strong">{p.n}</span>
                      <span className="mono-caps text-fg-faint">
                        {String(i + 1).padStart(2, '0')}/04
                      </span>
                    </div>
                    <div className="p-4">
                      <h3 className="mb-2 text-[16px] font-bold text-fg-strong">{p.title}</h3>
                      <p className="m-0 text-[14px] leading-relaxed text-fg-body">{p.body}</p>
                    </div>
                    <ul className="m-0 list-none divide-y divide-line border-t border-line p-0">
                      {p.runs.map((r) => (
                        <li
                          key={r}
                          className="mono-caps flex items-center gap-2 px-4 py-2 text-fg-muted"
                        >
                          <span
                            aria-hidden
                            className={`inline-block h-1 w-1 shrink-0 rounded-full ${
                              p.tone === 'good' ? 'bg-green' : 'bg-sky'
                            }`}
                          />
                          <span className="min-w-0 truncate">{r}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </Reveal>
              );
            })}
          </ol>
        </Reveal>
      </div>
    </section>
  );
}
