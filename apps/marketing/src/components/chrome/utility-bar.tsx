import { Clock, Phone } from 'lucide-react';
import type { ReactElement } from 'react';
import { business, platform } from '@/content/site';

/**
 * The thin bar ABOVE the header — the corporate-courier convention every
 * reference site carries (Shiprocket's runs a promo; ours runs the facts a
 * visitor wants before reading anything: how to ring us, when we answer,
 * and where to sign in). Hidden below `md`: on a phone the same three
 * facts live in the floating contact fan and the drawer.
 */
export function UtilityBar(): ReactElement {
  return (
    <div className="hidden border-b border-line bg-surface-band text-[13px] text-fg-muted md:block">
      <div className="safe-x mx-auto flex h-9 max-w-7xl items-center justify-between gap-4 sm:px-6">
        <div className="flex items-center gap-5">
          <a
            href={business.hotlineHref}
            className="inline-flex items-center gap-1.5 font-medium text-fg-body hover:text-fg-strong"
          >
            <Phone size={13} aria-hidden="true" />
            <span className="tabular">{business.hotline}</span>
          </a>
          <span className="inline-flex items-center gap-1.5">
            <Clock size={13} aria-hidden="true" />
            {business.hoursDays} · {business.hoursTime} ({business.hoursZone})
          </span>
        </div>
        <div className="flex items-center gap-5">
          <a href={platform.nav.track.href} className="hover:text-fg-strong">
            {platform.nav.track.label}
          </a>
          {platform.nav.signIn.map((l) => (
            <a key={l.href} href={l.href} className="hover:text-fg-strong">
              {l.label}
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
