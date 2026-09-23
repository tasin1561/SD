'use client';

import type { ReactElement } from 'react';
import type { Locale } from '@/lib/i18n';
import { t } from '@/lib/i18n';
import { LANG_COOKIE } from './locale-cookie';

/**
 * Locale switcher — writes the `lang` cookie then reloads so SSR
 * re-renders in the chosen language.
 */
export function LocaleSwitcher({ active }: { readonly active: Locale }): ReactElement {
  function set(next: Locale): void {
    const oneYear = 60 * 60 * 24 * 365;
    document.cookie = `${LANG_COOKIE}=${next}; path=/; max-age=${oneYear}; SameSite=Lax`;
    window.location.reload();
  }

  return (
    <div data-slot="locale-switcher" className="tr-lang" role="group" aria-label="Language">
      <button
        type="button"
        onClick={() => set('en')}
        className="tr-lang__opt"
        aria-pressed={active === 'en'}
      >
        {t('en', 'switchToEn')}
      </button>
      <button
        type="button"
        onClick={() => set('hi')}
        className="tr-lang__opt"
        aria-pressed={active === 'hi'}
        lang="hi"
      >
        {t('hi', 'switchToHi')}
      </button>
    </div>
  );
}
