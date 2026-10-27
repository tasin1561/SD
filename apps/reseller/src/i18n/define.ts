import type { Catalog } from '@skydrop/ui/app/i18n';

/**
 * One entry per message: `[english, bangla]`. English and Bangla sit on the
 * same line on purpose — a reviewer reads them side by side, and a message
 * cannot ship with one half missing because there is no second file to forget.
 *
 *   'orders.title': ['My orders', 'আমার অর্ডার'],
 *
 * Placeholders are `{name}` and must appear in BOTH halves (the unit spec
 * checks it). Never translate: SKU / AWB / order numbers, enum values, audit
 * action strings, setting keys, API error codes — those are data, not copy.
 */
export type Entry = readonly [en: string, bn: string];

export function defineMessages<const T extends Record<string, Entry>>(messages: T): T {
  return messages;
}

/** Split a merged `[en, bn]` table into the two flat catalogues the translator wants. */
export function toCatalogs<K extends string>(
  all: Readonly<Record<K, Entry>>,
): { readonly en: Catalog<K>; readonly bn: Catalog<K> } {
  const en = {} as Record<K, string>;
  const bn = {} as Record<K, string>;
  for (const key of Object.keys(all) as K[]) {
    en[key] = all[key][0];
    bn[key] = all[key][1];
  }
  return { en, bn };
}
