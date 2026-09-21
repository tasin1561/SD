import type { ReactElement } from 'react';
import { Facebook, Instagram, Linkedin, MessageCircle } from 'lucide-react';
import { business, features, platform } from '@/content/site';
import '@/components/chrome/chrome.css';

const SOCIAL_ICONS: Record<string, ReactElement> = {
  facebook: <Facebook size={18} />,
  instagram: <Instagram size={18} />,
  linkedin: <Linkedin size={18} />,
  whatsapp: <MessageCircle size={18} />,
};

/**
 * The footer (u01): a brand block with the one-line description and
 * coloured circular social buttons; link columns whose links carry a
 * marker and slide right on hover; a highlighted newsletter card that
 * renders NOTHING while `features.newsletter` is false (there is no
 * endpoint, and a form that fakes success is worse than no form); and a
 * legal bar. The corridor gradient is a 3px hairline along the top —
 * decorative, it carries no text.
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
          <div className="lg:col-span-4">
            <div className="flex items-center gap-2.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/brand/skydrop-icon@2x.webp"
                srcSet="/brand/skydrop-icon@1x.webp 1x, /brand/skydrop-icon@2x.webp 2x, /brand/skydrop-icon@3x.webp 3x"
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
            <p className="mt-3 max-w-[40ch] text-[15px] leading-relaxed text-fg-body">
              Courier and fulfilment for the {platform.brand.corridor} corridor — we hold your stock
              in India, confirm every order by phone, deliver it, handle the returns and itemise
              your money.
            </p>
            <div className="footer__social">
              {business.social.map((s) => (
                <a
                  key={s.id}
                  href={s.href}
                  data-net={s.id}
                  aria-label={s.label}
                  target="_blank"
                  rel="noopener"
                >
                  {SOCIAL_ICONS[s.id]}
                </a>
              ))}
            </div>
          </div>

          <nav className="grid grid-cols-2 gap-8 sm:grid-cols-3 lg:col-span-5" aria-label="Footer">
            {platform.footer.columns.map((col) => (
              <div key={col.title}>
                <div className="mb-3 text-[12px] font-semibold uppercase tracking-[0.08em] text-fg-faint">
                  {col.title}
                </div>
                <ul className="m-0 list-none space-y-0.5 p-0">
                  {col.links.map((l) => (
                    <li key={l.label}>
                      <a
                        href={l.href}
                        {...('external' in l && l.external
                          ? { target: '_blank', rel: 'noopener' }
                          : {})}
                        className="footer__link"
                      >
                        {l.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>

          <div className="lg:col-span-3">
            {features.newsletter ? (
              <div className="footer__news">
                <span className="font-bold">Stay in the loop</span>
                <span className="text-[13px]">Rate changes and new lanes, once a month.</span>
              </div>
            ) : (
              <div className="rounded-2xl border border-line bg-surface p-4 text-[14px] text-fg-body">
                <span className="block font-bold text-fg-strong">Talk to a person</span>
                <a href={business.hotlineHref} className="mt-1 block tabular text-blue-text">
                  {business.hotline}
                </a>
                <span className="mt-1 block text-[13px] text-fg-muted">
                  {business.hoursDays} · {business.hoursTime} ({business.hoursZone})
                </span>
              </div>
            )}
          </div>
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
