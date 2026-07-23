'use client';

import { motion } from 'framer-motion';
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
import { fadeUp, staggerContainer, viewportOnce } from '@/lib/motion';

interface Card {
  icon: LucideIcon;
  title: string;
  body: string;
}

const CARDS: Card[] = [
  {
    icon: Warehouse,
    title: 'Warehouse',
    body: 'Shipping every order from Dhaka takes weeks, and returns cost more than the sale.',
  },
  {
    icon: FileSignature,
    title: 'Courier contracts',
    body: 'Delhivery and Bluedart only sign Indian entities, and price hard on volume you can’t promise.',
  },
  {
    icon: PhoneCall,
    title: 'COD confirmation',
    body: 'Without a Hindi call-confirm team, RTO reaches 40% or more — every dispatched parcel loses money.',
  },
  {
    icon: Boxes,
    title: 'Warehouse ops',
    body: 'Receive, pick, pack, dispatch, RTO — a full operation you would otherwise have to staff.',
  },
  {
    icon: Banknote,
    title: 'Money',
    body: 'Indian bank accounts, GST invoicing, COD reconciliation, and remittance back to Bangladesh.',
  },
  {
    icon: Headset,
    title: 'Support',
    body: 'Indian customers expect help in Hindi, delivered within a working day.',
  },
];

export function Problem(): ReactElement {
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
            The problem
          </div>
          <h2
            className="mt-4 font-display font-semibold text-fg-strong"
            style={{
              fontSize: 'clamp(1.75rem, 3.5vw, 2.75rem)',
              letterSpacing: '-0.02em',
            }}
          >
            Selling into India is a six-headed problem.
          </h2>
        </motion.div>

        <motion.ul
          className="mt-10 lg:mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          initial="hidden"
          whileInView="show"
          viewport={viewportOnce}
          variants={staggerContainer}
        >
          {CARDS.map((c) => {
            const Icon = c.icon;
            return (
              <motion.li
                key={c.title}
                variants={fadeUp}
                className="group relative rounded-2xl border border-line bg-surface p-6 transition-shadow duration-150 hover:shadow-lg"
              >
                <div className="mb-5 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-surface-3 text-sky border border-line">
                  <Icon size={20} aria-hidden="true" />
                </div>
                <h3 className="font-display text-lg font-semibold text-fg-strong mb-2">
                  {c.title}
                </h3>
                <p className="text-[15px] text-fg-body leading-relaxed">
                  {c.body}
                </p>
              </motion.li>
            );
          })}
        </motion.ul>

        <motion.p
          className="mt-10 lg:mt-14 max-w-2xl text-fg-strong text-lg"
          initial="hidden"
          whileInView="show"
          viewport={viewportOnce}
          variants={fadeUp}
        >
          Building this yourself takes{' '}
          <span className="font-mono">6+ months</span>,{' '}
          <span className="font-mono">₹50 lakh+</span>, and an Indian company.
          Most sellers never try.
        </motion.p>
      </div>
    </section>
  );
}
