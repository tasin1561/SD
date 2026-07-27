import {
  Warehouse,
  FileSignature,
  PhoneCall,
  Boxes,
  Banknote,
  Headset,
  type LucideIcon,
} from 'lucide-react';
import type { ReactElement } from 'react';
import { Reveal } from '@/lib/reveal';
import { SectionHeader } from './section-header';

/**
 * SEC 02 — DIAGNOSTICS. The six-headed problem rendered as a fault
 * readout: each blocker is a FAULT card with a mono code, not a
 * generic icon-title-blurb marketing card.
 */

interface Fault {
  code: string;
  icon: LucideIcon;
  title: string;
  body: string;
  /** The killer fault — the one saffron accent this viewport gets. */
  critical?: boolean;
}

const FAULTS: Fault[] = [
  {
    code: 'FAULT 01',
    icon: Warehouse,
    title: 'No Indian warehouse',
    body: 'Shipping every order from Dhaka takes weeks, and returns cost more than the sale.',
  },
  {
    code: 'FAULT 02',
    icon: FileSignature,
    title: 'No courier contract',
    body: 'Delhivery and Bluedart only sign Indian entities, and price hard on volume you can’t promise.',
  },
  {
    code: 'FAULT 03',
    icon: PhoneCall,
    title: 'No COD confirmation',
    body: 'Without a Hindi call-confirm team, RTO reaches 40% or more — every dispatched parcel loses money.',
    critical: true,
  },
  {
    code: 'FAULT 04',
    icon: Boxes,
    title: 'No warehouse ops',
    body: 'Receive, pick, pack, dispatch, RTO — a full operation you would otherwise have to staff.',
  },
  {
    code: 'FAULT 05',
    icon: Banknote,
    title: 'No money rail',
    body: 'Indian bank accounts, GST invoicing, COD reconciliation, and remittance back to Bangladesh.',
  },
  {
    code: 'FAULT 06',
    icon: Headset,
    title: 'No Hindi support',
    body: 'Indian customers expect help in Hindi, delivered within a working day.',
  },
];

export function Problem(): ReactElement {
  return (
    <section className="bg-surface py-20 lg:py-28 border-t border-line">
      <div className="max-w-7xl mx-auto px-5 sm:px-8">
        <SectionHeader
          index="02"
          code="DIAGNOSTICS"
          title="Selling into India fails six ways."
          sub="Run the pre-flight check on a solo India launch and every subsystem throws the same class of error: you need an operation you don’t have."
        />

        <ul className="persp mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 list-none p-0">
          {FAULTS.map((f, i) => {
            const Icon = f.icon;
            return (
              <Reveal
                as="li"
                key={f.code}
                delay={i * 60}
                className={`group panel tilt-card relative p-6 hover:border-line-strong${f.critical ? ' fault-critical' : ''}`}
              >
                <div className="flex items-center justify-between">
                  <span className={`telemetry ${f.critical ? 'text-saffron' : 'text-fg-muted'}`}>
                    {f.code}
                    {f.critical ? ' · critical' : ''}
                  </span>
                  <span className="tilt-pop inline-flex">
                    <Icon
                      size={18}
                      className="text-fg-muted group-hover:text-sky transition-colors"
                      aria-hidden="true"
                    />
                  </span>
                </div>
                <h3 className="mt-5 font-display text-lg font-semibold text-fg-strong">
                  {f.title}
                </h3>
                <p className="mt-2 text-[15px] text-fg-body leading-relaxed">{f.body}</p>
              </Reveal>
            );
          })}
        </ul>

        <Reveal className="mt-10 panel ticks px-6 py-5 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-8">
          <span className="telemetry text-fg-muted shrink-0">diagnosis</span>
          <p className="text-fg-strong text-base sm:text-lg m-0">
            Solo build: <span className="font-mono">6+ months</span>,{' '}
            <span className="font-mono">₹50 lakh+</span>, an Indian company — most sellers never
            try.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
