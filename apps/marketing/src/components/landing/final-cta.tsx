import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import type { ReactElement } from 'react';
import { Reveal } from '@/lib/reveal';
import { Chip, LiveDot } from './chrome';

/**
 * SEC 08 — CLEARANCE. The closing ask, staged as a runway approach.
 *
 * The three readouts under the buttons are the objections that actually
 * stop people at this point — how long, how much up front, what do I
 * have to register — answered in six words each rather than restated as
 * another paragraph.
 */
export function FinalCta(): ReactElement {
  return (
    <section
      id="clearance"
      className="relative overflow-hidden border-t border-line bg-surface-band py-20 lg:py-28"
    >
      <div aria-hidden className="grid-bg absolute inset-0" />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(circle at 50% 40%, var(--glow), transparent 60%)' }}
      />

      <Reveal className="relative mx-auto max-w-3xl px-5 text-center sm:px-6">
        <div className="flex justify-center">
          <Chip tone="accent">
            <LiveDot tone="sky" />
            sec 08 // clearance
          </Chip>
        </div>

        <div aria-hidden className="runway mt-6 flex items-center justify-center gap-2.5">
          <span />
          <span />
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>

        <h2
          className="mt-5 text-fg-strong"
          style={{
            fontSize: 'clamp(1.9rem, 4.4vw, 3rem)',
            letterSpacing: '-0.03em',
            lineHeight: 1.08,
          }}
        >
          Ready to ship into India?
        </h2>
        <p className="mx-auto mt-4 max-w-[46ch] text-[15px] leading-relaxed text-fg-body sm:text-[16px]">
          Tell us what you sell and where you are today. We read every one of these ourselves and
          reply within one working day.
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/request-invite"
            className="group inline-flex items-center gap-2 rounded-sm bg-accent-fill px-6 py-3.5 text-[14px] font-semibold text-accent-fg transition-colors hover:bg-accent-fill-hover"
          >
            Request an invite
            <ArrowRight
              size={16}
              aria-hidden="true"
              className="transition-transform group-hover:translate-x-0.5"
            />
          </Link>
          <a
            href="mailto:hello@skydrop.online"
            className="inline-flex items-center rounded-sm border border-line-strong bg-surface-2 px-5 py-3.5 font-mono text-[13px] text-fg-strong transition-colors hover:bg-surface-3"
          >
            hello@skydrop.online
          </a>
        </div>

        <dl className="mx-auto mt-10 grid max-w-xl grid-cols-1 gap-px overflow-hidden rounded-lg border border-line bg-line text-left sm:grid-cols-3">
          {[
            { k: 'to first dispatch', v: 'Under three weeks' },
            { k: 'up front', v: 'Your stock only' },
            { k: 'to register in India', v: 'Nothing' },
          ].map((r) => (
            <div key={r.k} className="bg-surface-2 px-4 py-3">
              <dt className="mono-caps text-fg-faint">{r.k}</dt>
              <dd className="m-0 mt-1 text-[14px] font-semibold text-fg-strong">{r.v}</dd>
            </div>
          ))}
        </dl>
      </Reveal>
    </section>
  );
}
