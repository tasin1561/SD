import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import type { ReactElement } from 'react';
import { Reveal } from '@/lib/reveal';
import { Magnetic } from '@/lib/tilt';

/**
 * SEC 08 — CLEARANCE. The closing ask, staged like a runway clearance.
 */
export function FinalCta(): ReactElement {
  return (
    <section className="relative bg-surface-2/40 py-24 lg:py-32 overflow-hidden border-t border-line">
      <div aria-hidden className="console-grid absolute inset-0 opacity-60" />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background: 'radial-gradient(circle at 50% 45%, var(--glow), transparent 55%)',
          opacity: 0.45,
        }}
      />

      <Reveal className="relative mx-auto max-w-2xl px-5 sm:px-8 text-center">
        <div className="telemetry text-fg-muted">sec 08 · clearance</div>
        <div aria-hidden className="runway mt-5 flex items-center justify-center gap-2.5">
          <span />
          <span />
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
        <h2
          className="mt-4 font-display font-semibold text-fg-strong"
          style={{
            fontSize: 'clamp(2.1rem, 4.2vw, 3.2rem)',
            letterSpacing: '-0.025em',
            lineHeight: 1.06,
          }}
        >
          Ready to ship into India?
        </h2>
        <p className="mt-5 text-fg-body text-base sm:text-lg mx-auto max-w-[42ch]">
          Tell us about your store — we reply within one working day.
        </p>
        <div className="mt-9 flex flex-wrap justify-center items-center gap-4">
          <Magnetic range={8}>
            <Link
              href="/request-invite"
              className="group inline-flex items-center gap-2 rounded-xl bg-sky px-6 py-4 text-sm font-medium text-accent-fg transition-colors hover:bg-sky-deep"
              style={{ boxShadow: '0 0 42px var(--glow)' }}
            >
              Request an invite
              <ArrowUpRight
                size={16}
                className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
              />
            </Link>
          </Magnetic>
          <a
            href="mailto:hello@skydrop.online"
            className="font-mono text-sm text-fg-muted hover:text-fg-strong transition-colors"
          >
            hello@skydrop.online
          </a>
        </div>
      </Reveal>
    </section>
  );
}
