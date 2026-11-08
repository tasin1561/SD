import type { Catalog } from '@skydrop/ui/app/i18n';

/**
 * One entry per message: `[english, bangla, hindi]`. The three sit on the
 * same line on purpose — a reviewer reads them side by side, and a message
 * cannot ship with a half missing because there is no second file to forget.
 *
 *   'orders.title': ['My orders', 'আমার অর্ডার', 'मेरे ऑर्डर'],
 *
 * Placeholders are `{name}` and must appear in EVERY half (the unit spec
 * checks it). Never translate: SKU / AWB / order numbers, enum values, audit
 * action strings, setting keys, API error codes — those are data, not copy.
 *
 * ── HINDI IS OPTIONAL, ON PURPOSE (2026-11-08) ───────────────────────
 * Hindi is arriving file by file across 8,352 messages, so the third slot
 * is optional and a key without one falls back to ENGLISH, never to
 * Bangla. A phased translation must be able to ship after each phase;
 * requiring all three up front would mean one commit of eight thousand
 * strings nobody could review.
 *
 * It is `hi?: string` rather than a separate file because the reason the
 * other two share a line has not changed: a translator reads the source
 * beside the target, and a key that exists in one file and not another is
 * exactly the drift this shape was chosen to prevent.
 */
export type Entry = readonly [en: string, bn: string, hi?: string];

export function defineMessages<const T extends Record<string, Entry>>(messages: T): T {
  return messages;
}

/**
 * Split a merged `[en, bn, hi?]` table into the flat catalogues the
 * translator wants.
 *
 * An untranslated Hindi key falls back to the ENGLISH string, not the
 * Bangla one. A Hindi reader shown Bangla has been handed a script they
 * may not read at all; shown English they have been handed the language
 * the whole console already speaks. The fallback should degrade toward
 * the thing everyone can use.
 */
export function toCatalogs<K extends string>(
  all: Readonly<Record<K, Entry>>,
): { readonly en: Catalog<K>; readonly bn: Catalog<K>; readonly hi: Catalog<K> } {
  const en = {} as Record<K, string>;
  const bn = {} as Record<K, string>;
  const hi = {} as Record<K, string>;
  for (const key of Object.keys(all) as K[]) {
    en[key] = all[key][0];
    bn[key] = all[key][1];
    hi[key] = all[key][2] ?? all[key][0];
  }
  return { en, bn, hi };
}

/** How much of the Hindi catalogue is real rather than falling back. */
export function hindiCoverage<K extends string>(
  all: Readonly<Record<K, Entry>>,
): {
  readonly translated: number;
  readonly total: number;
} {
  const keys = Object.keys(all) as K[];
  return {
    translated: keys.filter((k) => all[k][2] !== undefined).length,
    total: keys.length,
  };
}
