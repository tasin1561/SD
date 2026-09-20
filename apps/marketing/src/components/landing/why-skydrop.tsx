import {
  Database,
  Truck,
  RotateCcw,
  BarChart3,
  Building2,
  Languages,
  PhoneCall,
  type LucideIcon,
} from 'lucide-react';
import type { ReactElement } from 'react';
import { Reveal } from '@/lib/reveal';
import { Chip, Cluster, SectionHead, SpecBox } from './chrome';
import { Counter } from './counter';
import { CallLog } from './call-log';

/**
 * SEC 04 — INSTRUMENTS.
 *
 * One signature panel and six supporting cells. The signature is the
 * call desk, and it gets the room because it is the honest answer to
 * "why you rather than a freight forwarder": everything else here is
 * competent logistics, and that one thing is the difference between a
 * COD parcel arriving and a COD parcel coming back.
 *
 * The two figures beneath it are a TARGET and an industry range, and
 * both are labelled as such. Neither is a measured result of ours and
 * neither is presented as one.
 */

interface Cell {
  icon: LucideIcon;
  title: string;
  body: string;
}

const CELLS: Cell[] = [
  {
    icon: Database,
    title: 'A real stock system',
    body: 'Bins, batches, an append-only ledger and low-stock alerts — so what the screen says is on the shelf is what is on the shelf.',
  },
  {
    icon: Truck,
    title: 'More than one courier',
    body: 'Booked through the courier API. A lane the first one will not carry is re-routed to the second; if both refuse, a person places it by hand.',
  },
  {
    icon: RotateCcw,
    title: 'Returns you can see',
    body: 'Every returned parcel is opened and inspected at the warehouse. Restock or write off is your call, item by item, and the stock moves to match.',
  },
  {
    icon: BarChart3,
    title: 'The numbers that matter',
    body: 'Confirmation rate, NDR rate, RTO rate, dispatch times — reported per order, not summarised into one figure that hides the bad week.',
  },
  {
    icon: Languages,
    title: 'Answered in Hindi',
    body: 'Your customers reach a desk that speaks their language, on their clock — for the confirmation call and for whatever they ask afterwards.',
  },
  {
    icon: Building2,
    title: 'You stay in Bangladesh',
    body: 'No Indian office, no Indian staff, no GST registration to begin. Stock is held and dispatched under ours until you outgrow that.',
  },
];

export function WhySkydrop(): ReactElement {
  return (
    <section id="why-skydrop" className="border-t border-line bg-surface py-16 lg:py-24">
      <div className="mx-auto max-w-7xl px-5 sm:px-6">
        <SectionHead
          index="04"
          code="instruments"
          tone="accent"
          flag={<Chip tone="accent">built for one lane</Chip>}
          title="Built specifically for the BD → IN corridor."
          sub="Not a general aggregator with a corridor bolted onto the side. Every instrument below exists because this particular lane demands it."
          aside={<SpecBox label="lane" value="Dhaka → Indian metros" />}
        />

        {/* Signature panel — the call desk. */}
        <Reveal>
          <div className="overflow-hidden rounded-lg border border-line bg-surface-2 shadow-[var(--shadow-2)]">
            <div className="panel-head flex flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-5">
              <span className="mono-caps flex items-center gap-2 text-fg-strong">
                <PhoneCall size={15} aria-hidden="true" className="text-sky" />
                signature instrument // cod call desk
              </span>
              <Chip tone="good">runs before every dispatch</Chip>
            </div>

            <div className="grid lg:grid-cols-2 lg:divide-x lg:divide-line">
              <div className="p-5 sm:p-7">
                <h3 className="text-[20px] font-bold leading-tight text-fg-strong sm:text-[24px]">
                  Every COD order is confirmed by a person, on the phone.
                </h3>
                <p className="mt-3 max-w-[46ch] text-[14px] leading-relaxed text-fg-body sm:text-[15px]">
                  Not an SMS nobody reads and not an automated voice call. An agent rings the
                  customer, confirms what they ordered and what they will pay, and logs the outcome.
                  No answer and it goes back in the queue; still unreachable at the attempt cap and
                  the order is held rather than shipped on a guess.
                </p>

                <div className="mt-6 grid grid-cols-2 gap-4 border-t border-line pt-5">
                  <div>
                    <div className="mono-caps mb-1.5 text-fg-faint">what we aim for</div>
                    <div className="figure-mono text-[30px] font-semibold leading-none text-sky sm:text-[38px]">
                      &lt;
                      <Counter to={15} suffix="%" />
                    </div>
                    <div className="mt-1.5 text-[12px] text-fg-muted">RTO rate · our target</div>
                  </div>
                  <div>
                    <div className="mono-caps mb-1.5 text-fg-faint">commonly seen</div>
                    <div className="figure-mono text-[30px] font-semibold leading-none text-fg-muted sm:text-[38px]">
                      <Counter to={40} suffix="%+" />
                    </div>
                    <div className="mt-1.5 text-[12px] text-fg-muted">
                      COD shipped without a confirmation call
                    </div>
                  </div>
                </div>
              </div>

              <div className="border-t border-line p-5 sm:p-7 lg:border-t-0">
                <div className="mono-caps mb-3 flex items-center justify-between text-fg-faint">
                  <span>outcome log</span>
                  <span>illustrative</span>
                </div>
                <CallLog />
                <p className="mt-3 text-[12px] leading-relaxed text-fg-muted">
                  The outcomes above are the real vocabulary the call desk records against an order
                  — confirmed, re-queued, or held at the attempt cap. The rows are an example, not a
                  live feed.
                </p>
              </div>
            </div>
          </div>
        </Reveal>

        {/* Supporting instruments. */}
        <Reveal className="mt-6">
          <Cluster
            title="supporting instruments"
            meta="6 systems"
            icon={<Database size={15} aria-hidden="true" />}
          >
            {/* Hairline grid. `gap-px` over a `--line` ground draws the
                seams in BOTH axes at every breakpoint — `divide-x/y`
                only ever divides along one, so a 2-col phone layout and
                a 3-col desktop one would each need their own set of
                conditional border classes and would each be wrong at
                the other's width. `[&>*]:min-w-0` lets a cell shrink
                below its min-content: without it one stubborn cell
                widens the track, every sibling stretches to match, and
                at 320px the whole document scrolls sideways. */}
            <div className="grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-3 [&>*]:min-w-0">
              {CELLS.map((c) => {
                const Icon = c.icon;
                return (
                  <div
                    key={c.title}
                    className="bg-surface-2 p-5 transition-colors hover:bg-surface-3/40"
                  >
                    <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-md border border-line bg-surface-3 text-sky">
                      <Icon size={16} aria-hidden="true" />
                    </div>
                    <h3 className="mb-1.5 text-[15px] font-bold text-fg-strong">{c.title}</h3>
                    <p className="m-0 text-[13px] leading-relaxed text-fg-body">{c.body}</p>
                  </div>
                );
              })}
            </div>
          </Cluster>
        </Reveal>
      </div>
    </section>
  );
}
