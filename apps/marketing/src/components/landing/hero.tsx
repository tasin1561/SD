import { ArrowUpRight, Search } from 'lucide-react';
import type { ReactElement } from 'react';
import { TiltPanel } from '@/lib/tilt';
import { CorridorConsole } from './corridor-console';
import { TelemetryTicker } from './telemetry-ticker';

/**
 * SEC 01 — the Corridor Console hero.
 * Full-bleed console-grid backdrop; copy panel left, live corridor
 * canvas right (stacked below copy on mobile); telemetry ticker seals
 * the section.
 */
export function Hero(): ReactElement {
  return (
    <section id="top" className="relative bg-surface overflow-hidden">
      <div aria-hidden className="console-grid absolute inset-0" />
      {/* Phosphor bloom top-center */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-48 left-1/2 -translate-x-1/2 w-[900px] h-[560px] rounded-full"
        style={{
          background: 'radial-gradient(closest-side, var(--glow), transparent)',
          opacity: 0.5,
        }}
      />

      {/* Mobile-only: the corridor runs as the section background (the
          separate console panel below is desktop-only). A light scrim
          keeps the copy legible without washing the map out. */}
      <div aria-hidden className="lg:hidden pointer-events-none absolute inset-0 opacity-70">
        <CorridorConsole />
      </div>
      <div
        aria-hidden
        className="lg:hidden pointer-events-none absolute inset-0"
        style={{
          background:
            'linear-gradient(180deg, color-mix(in oklab, var(--surface) 20%, transparent) 0%, color-mix(in oklab, var(--surface) 45%, transparent) 60%, color-mix(in oklab, var(--surface) 82%, transparent) 100%)',
        }}
      />

      <div className="relative max-w-7xl mx-auto px-5 sm:px-8 pt-12 pb-14 lg:pt-20 lg:pb-20">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,44%)_minmax(0,56%)] lg:items-center">
          {/* Copy */}
          <div>
            <div className="boot-rise telemetry inline-flex items-center gap-2.5 rounded-full border border-line bg-surface-2 px-3.5 py-2 text-fg-muted">
              <span
                aria-hidden
                className="status-dot inline-block h-1.5 w-1.5 rounded-full bg-green"
              />
              <span>corridor online · BD → IN · invite-only beta</span>
            </div>

            <h1
              className="boot-rise boot-rise-2 mt-6 font-display font-semibold text-fg-strong"
              style={{
                fontSize: 'clamp(2.5rem, 5.6vw, 4.25rem)',
                letterSpacing: '-0.025em',
                lineHeight: 1.04,
              }}
            >
              Your India operation,
              <br />
              <span className="text-sky">running without&nbsp;you.</span>
            </h1>

            <p className="boot-rise boot-rise-3 mt-6 text-fg-body text-base sm:text-lg max-w-[46ch]">
              Skydrop holds your stock in India, confirms every COD buyer by phone, and dispatches
              through Delhivery. You sell from Bangladesh — this console is what we run for you.
            </p>

            <div className="boot-rise boot-rise-4 mt-8 flex flex-wrap gap-3">
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
                href="https://track.skydrop.online"
                className="inline-flex items-center gap-2 rounded-xl border border-line-strong px-5 py-3.5 text-sm text-fg-strong transition-all hover:bg-surface-3 hover:-translate-y-px"
              >
                <Search size={15} />
                Track a parcel
              </a>
            </div>

            {/* Instrument stats */}
            <dl className="mt-10 grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-line bg-line max-w-md">
              <Stat n="<3 weeks" k="first dispatch" />
              <Stat n="<15%" k="RTO target" />
              <Stat n="₹0" k="Indian setup" />
            </dl>
          </div>

          {/* Console panel — DESKTOP only; on mobile the corridor is the
              section background instead. 3D tilt follows the pointer. */}
          <TiltPanel max={4.5} className="hidden lg:block lg:pl-0">
            <div className="panel ticks relative h-[440px] overflow-hidden">
              <div className="telemetry absolute top-3 left-1/2 -translate-x-1/2 z-10 text-fg-muted">
                corridor · live
              </div>
              <CorridorConsole />
              <div aria-hidden className="glow-follow" />
            </div>
          </TiltPanel>
        </div>
      </div>

      <TelemetryTicker />
    </section>
  );
}

function Stat({ n, k }: { n: string; k: string }): ReactElement {
  return (
    <div className="bg-surface-2 px-4 py-3.5">
      <dt className="telemetry text-fg-muted order-2">{k}</dt>
      <dd className="font-mono text-lg text-fg-strong tracking-tight m-0">{n}</dd>
    </div>
  );
}
