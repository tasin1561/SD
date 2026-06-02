'use client';

import type { ReactElement } from 'react';
import type { Locale } from '@/lib/i18n';
import { t } from '@/lib/i18n';
import { LANG_COOKIE } from './locale-cookie';

/**
 * Tiny client-only locale switcher — writes the `lang` cookie via
 * `document.cookie` then reloads to re-render with the new locale.
 *
 * No router push (it would not re-fetch SSR data); no API call (the
 * locale is a client preference). Cookie is `Lax` + 1-year so the
 * choice persists across visits but isn't sent on cross-site requests.
 */
export function LocaleSwitcher({ active }: { readonly active: Locale }): ReactElement {
  function set(next: Locale): void {
    const oneYear = 60 * 60 * 24 * 365;
    document.cookie = `${LANG_COOKIE}=${next}; path=/; max-age=${oneYear}; SameSite=Lax`;
    window.location.reload();
  }

  return (
    <div className="inline-flex items-center gap-1 text-xs">
      <button
        type="button"
        onClick={() => set('en')}
        className={
          'px-2 py-0.5 rounded-[4px] transition-colors ' +
          (active === 'en'
            ? 'text-text-bright bg-surface border border-border'
            : 'text-text-muted hover:text-text-body')
        }
        aria-pressed={active === 'en'}
      >
        {t('en', 'switchToEn')}
      </button>
      <button
        type="button"
        onClick={() => set('hi')}
        className={
          'px-2 py-0.5 rounded-[4px] transition-colors ' +
          (active === 'hi'
            ? 'text-text-bright bg-surface border border-border'
            : 'text-text-muted hover:text-text-body')
        }
        aria-pressed={active === 'hi'}
      >
        {t('hi', 'switchToHi')}
      </button>
    </div>
  );
}
