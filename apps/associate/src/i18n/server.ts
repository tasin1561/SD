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
  /*
    This console speaks English and Bangla. `Locale` also admits `hi`
    (the admin portal carries it), so the catalogue is chosen explicitly
    rather than indexed: a Hindi cookie set by another console on the
    same browser falls back to English here instead of failing to
    compile or, worse, resolving to undefined at runtime.
  */
  const catalog = locale === 'bn' ? CATALOGS.bn : CATALOGS.en;
  return { t: makeTranslator<MessageKey>(catalog, CATALOGS.en), locale };
}
