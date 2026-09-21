import Link from 'next/link';
import { Calculator, PackageSearch, Send } from 'lucide-react';
import type { ReactElement } from 'react';
import { platform } from '@/content/site';

/**
 * Three thumb-reachable actions on a phone: Track, Quote, Book. Fixed to
 * the bottom edge below `md`, inside the safe area. `body` reserves its
 * height in globals.css so the last section is never hidden under it.
 * Track and Book are NAVIGATIONS and fire at once (no delayed motion on a
 * link — spec §8 rule 1); Quote jumps to the estimator.
 */
export function MobileBottomBar(): ReactElement {
  const item =
    'flex min-h-14 flex-1 flex-col items-center justify-center gap-1 text-[12px] font-medium text-fg-body hover:text-fg-strong';
  return (
    <nav
      aria-label="Quick actions"
      className="safe-b fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface-2/95 backdrop-blur-md md:hidden"
    >
      <div className="flex">
        <a href={platform.nav.track.href} className={item}>
          <PackageSearch size={20} aria-hidden="true" />
          Track
        </a>
        <Link href="/#quote" className={item}>
          <Calculator size={20} aria-hidden="true" />
          Quote
        </Link>
        <Link href={platform.nav.cta.href} className={`${item} text-blue-text`}>
          <Send size={20} aria-hidden="true" />
          Book
        </Link>
      </div>
    </nav>
  );
}
