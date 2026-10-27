'use client';

import { useRouter } from 'next/navigation';
import { useCallback, type ReactElement, type ReactNode } from 'react';
import { LocaleProvider, useTranslator } from '@skydrop/ui/app/i18n-client';
import type { Locale, Translate } from '@skydrop/ui/app/i18n';
import { CATALOGS, type MessageKey } from './catalog';

/**
 * The seller console's language provider. A switch updates every CLIENT
 * component at once from state; `router.refresh()` re-runs the SERVER
 * components against the cookie the switch just wrote — so nothing needs a
 * reload and nothing the person typed is lost (a refresh keeps client state).
 */
export function AppLocaleProvider({
  initialLocale,
  children,
}: {
  initialLocale: Locale;
  children: ReactNode;
}): ReactElement {
  const router = useRouter();
  const refresh = useCallback(() => router.refresh(), [router]);
  return (
    <LocaleProvider initialLocale={initialLocale} onLocaleChange={refresh}>
      {children}
    </LocaleProvider>
  );
}

/** The translator for client components. Keys are type-checked. */
export function useT(): Translate<MessageKey> {
  return useTranslator<MessageKey>(CATALOGS);
}

export { useLocale } from '@skydrop/ui/app/i18n-client';
export { richMessage } from '@skydrop/ui/app/i18n-client';
