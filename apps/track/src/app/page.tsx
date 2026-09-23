import type { ReactElement } from 'react';
import { LazyCorridorMap } from '@skydrop/ui/app/sign-in-map';
import { getActiveLocale } from '@/lib/locale';
import { t } from '@/lib/i18n';
import { SearchForm } from './_components/search-form';
import { TopBar } from './_components/top-bar';

/**
 * Public landing — anonymous AWB lookup, brand skin (apps restyle).
 * One card, one field, one button; the corridor map is a calm background
 * that arrives after first paint (it never holds up the form).
 * Bilingual via the `lang` cookie.
 */
export default async function Home(): Promise<ReactElement> {
  const locale = await getActiveLocale();
  return (
    <div className="tr-page">
      <LazyCorridorMap className="tr-map" />
      <div aria-hidden className="tr-veil" />
      <div className="tr-wrap tr-wrap--narrow">
        <TopBar locale={locale} />
        <main className="tr-home">
          <p className="tr-home__eyebrow">{t(locale, 'tagline')}</p>
          <div className="tr-card tr-lookup" data-lookup-panel>
            <h1 className="tr-lookup__title">{t(locale, 'landingTitle')}</h1>
            <p className="tr-lookup__sub">{t(locale, 'landingSubtitle')}</p>
            <SearchForm locale={locale} />
          </div>
        </main>
      </div>
    </div>
  );
}
