import { makeTranslator, type Translate } from '@skydrop/ui/app/i18n';
import { CATALOGS, type MessageKey } from './catalog';

/**
 * The English translator, for pure vocabulary helpers (`routeWords`,
 * `eventWords`, …) that take an optional translator as their last argument.
 * Omitting it yields exactly the English those functions always returned, so
 * a caller that has no language (a spec, a server utility) is unchanged.
 */
export const englishT: Translate<MessageKey> = makeTranslator<MessageKey>(CATALOGS.en, CATALOGS.en);
