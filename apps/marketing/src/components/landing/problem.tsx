import {
  Warehouse,
  Boxes,
  FileSignature,
  Banknote,
  PhoneCall,
  Headset,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import type { ReactElement } from 'react';
import { Reveal } from '@/lib/reveal';
import { Chip, Cluster, DataStrip, SectionHead, SpecBox } from './chrome';

/**
 * SEC 02 — DIAGNOSTICS.
 *
 * The six-headed problem as a fault readout. The structural decision
 * here is the CLUSTER: six separate cards read as a feature grid and
 * invite you to skim one, whereas three titled panels holding two
 * hairline-divided cells each read as an audit — which is the argument
 * the section is making. It also groups the faults the way a seller
 * actually meets them: the building, the contracts, the customer.
 *
 * One fault is marked critical and it is the honest one to mark: call
 * confirmation is the single biggest lever on RTO, and it is the thing
 * nobody else in this lane does.
 */

interface Fault {
  code: string;
  vector: string;
  icon: LucideIcon;
  title: string;
  body: string;
  flag: string;
  critical?: boolean;
}

interface FaultCluster {
  title: string;
  icon: LucideIcon;
  meta: string;
  faults: [Fault, Fault];
}

const CLUSTERS: FaultCluster[] = [
  {
    title: 'cluster 01 // the building',
    icon: Warehouse,
    meta: '2 audited / 2 failed',
    faults: [
      {
        code: 'vec-01',
        vector: 'warehousing',
        icon: Warehouse,
        title: 'No Indian warehouse',
        body: 'Shipping every order from Dhaka means each parcel crosses a border on its own. Transit takes weeks, and a return crosses back — costing more than the sale was worth.',
        flag: 'weeks in transit',
      },
      {
        code: 'vec-02',
        vector: 'operations',
        icon: Boxes,
        title: 'No warehouse operation',
        body: 'Receive, put away, pick, pack, dispatch, take returns back in. That is a staffed building running a real stock system, not a spare room and a spreadsheet.',
        flag: 'staff + systems',
      },
    ],
  },
  {
    title: 'cluster 02 // the contracts',
    icon: FileSignature,
    meta: '2 audited / 2 failed',
    faults: [
      {
        code: 'vec-03',
        vector: 'carrier access',
        icon: FileSignature,
        title: 'No courier contract',
        body: 'Indian carriers sign Indian entities. Without one you cannot get an account at all — and rates are set against volume you have not shipped yet.',
        flag: 'entity required',
      },
      {
        code: 'vec-04',
        vector: 'money rail',
        icon: Banknote,
        title: 'No way to get paid',
        body: 'COD is collected in rupees, in India. Getting it back to Bangladesh needs Indian banking, GST-compliant invoicing, reconciliation against what the courier actually paid, and a remittance route.',
        flag: 'INR stranded',
      },
    ],
  },
  {
    title: 'cluster 03 // the customer',
    icon: PhoneCall,
    meta: '2 audited / 2 failed',
    faults: [
      {
        code: 'vec-05',
        vector: 'cod confirmation',
        icon: PhoneCall,
        title: 'No one calls the buyer',
        body: 'India is a COD market, and an unconfirmed COD order is a guess. Ship it blind and a large share comes straight back — you pay to send it, pay to return it, and the goods arrive used or not at all.',
        flag: 'highest-cost failure',
        critical: true,
      },
      {
        code: 'vec-06',
        vector: 'support',
        icon: Headset,
        title: 'No support in Hindi',
        body: 'Your customer is in India and expects to be answered in their own language, within the working day. From Dhaka, in English, on a different clock, that does not happen.',
        flag: 'language gap',
      },
    ],
  },
];

export function Problem(): ReactElement {
  return (
    <section id="diagnostics" className="border-t border-line bg-surface py-16 lg:py-24">
      <div className="mx-auto max-w-7xl px-5 sm:px-6">
        <SectionHead
          index="02"
          code="diagnostics"
          tone="bad"
          flag={
            <Chip tone="bad">
              <TriangleAlert size={13} aria-hidden="true" />6 failure points
            </Chip>
          }
          title="Selling into India fails six ways."
          sub="Run the check on a solo India launch and every subsystem throws the same class of error: you need an operation you do not have, and each piece of it is a prerequisite for the next."
          aside={<SpecBox label="scope" value="BD seller · first year in India" />}
        />

        <Reveal>
          <DataStrip
            items={[
              {
                label: 'corridor, on your own',
                value: 'High friction',
                chip: <Chip tone="bad">blocked</Chip>,
              },
              {
                label: 'time to first dispatch',
                value: '6+ months',
                chip: <Chip>estimate</Chip>,
              },
              {
                label: 'capital before order one',
                value: '₹50 lakh+',
                chip: <Chip>estimate</Chip>,
              },
            ]}
          />
        </Reveal>

        <div className="mt-8 space-y-6">
          {CLUSTERS.map((c, ci) => (
            <Reveal key={c.title} delay={ci * 70}>
              <Cluster title={c.title} meta={c.meta} icon={<c.icon size={16} aria-hidden="true" />}>
                <div className="grid divide-y divide-line lg:grid-cols-2 lg:divide-x lg:divide-y-0">
                  {c.faults.map((f) => (
                    <FaultCell key={f.code} fault={f} />
                  ))}
                </div>
              </Cluster>
            </Reveal>
          ))}
        </div>

        <Reveal className="mt-8">
          <div className="rounded-lg border border-line bg-surface-band p-5 sm:p-6">
            <div className="mono-caps mb-2 text-fg-faint">diagnosis</div>
            <p className="m-0 max-w-4xl text-[15px] leading-relaxed text-fg-strong sm:text-[17px]">
              Every one of those is solvable. Solving all six, in order, before you have sold
              anything — that is the part that stops people. Skydrop is the six already built.
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function FaultCell({ fault }: { fault: Fault }): ReactElement {
  const Icon = fault.icon;
  return (
    <article
      className="flex flex-col p-5 transition-colors hover:bg-surface-3/40 sm:p-6"
      style={
        fault.critical
          ? { background: 'color-mix(in srgb, var(--red-tint) 55%, transparent)' }
          : undefined
      }
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mono-caps flex items-center gap-1.5 text-sky">
            <Icon size={13} aria-hidden="true" />
            {fault.code}
            <span aria-hidden className="text-fg-faint">
              {'//'}
            </span>
            <span className="text-fg-muted">{fault.vector}</span>
          </div>
        </div>
        <Chip tone={fault.critical ? 'bad' : 'neutral'} className="shrink-0">
          {fault.flag}
        </Chip>
      </div>
      <h3 className="mb-2 text-[17px] font-bold text-fg-strong">{fault.title}</h3>
      <p className="m-0 text-[14px] leading-relaxed text-fg-body">{fault.body}</p>
    </article>
  );
}
