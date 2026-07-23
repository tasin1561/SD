'use client';

import { motion } from 'framer-motion';
import { ArrowUpRight } from 'lucide-react';
import type { ReactElement } from 'react';
import { fadeUp, viewportOnce } from '@/lib/motion';

export function FinalCta(): ReactElement {
  return (
    <section className="relative bg-surface-2 py-20 lg:py-28 overflow-hidden border-t border-line">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-50"
        style={{
          background:
            'radial-gradient(circle at 50% 40%, color-mix(in oklab, var(--sky) 15%, transparent), transparent 60%)',
        }}
      />

      <motion.div
        className="relative mx-auto max-w-2xl px-5 sm:px-8 text-center"
        initial="hidden"
        whileInView="show"
        viewport={viewportOnce}
        variants={fadeUp}
      >
        <h2
          className="font-display font-semibold text-fg-strong"
          style={{ fontSize: 'clamp(2rem, 4vw, 3rem)', letterSpacing: '-0.02em', lineHeight: 1.1 }}
        >
          Ready to ship into India?
        </h2>
        <p className="mt-5 text-fg-muted text-base sm:text-lg mx-auto max-w-[42ch]">
          Tell us about your store — we reply within one working day.
        </p>
        <div className="mt-9 flex flex-wrap justify-center items-center gap-4">
          <a
            href="mailto:hello@skydrop.online?subject=Skydrop%20invite%20request"
            className="group inline-flex items-center gap-2 rounded-xl bg-sky px-5 py-3.5 text-sm font-medium text-accent-fg transition-all hover:bg-sky-deep hover:-translate-y-px"
          >
            Request an invite
            <ArrowUpRight
              size={16}
              className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
            />
          </a>
          <a
            href="mailto:hello@skydrop.online"
            className="font-mono text-sm text-fg-muted hover:text-fg-strong transition-colors"
          >
            hello@skydrop.online
          </a>
        </div>
      </motion.div>
    </section>
  );
}
