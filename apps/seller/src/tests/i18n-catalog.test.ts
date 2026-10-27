import { describe, expect, it } from 'vitest';
import { UI_MESSAGES } from '@skydrop/ui/app/i18n';
import { CATALOGS, NAMESPACES } from '@/i18n/catalog';

/*
  The catalogue is a table of [english, bangla] pairs, so the failure modes
  are not "a missing file" but quiet ones: a key defined twice (a spread lets
  the later namespace win without a word), a placeholder dropped from one
  language ({n} in English, nothing in Bangla), and Bengali digits sneaking
  in where numerals must stay 0-9.
*/

const placeholders = (s: string): string[] =>
  [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? '').sort();
const BENGALI_DIGIT = /[০-৯]/;

describe('seller message catalogue', () => {
  it('defines every key exactly once across all namespaces', () => {
    const seen = new Map<string, number>();
    for (const ns of NAMESPACES)
      for (const k of Object.keys(ns)) seen.set(k, (seen.get(k) ?? 0) + 1);
    const dupes = [...seen].filter(([, n]) => n > 1).map(([k]) => k);
    expect(dupes).toEqual([]);
    expect(Object.keys(CATALOGS.en).length).toBe(seen.size);
  });

  it('has a non-empty Bangla string for every English one, with the same placeholders', () => {
    for (const key of Object.keys(CATALOGS.en) as Array<keyof typeof CATALOGS.en>) {
      const en = CATALOGS.en[key];
      const bn = CATALOGS.bn[key];
      expect(en.trim(), `${key} (en)`).not.toBe('');
      expect(bn.trim(), `${key} (bn)`).not.toBe('');
      expect(placeholders(bn), `${key} placeholders`).toEqual(placeholders(en));
    }
  });

  it('keeps numerals Western (0-9) in Bangla copy', () => {
    for (const [key, v] of Object.entries(CATALOGS.bn)) {
      expect(BENGALI_DIGIT.test(v), key).toBe(false);
    }
  });

  it('actually translates (Bangla differs from English) for every sentence', () => {
    // A string that is identical in both is either a brand/protocol word or a
    // forgotten translation. Allow only the short ones; any sentence must differ.
    for (const key of Object.keys(CATALOGS.en) as Array<keyof typeof CATALOGS.en>) {
      if (CATALOGS.en[key] === CATALOGS.bn[key])
        expect(CATALOGS.en[key].length, key).toBeLessThan(24);
    }
  });
});

describe('shared UI catalogue', () => {
  it('has Bangla for every key, same placeholders, Western numerals', () => {
    for (const key of Object.keys(UI_MESSAGES.en) as Array<keyof typeof UI_MESSAGES.en>) {
      expect(UI_MESSAGES.bn[key].trim(), key).not.toBe('');
      expect(placeholders(UI_MESSAGES.bn[key]), key).toEqual(placeholders(UI_MESSAGES.en[key]));
      expect(BENGALI_DIGIT.test(UI_MESSAGES.bn[key]), key).toBe(false);
    }
  });
});
