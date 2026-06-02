import type { ReactElement } from 'react';
import { SearchForm } from './_components/search-form';
import { LocaleSwitcher } from './_components/locale-switcher';
import { getActiveLocale } from '@/lib/locale';
import { t } from '@/lib/i18n';

/**
 * Public landing — anonymous AWB tracking lookup.
 *
 * No auth, no shell. Black background, centered card. Locale read
 * from cookie at request time; LocaleSwitcher sets the cookie and
 * reloads. Form navigates to /[awb]; that route SSRs the lookup.
 */
export default async function Home(): Promise<ReactElement> {
  const locale = await getActiveLocale();
  return (
    <div className="min-h-screen grid place-items-center bg-bg text-text-body p-6">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center relative">
          <div className="text-text-bright font-semibold text-2xl tracking-tight">
            {t(locale, 'brand')}
          </div>
          <div className="text-text-faint text-xs mt-1">
            {t(locale, 'tagline')}
          </div>
          <div className="absolute right-0 top-1">
            <LocaleSwitcher active={locale} />
          </div>
        </div>
        <div className="rounded-[7px] border border-border bg-surface p-6">
          <h1 className="text-text-bright text-base font-semibold mb-1">
            {t(locale, 'landingTitle')}
          </h1>
          <p className="text-text-muted text-xs mb-5">
            {t(locale, 'landingSubtitle')}
          </p>
          <SearchForm locale={locale} />
        </div>
      </div>
    </div>
  );
}
