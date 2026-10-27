import { makeTranslator } from '@skydrop/ui/app/i18n';
import { toCatalogs } from './define';
import { cc } from './messages/cc';
import { common } from './messages/common';
import { cour } from './messages/cour';
import { extra } from './messages/extra';
import { inv } from './messages/inv';
import { misc } from './messages/misc';
import { money } from './messages/money';
import { orders } from './messages/orders';
import { ordersOps } from './messages/ordersOps';
import { rest } from './messages/rest';
import { sell } from './messages/sell';
import { shell } from './messages/shell';
import { wh } from './messages/wh';

/**
 * Every namespace, in one place. A namespace is a file of `[en, bn]` pairs;
 * the unit spec asserts no key is defined twice (a spread would silently let
 * the later file win) and that every `{placeholder}` appears in both languages.
 */
export const NAMESPACES = [
  common,
  shell,
  orders,
  extra,
  cc,
  cour,
  inv,
  misc,
  money,
  ordersOps,
  rest,
  sell,
  wh,
] as const;

const ALL = {
  ...common,
  ...shell,
  ...orders,
  ...extra,
  ...cc,
  ...cour,
  ...inv,
  ...misc,
  ...money,
  ...ordersOps,
  ...rest,
  ...sell,
  ...wh,
};

export type MessageKey = keyof typeof ALL;

/** `{ en, bn }`, each a flat key → string map. English is the fallback for Bangla. */
export const CATALOGS = toCatalogs<MessageKey>(ALL);

/**
 * The English translator, bound once. For the few exported constants and helpers that specs (and
 * non-React callers) read in English: they keep their old shape, built from the same catalogue the
 * screen uses, so the words live in exactly one place.
 */
export const tEn = makeTranslator<MessageKey>(CATALOGS.en, CATALOGS.en);
