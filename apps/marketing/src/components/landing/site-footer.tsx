import type { ReactElement } from 'react';

const CHIPS = [
  'Delhivery API-integrated',
  'WMS bin-level',
  'Webhook tracking',
];

const LINKS = [
  { href: 'https://track.skydrop.online', label: 'Track a parcel', external: true },
  { href: 'https://app.skydrop.online', label: 'Seller sign-in', external: true },
  { href: 'mailto:hello@skydrop.online', label: 'Contact' },
];

export function SiteFooter(): ReactElement {
  return (
    <footer className="bg-ink text-white border-t border-[var(--border-dark)]">
      <div className="max-w-7xl mx-auto px-5 sm:px-8 py-12 lg:py-14">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-10">
          <div>
            <div className="font-display font-semibold text-white text-lg">Skydrop</div>
            <p className="mt-2 text-sm text-[var(--muted-dark)]">
              © 2026 Skydrop · BD → IN cross-border logistics.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              {CHIPS.map((chip) => (
                <span
                  key={chip}
                  className="inline-flex items-center rounded-full bg-white/[0.04] border border-[var(--border-dark)] px-3 py-1 text-[11px] font-mono text-[var(--muted-dark)]"
                >
                  {chip}
                </span>
              ))}
            </div>
          </div>

          <nav
            className="flex flex-col sm:flex-row gap-2 sm:gap-6 text-sm"
            aria-label="Footer"
          >
            {LINKS.map((l) => (
              <a
                key={l.label}
                href={l.href}
                {...(l.external ? { target: '_blank', rel: 'noopener' } : {})}
                className="text-[var(--muted-dark)] hover:text-white transition-colors"
              >
                {l.label}
              </a>
            ))}
          </nav>
        </div>
      </div>
    </footer>
  );
}
