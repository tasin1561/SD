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
    body: 'Shipping every order from Dhaka takes weeks and returns are ruinous.',
  },
  {
    icon: FileSignature,
    title: 'Courier contracts',
    body: 'Delhivery and Bluedart only sign Indian entities, and price hard on volume.',
  },
  {
    icon: PhoneCall,
    title: 'COD confirmation',
    body: 'Without a Hindi call-confirm team, RTO hits 40%+ and every order loses money.',
  },
  {
    icon: Boxes,
    title: 'Warehouse ops',
    body: 'Receive, pick, pack, dispatch, RTO — a full operation you’d have to staff.',
  },
  {
    icon: Banknote,
    title: 'Money',
    body: 'Indian bank accounts, GST invoicing, COD reconciliation, remittance to BD.',
  },
  {
    icon: Headset,
    title: 'Support',
    body: 'Customers expect help in Hindi.',
  },
];

export function Problem(): ReactElement {
  return (
    <section className="bg-paper py-16 lg:py-24">
      <div className="max-w-7xl mx-auto px-5 sm:px-8">
        <motion.div
          initial="hidden"
          whileInView="show"
          viewport={viewportOnce}
          variants={fadeUp}
        >
          <div className="inline-flex items-center gap-2 rounded-full bg-white border border-border-light px-3 py-1 text-[11px] font-mono uppercase tracking-wide text-muted">
            The problem
          </div>
          <h2
            className="mt-4 font-display font-semibold text-ink"
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
                className="group relative rounded-2xl border border-border-light bg-white p-6 transition-shadow duration-150 hover:shadow-lg"
              >
                <div className="mb-5 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-ink text-sky">
                  <Icon size={20} aria-hidden="true" />
                </div>
                <h3 className="font-display text-lg font-semibold text-ink mb-2">
                  {c.title}
                </h3>
                <p className="text-[15px] text-muted leading-relaxed">
                  {c.body}
                </p>
              </motion.li>
            );
          })}
        </motion.ul>

        <motion.p
          className="mt-10 lg:mt-14 max-w-2xl text-ink text-lg"
          initial="hidden"
          whileInView="show"
          viewport={viewportOnce}
          variants={fadeUp}
        >
          Doing it yourself:{' '}
          <span className="font-mono text-ink">6+ months</span>,{' '}
          <span className="font-mono text-ink">₹50 lakh+</span>, and an Indian
          company. Most sellers never try.
        </motion.p>
      </div>
    </section>
  );
}
