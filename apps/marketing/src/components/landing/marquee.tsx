import type { ReactElement } from 'react';

const ITEMS = [
  'COD call-confirm',
  'Bin-level WMS',
  'Delhivery API',
  'NDR routing',
  'RTO inspection',
  'INR → BDT remittance',
];

export function Marquee(): ReactElement {
  return (
    <div
      className="relative overflow-hidden border-y border-line bg-surface-2"
      aria-label="Capability strip"
    >
      <div className="marquee-track flex whitespace-nowrap py-3.5 will-change-transform">
        {[...ITEMS, ...ITEMS].map((item, i) => (
          <div
            key={i}
            className="flex items-center gap-8 pr-8 text-fg-muted font-mono text-xs tracking-wide"
          >
            <span className="w-1 h-1 rounded-full bg-sky/70" aria-hidden />
            <span>{item}</span>
          </div>
        ))}
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 w-16"
        style={{
          background:
            'linear-gradient(90deg, var(--surface-2), transparent)',
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 w-16"
        style={{
          background:
            'linear-gradient(-90deg, var(--surface-2), transparent)',
        }}
      />
    </div>
  );
}
