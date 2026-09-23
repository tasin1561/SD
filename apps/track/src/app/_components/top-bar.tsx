import type { ReactElement } from 'react';
import Link from 'next/link';
import { ThemeSwitch } from '@skydrop/ui/app/theme-switch';
import { type Locale, t } from '@/lib/i18n';
import { LocaleSwitcher } from './locale-switcher';

/**
 * The one strip across the top of every tracking page: the brand (home
 * link), then the theme switch (System / Light / Dark), the language
 * switcher and, on a parcel page, "Track another".
 */
export function TopBar({
  locale,
  trackAnother = false,
}: {
  readonly locale: Locale;
  readonly trackAnother?: boolean;
}): ReactElement {
  return (
    <header className="tr-top">
      <Link href="/" className="tr-brand">
        {/* eslint-disable-next-line @next/next/no-img-element -- a static SVG mark, sized in markup */}
        <img
          src="/brand/skydrop-icon.svg"
          alt=""
          aria-hidden="true"
          width={57}
          height={28}
          className="tr-brand__mark"
          draggable={false}
        />
        <span className="tr-brand__name">{t(locale, 'brand')}</span>
      </Link>
      <div className="tr-top__controls">
        {trackAnother && (
          <Link href="/" className="tr-top__link">
            {t(locale, 'trackAnother')}
          </Link>
        )}
        <ThemeSwitch />
        <LocaleSwitcher active={locale} />
      </div>
    </header>
  );
}
