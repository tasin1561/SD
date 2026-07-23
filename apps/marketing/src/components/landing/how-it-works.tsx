'use client';

import { motion } from 'framer-motion';
import { PackageOpen, PhoneCall, Truck, MapPinned, type LucideIcon } from 'lucide-react';
import type { ReactElement } from 'react';
import { fadeUp, staggerContainer, viewportOnce } from '@/lib/motion';

interface Step {
  n: string;
  icon: LucideIcon;
  title: string;
  body: string;
}

const STEPS: Step[] = [
  {
    n: '01',
    icon: PackageOpen,
    title: 'Ship stock once',
    body: 'You send inventory to our Indian warehouse. We receive it into a real WMS — bin-level, batch, FIFO/FEFO.',
  },
  {
    n: '02',
    icon: PhoneCall,
    title: 'We confirm by phone',
    body: 'Every buyer gets a call before we dispatch. No answer → we re-attempt; unreachable → the order routes to NDR, not to the courier.',
  },
  {
    n: '03',
    icon: Truck,
    title: 'Pick, pack, dispatch',
    body: 'Confirmed orders ship through Delhivery’s API. When a PIN is non-serviceable, we hand off to a backup courier and you never see it.',
  },
  {
    n: '04',
    icon: MapPinned,
    title: 'Tracked to the door',
    body: 'Webhook-driven tracking, public AWB lookup for your customers, and inspected RTOs with transparent stock write-back.',
  },
];

export function HowItWorks(): ReactElement {
  return (
    <section
      id="how-it-works"
      className="bg-surface py-16 lg:py-24 relative overflow-hidden"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-24"
        style={{
          background:
            'linear-gradient(180deg, color-mix(in oklab, var(--sky) 6%, transparent), transparent)',
        }}
      />

      <div className="relative max-w-7xl mx-auto px-5 sm:px-8">
        <motion.div
          initial="hidden"
          whileInView="show"
          viewport={viewportOnce}
          variants={fadeUp}
        >
          <div className="inline-flex items-center gap-2 rounded-full bg-surface-3 border border-line px-3 py-1 text-[11px] font-mono uppercase tracking-wide text-fg-muted">
            How it works
          </div>
          <h2
            className="mt-4 font-display font-semibold text-fg-strong"
            style={{
              fontSize: 'clamp(1.75rem, 3.5vw, 2.75rem)',
              letterSpacing: '-0.02em',
            }}
          >
            Four steps, end-to-end.
          </h2>
        </motion.div>

        <motion.ol
          className="mt-10 lg:mt-16 relative"
          initial="hidden"
          whileInView="show"
          viewport={viewportOnce}
          variants={staggerContainer}
        >
          <div
            aria-hidden
            className="lg:hidden absolute left-[22px] top-0 bottom-0 w-px bg-line"
          />
          <div
            aria-hidden
            className="hidden lg:block absolute top-8 left-0 right-0 h-px"
          >
            <motion.div
              className="h-full origin-left"
              style={{
                background:
                  'linear-gradient(90deg, color-mix(in oklab, var(--sky) 12%, transparent), var(--sky), color-mix(in oklab, var(--saffron) 50%, transparent))',
              }}
              initial={{ scaleX: 0 }}
              whileInView={{ scaleX: 1 }}
              viewport={viewportOnce}
              transition={{ duration: 1.4, ease: [0.21, 0.47, 0.32, 0.98] }}
            />
          </div>

          <div className="grid gap-8 lg:gap-6 lg:grid-cols-4">
            {STEPS.map((s) => {
              const Icon = s.icon;
              return (
                <motion.li
                  key={s.n}
                  variants={fadeUp}
                  className="relative pl-14 lg:pl-0"
                >
                  <div className="absolute left-0 top-0 lg:relative lg:top-auto lg:left-auto lg:mb-6">
                    <div className="relative inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-surface-2 border border-line-strong text-sky">
                      <Icon size={19} aria-hidden="true" />
                      <div
                        aria-hidden
                        className="hidden lg:block absolute -top-[22px] left-1/2 -translate-x-1/2 h-3 w-3 rounded-full bg-surface border border-sky"
                      />
                    </div>
                  </div>

                  <div className="font-mono text-xs text-fg-muted mb-2">
                    {s.n}
                  </div>
                  <h3 className="font-display text-lg lg:text-xl font-semibold text-fg-strong mb-2">
                    {s.title}
                  </h3>
                  <p className="text-[15px] text-fg-muted leading-relaxed max-w-[42ch]">
                    {s.body}
                  </p>
                </motion.li>
              );
            })}
          </div>
        </motion.ol>
      </div>
    </section>
  );
}
