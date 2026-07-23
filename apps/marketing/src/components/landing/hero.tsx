import { ArrowUpRight, Search } from 'lucide-react';
import type { ReactElement } from 'react';
import { RouteSvg } from './route-svg';
import { Marquee } from './marquee';

/**
 * Hero — dark ink background, holds the signature route animation
 * and the two primary CTAs. Wraps mobile-first: content stacked
 * on <lg; two-column at ≥lg with route illustration on the right.
 */
export function Hero(): ReactElement {
  return (
    <section id="top" className="relative bg-ink text-white overflow-hidden">
      {/* Subtle radial glow — decorative, transform-only, cheap */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 -translate-x-1/2 w-[800px] h-[800px] rounded-full opacity-30 blur-3xl"
        style={{
          background: 'radial-gradient(closest-side, rgba(56,189,248,0.35), transparent)',
        }}
      />

      <div className="relative max-w-7xl mx-auto px-5 sm:px-8 pt-14 pb-16 lg:pt-24 lg:pb-28">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-center">
          {/* Left: copy + CTAs */}
          <div>
            {/* Pill badge */}
            <div className="inline-flex items-center gap-2 rounded-full border border-[var(--border-dark)] bg-white/[0.03] px-3 py-1.5 text-xs text-[var(--muted-dark)]">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-saffron opacity-60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-saffron" />
              </span>
              <span className="font-mono uppercase tracking-wide">
                Invite-only beta · BD → IN
              </span>
            </div>

            {/* H1 */}
            <h1
              className="mt-6 font-display font-semibold text-white"
              style={{
                fontSize: 'clamp(2.25rem, 5vw, 4rem)',
                letterSpacing: '-0.02em',
                lineHeight: 1.05,
              }}
            >
              Sell to India from Bangladesh,{' '}
              <span className="text-sky">without an Indian operation.</span>
            </h1>

            {/* Sub */}
            <p className="mt-6 text-[var(--muted-dark)] text-base sm:text-lg max-w-[42ch]">
              Skydrop holds your stock in India, confirms every COD order by
              phone, and dispatches via Delhivery — you just sell.
            </p>

            {/* CTAs */}
            <div className="mt-9 flex flex-wrap gap-3">
              <a
                href="mailto:hello@skydrop.online?subject=Skydrop%20invite%20request"
                className="group inline-flex items-center gap-2 rounded-xl bg-sky px-5 py-3.5 text-sm font-medium text-ink transition-all hover:bg-white hover:-translate-y-px"
              >
                Request an invite
                <ArrowUpRight
                  size={16}
                  className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                />
              </a>
              <a
                href="https://track.skydrop.online"
                className="inline-flex items-center gap-2 rounded-xl border border-[var(--border-dark)] px-5 py-3.5 text-sm text-white transition-all hover:border-white/30 hover:bg-white/5 hover:-translate-y-px"
              >
                <Search size={15} />
                Track a parcel
              </a>
            </div>

            {/* Micro-stat / social proof row */}
            <div className="mt-10 grid grid-cols-3 gap-6 max-w-md text-left border-t border-[var(--border-dark)] pt-6">
              <MicroStat n="<3 wks" k="first dispatch" />
              <MicroStat n="<15%" k="RTO target" />
              <MicroStat n="24×7" k="tracking" />
            </div>
          </div>

          {/* Right: route illustration */}
          <div className="lg:pl-6">
            <RouteSvg />
          </div>
        </div>
      </div>

      <Marquee />
    </section>
  );
}

function MicroStat({ n, k }: { n: string; k: string }): ReactElement {
  return (
    <div>
      <div className="font-mono text-lg text-white tracking-tight">{n}</div>
      <div className="mt-1 text-[11px] uppercase tracking-wider text-[var(--muted-dark)]">
        {k}
      </div>
    </div>
  );
}
