import type { ReactElement } from 'react';

/**
 * Live-feel telemetry strip under the hero. The event names are the
 * REAL lifecycle vocabulary from the Skydrop order state machine —
 * truthful capability copy dressed as a feed. Offsets are relative
 * ("+" seconds), deliberately not wall-clock, so nothing reads as a
 * fabricated production log.
 *
 * CSS-only scroll (60s loop), pauses on hover, disabled under
 * prefers-reduced-motion via globals.css.
 */

interface Evt {
  code: string;
  detail: string;
  tone?: 'green' | 'saffron';
}

const EVENTS: Evt[] = [
  { code: 'CALL_CONFIRMED', detail: 'buyer verified by phone', tone: 'green' },
  { code: 'STOCK_RECEIVED', detail: 'bin-level put-away' },
  { code: 'ORDER_PICKED', detail: 'FIFO batch allocation' },
  { code: 'ORDER_PACKED', detail: 'manifest attached' },
  { code: 'AWB_GENERATED', detail: 'Delhivery API' },
  { code: 'DISPATCHED', detail: 'handed to courier', tone: 'green' },
  { code: 'NDR_ROUTED', detail: 'unreachable — held, not shipped', tone: 'saffron' },
  { code: 'OUT_FOR_DELIVERY', detail: 'webhook tracking' },
  { code: 'DELIVERED', detail: 'COD collected', tone: 'green' },
  { code: 'RTO_INSPECTED', detail: 'restock or write-off — your call' },
  { code: 'REMITTED', detail: 'INR → BDT settlement', tone: 'green' },
];

export function TelemetryTicker(): ReactElement {
  return (
    <div
      className="relative overflow-hidden border-y border-line bg-surface-2"
      aria-label="System event vocabulary"
    >
      <div className="ticker-track flex whitespace-nowrap py-3 will-change-transform">
        {[...EVENTS, ...EVENTS].map((e, i) => (
          <div key={i} className="flex items-center gap-3 pr-10 telemetry">
            <span
              aria-hidden
              className={`inline-block h-1.5 w-1.5 rounded-full ${
                e.tone === 'green' ? 'bg-green' : e.tone === 'saffron' ? 'bg-saffron' : 'bg-sky/60'
              }`}
            />
            <span className="text-fg-strong">{e.code}</span>
            <span className="text-fg-muted normal-case tracking-normal font-sans text-xs">
              {e.detail}
            </span>
          </div>
        ))}
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 w-20"
        style={{ background: 'linear-gradient(90deg, var(--surface-2), transparent)' }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 w-20"
        style={{ background: 'linear-gradient(-90deg, var(--surface-2), transparent)' }}
      />
    </div>
  );
}
