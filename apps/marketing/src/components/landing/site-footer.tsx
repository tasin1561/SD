import type { ReactElement } from 'react';
import { features, platform } from '@/content/site';

/**
 * A calm, neutral footer: the brand and what it does in one line, three
 * link columns from the content module, the legal line. The corridor
 * gradient is a 3px hairline along its top — decorative, carries no text.
 * The newsletter block renders NOTHING while `features.newsletter` is
 * false: there is no endpoint, and a form that fakes success is worse
 * than no form (spec §Form endpoints).
 */
export function SiteFooter(): ReactElement {
  return (
    <footer className="relative border-t border-line bg-surface-2">
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-[3px]"
        style={{ background: 'var(--corridor-gradient)' }}
      />
      <div className="safe-x mx-auto max-w-7xl py-12 sm:px-6 lg:py-14">
        <div className="grid gap-10 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <div className="flex items-center gap-2.5">
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
              <span className="text-[18px] font-bold tracking-tight text-fg-strong">
                {platform.brand.name}
              </span>
            </div>
            <p className="mt-3 max-w-[44ch] text-[15px] leading-relaxed text-fg-body">
              Courier and fulfilment for the {platform.brand.corridor} corridor — we hold your stock
              in India, confirm every order by phone, deliver it, handle the returns and itemise
              your money.
            </p>
            {features.newsletter ? null : null}
          </div>

          <nav className="grid grid-cols-2 gap-8 sm:grid-cols-3 lg:col-span-7" aria-label="Footer">
            {platform.footer.columns.map((col) => (
              <div key={col.title}>
                <div className="mb-3 text-[12px] font-semibold uppercase tracking-[0.08em] text-fg-faint">
                  {col.title}
                </div>
                <ul className="m-0 list-none space-y-1 p-0">
                  {col.links.map((l) => (
                    <li key={l.label}>
                      <a
                        href={l.href}
                        {...('external' in l && l.external
                          ? { target: '_blank', rel: 'noopener' }
                          : {})}
                        className="inline-flex min-h-8 items-center text-[14px] text-fg-muted transition-colors hover:text-fg-strong"
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
      <div className="border-t border-line bg-surface-band">
        <div className="safe-x mx-auto flex max-w-7xl flex-col items-start justify-between gap-2 py-3 text-[13px] text-fg-muted sm:flex-row sm:items-center sm:px-6">
          <span>{platform.footer.legal}</span>
          <span>Invite-only while we scale the warehouse.</span>
        </div>
      </div>
    </footer>
  );
}
