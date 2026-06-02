import 'server-only';
import { cookies } from 'next/headers';
import { DEFAULT_LOCALE, type Locale, isLocale } from './i18n';

export const LANG_COOKIE = 'lang';

/**
 * Read the active locale from the `lang` cookie (set by the
 * LocaleSwitcher). Falls back to default when missing or malformed.
 */
export async function getActiveLocale(): Promise<Locale> {
  const store = await cookies();
  const v = store.get(LANG_COOKIE)?.value;
  return isLocale(v) ? v : DEFAULT_LOCALE;
}
