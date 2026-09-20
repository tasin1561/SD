import Link from 'next/link';
import { ArrowRight, Search } from 'lucide-react';
import type { ReactElement } from 'react';
import { CorridorConsole } from './corridor-console';
import { TelemetryTicker } from './telemetry-ticker';
import { Chip, DataStrip, LiveDot } from './chrome';

/**
 * SEC 01 — the corridor console.
 *
 * Copy left, live map right, and a readout strip sealing the fold. The
 * map is a PANEL with its own header and footer bars rather than a
 * bleeding illustration: the claim the page is making is that there is
 * an instrumented operation behind it, and a bordered readout says that
 * where a floating graphic only decorates it.
 *
 * On a phone the map becomes the section's background at low opacity
 * under a scrim — the geometry still reads, the copy stays first, and
 * nothing is stacked below the fold that has to be scrolled past to
 * reach the point.
 */
export function Hero(): ReactElement {
  return (
    <section id="top" className="relative overflow-hidden border-b border-line bg-surface">
      <div aria-hidden className="grid-bg absolute inset-0" />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'linear-gradient(180deg, var(--page-top) 0%, transparent 42%, transparent 100%)',
          opacity: 0.55,
        }}
      />

      {/* Mobile: the corridor runs as the section ground. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-50 lg:hidden">
        <CorridorConsole />
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 lg:hidden"
        style={{
          background:
            'linear-gradient(180deg, color-mix(in srgb, var(--surface) 55%, transparent) 0%, color-mix(in srgb, var(--surface) 72%, transparent) 55%, var(--surface) 100%)',
        }}
      />

      <div className="relative mx-auto max-w-7xl px-5 pb-12 pt-10 sm:px-6 lg:pb-16 lg:pt-14">
        <div className="grid items-center gap-9 lg:grid-cols-12 lg:gap-10">
          {/* Copy */}
          <div className="lg:col-span-6 xl:col-span-5">
            <div className="boot-rise flex flex-wrap items-center gap-2">
              <Chip tone="accent">
                <LiveDot tone="sky" />
                invite-only beta
              </Chip>
              <Chip>bd &rarr; in corridor</Chip>
            </div>

            <h1
              className="boot-rise boot-rise-2 mt-5 text-fg-strong"
              style={{
                fontSize: 'clamp(2rem, 5vw, 3.25rem)',
                letterSpacing: '-0.03em',
                lineHeight: 1.08,
              }}
            >
              Your India operation,
              <br />
              <span className="text-sky">running without&nbsp;you.</span>
            </h1>

            <p className="boot-rise boot-rise-3 mt-5 max-w-[48ch] text-[15px] leading-relaxed text-fg-body sm:text-[16px]">
              Skydrop holds your stock in an Indian warehouse, confirms every COD buyer by phone
              before anything ships, and dispatches through our courier partners. You keep selling —
              the operation behind it is ours to run.
            </p>

            <div className="boot-rise boot-rise-4 mt-7 flex flex-wrap gap-2.5">
              <Link
                href="/request-invite"
                className="group inline-flex items-center gap-2 rounded-sm bg-accent-fill px-5 py-3 text-[14px] font-semibold text-accent-fg transition-colors hover:bg-accent-fill-hover"
              >
                Request an invite
                <ArrowRight
                  size={16}
                  aria-hidden="true"
                  className="transition-transform group-hover:translate-x-0.5"
                />
              </Link>
              <a
                href="https://track.skydrop.online"
                className="inline-flex items-center gap-2 rounded-sm border border-line-strong bg-surface-2 px-5 py-3 text-[14px] font-medium text-fg-strong transition-colors hover:bg-surface-3"
              >
                <Search size={15} aria-hidden="true" />
                Track a parcel
              </a>
            </div>

            <dl className="boot-rise boot-rise-4 mt-8 grid max-w-md grid-cols-3 overflow-hidden rounded-lg border border-line bg-surface-2 divide-x divide-line">
              <Stat n="< 3 weeks" k="to first dispatch" />
              <Stat n="< 15%" k="RTO we aim for" />
              <Stat n="₹0" k="Indian entity" />
            </dl>
          </div>

          {/* Console panel — desktop only. */}
          <div className="hidden lg:col-span-6 lg:block xl:col-span-7">
            <div className="overflow-hidden rounded-lg border border-line bg-surface-2 shadow-[var(--shadow-hud)]">
              <div className="panel-head flex items-center justify-between gap-3 px-4 py-2.5">
                <span className="mono-caps flex items-center gap-2 text-fg-muted">
                  <LiveDot />
                  <span className="text-fg-strong">corridor map</span>
                  <span aria-hidden className="text-fg-faint">
                    {'//'}
                  </span>
                  <span>dac &rarr; in metros</span>
                </span>
                <span className="mono-caps text-fg-faint">illustrative</span>
              </div>

              <div className="relative h-[380px] xl:h-[420px]">
                <CorridorConsole />
              </div>

              <div className="grid grid-cols-3 divide-x divide-line border-t border-line">
                {[
                  { k: 'origin', v: 'DAC · Dhaka' },
                  { k: 'warehouse', v: 'India' },
                  { k: 'couriers', v: 'Delhivery + 1' },
                ].map((r) => (
                  <div key={r.k} className="px-4 py-2.5">
                    <div className="mono-caps text-fg-faint">{r.k}</div>
                    <div className="figure-mono mt-0.5 text-[12px] text-fg-strong">{r.v}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Readout strip — what we actually run, in four gauges. */}
        <div className="mt-10">
          <DataStrip
            columns={4}
            items={[
              {
                label: 'stock held',
                value: 'Indian warehouse',
                chip: <Chip tone="good">bin-level</Chip>,
              },
              {
                label: 'every COD order',
                value: 'Confirmed by phone',
                chip: <Chip tone="good">before dispatch</Chip>,
              },
              {
                label: 'dispatch',
                value: 'Courier API',
                chip: <Chip tone="accent">+ backup</Chip>,
              },
              {
                label: 'COD money',
                value: 'Remitted to BD',
                chip: <Chip tone="accent">on schedule</Chip>,
              },
            ]}
          />
        </div>
      </div>

      <TelemetryTicker />
    </section>
  );
}

function Stat({ n, k }: { n: string; k: string }): ReactElement {
  return (
    <div className="px-3.5 py-3">
      {/* `whitespace-nowrap` and a smaller size below `sm`: at 360px the
          three cells are ~100px each, and "< 3 weeks" broke after the
          "3" — a figure split across two lines stops reading as one
          quantity. The LABEL under it is free to wrap; it is prose. */}
      <dd className="figure-mono m-0 whitespace-nowrap text-[14px] font-semibold text-fg-strong sm:text-[17px]">
        {n}
      </dd>
      <dt className="mono-caps mt-1 text-fg-faint">{k}</dt>
    </div>
  );
}
