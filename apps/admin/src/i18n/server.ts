import 'server-only';
import { cookies } from 'next/headers';
import {
  LOCALE_COOKIE_NAME,
  makeTranslator,
  resolveLocale,
  type Locale,
  type Translate,
} from '@skydrop/ui/app/i18n';
import { CATALOGS, type MessageKey } from './catalog';

/** The language the request was made in: the `sd-lang` cookie, English when absent. */
export async function getLocale(): Promise<Locale> {
  return resolveLocale((await cookies()).get(LOCALE_COOKIE_NAME)?.value);
}

/** The translator for server components, bound to the request's language. */
export async function getT(): Promise<{ t: Translate<MessageKey>; locale: Locale }> {
  const locale = await getLocale();
  return { t: makeTranslator<MessageKey>(CATALOGS[locale], CATALOGS.en), locale };
}
