import type { ReactElement } from 'react';
import { LiveDot } from './chrome';

/**
 * Status-bar footer. The readouts are capability statements, not
 * uptime figures — each one is a thing the system does, and each is
 * true of the system as built.
 */

const READOUTS = [
  'warehouse · india',
  'wms · bin-level',
  'call desk · every cod order',
  'couriers · delhivery + shiprocket',
  'tracking · courier webhooks',
  'remittance · inr → bdt',
];

const COLUMNS: { title: string; links: { href: string; label: string; external?: boolean }[] }[] = [
  {
    title: 'service',
    links: [
      { href: '/#diagnostics', label: 'The problem' },
      { href: '/#how-it-works', label: 'How it works' },
      { href: '/#why-skydrop', label: 'Why Skydrop' },
      { href: '/#manifest', label: 'Compare routes' },
      { href: '/#faq', label: 'Questions' },
    ],
  },
  {
    title: 'access',
    links: [
      { href: '/request-invite', label: 'Request an invite' },
      { href: 'https://app.skydrop.online', label: 'Seller sign-in', external: true },
      { href: 'https://track.skydrop.online', label: 'Track a parcel', external: true },
    ],
  },
  {
    title: 'company',
    links: [
      { href: 'mailto:hello@skydrop.online', label: 'hello@skydrop.online' },
      { href: '/privacy', label: 'Privacy' },
    ],
  },
];

export function SiteFooter(): ReactElement {
  return (
    <footer className="border-t border-line bg-surface-2">
      <div className="mx-auto max-w-7xl px-5 py-12 sm:px-6 lg:py-14">
        <div className="grid gap-10 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <div className="flex items-center gap-2.5">
              {/* A plain <img> for the same reason as the nav's: static
                  export, 24px SVG, nothing for the optimiser to do. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/brand/skydrop-icon.svg"
                alt=""
                aria-hidden="true"
                width={53}
                height={26}
                className="h-6 w-auto shrink-0 select-none"
                draggable={false}
              />
              <span className="text-[17px] font-bold tracking-tight text-fg-strong">Skydrop</span>
            </div>
            <p className="mt-3 max-w-[42ch] text-[14px] leading-relaxed text-fg-body">
              The operational backbone for Bangladeshi sellers shipping into India — warehousing,
              COD call-confirmation, courier dispatch, returns and remittance.
            </p>
            <div className="mt-5 flex flex-wrap gap-1.5">
              {READOUTS.map((chip) => (
                <span
                  key={chip}
                  className="mono-caps inline-flex items-center rounded-sm border border-line bg-surface-band px-2 py-1 text-fg-muted"
                >
                  {chip}
                </span>
              ))}
            </div>
          </div>

          <nav className="grid grid-cols-2 gap-8 sm:grid-cols-3 lg:col-span-7" aria-label="Footer">
            {COLUMNS.map((col) => (
              <div key={col.title}>
                <div className="mono-caps mb-3 text-fg-faint">{col.title}</div>
                <ul className="m-0 list-none space-y-1 p-0">
                  {col.links.map((l) => (
                    <li key={l.label}>
                      <a
                        href={l.href}
                        {...(l.external ? { target: '_blank', rel: 'noopener' } : {})}
                        className="inline-flex items-center text-[13px] text-fg-muted transition-colors hover:text-fg-strong"
                      >
                        {l.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>
      </div>

      {/* Status strip */}
      <div className="border-t border-line bg-surface-band">
        <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-2 px-5 py-3 sm:flex-row sm:items-center sm:px-6">
          <span className="mono-caps flex items-center gap-2 text-fg-muted">
            <LiveDot />
            <span className="text-fg-strong">corridor BD &rarr; IN</span>
            <span aria-hidden className="text-fg-faint">
              {'//'}
            </span>
            <span>invite-only beta</span>
          </span>
          <span className="mono-caps text-fg-faint">© 2026 Skydrop · cross-border fulfilment</span>
        </div>
      </div>
    </footer>
  );
}
