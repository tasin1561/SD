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
    <div
      data-slot="locale-switcher"
      className="inline-flex items-center rounded-lg border border-line overflow-hidden text-xs"
    >
      <button
        type="button"
        onClick={() => set('en')}
        className={
          'inline-flex min-h-[36px] items-center px-3 transition-colors ' +
          (active === 'en'
            ? 'text-accent-fg bg-sky font-medium'
            : 'text-fg-muted hover:text-fg-strong hover:bg-surface-3')
        }
        aria-pressed={active === 'en'}
      >
        {t('en', 'switchToEn')}
      </button>
      <button
        type="button"
        onClick={() => set('hi')}
        className={
          'inline-flex min-h-[36px] items-center border-l border-line px-3 transition-colors ' +
          (active === 'hi'
            ? 'text-accent-fg bg-sky font-medium'
            : 'text-fg-muted hover:text-fg-strong hover:bg-surface-3')
        }
        aria-pressed={active === 'hi'}
      >
        {t('hi', 'switchToHi')}
      </button>
    </div>
  );
}
