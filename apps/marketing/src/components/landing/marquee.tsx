import type { ReactElement } from 'react';

const ITEMS = [
  'COD call-confirm',
  'Bin-level WMS',
  'Delhivery API',
  'NDR routing',
  'RTO inspection',
  'INR → BDT remittance',
];

/**
 * Slim capability marquee — CSS-only animation, pauses on hover.
 * The items are duplicated so the -50% translate produces seamless
 * looping. Reduced-motion pauses via globals.css rule.
 */
export function Marquee(): ReactElement {
  return (
    <div
      className="relative overflow-hidden border-y border-[var(--border-dark)] bg-black/20"
      aria-label="Capability strip"
    >
      <div className="marquee-track flex whitespace-nowrap py-3.5 will-change-transform">
        {[...ITEMS, ...ITEMS].map((item, i) => (
          <div
            key={i}
            className="flex items-center gap-8 pr-8 text-[var(--muted-dark)] font-mono text-xs tracking-wide"
          >
            <span className="w-1 h-1 rounded-full bg-sky/70" aria-hidden />
            <span>{item}</span>
          </div>
        ))}
      </div>
      <div className="pointer-events-none absolute inset-y-0 left-0 w-16 bg-gradient-to-r from-ink to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-ink to-transparent" />
    </div>
  );
}
