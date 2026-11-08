import { describe, expect, it } from 'vitest';
import { UI_MESSAGES } from '@skydrop/ui/app/i18n';
import { CATALOGS, NAMESPACES } from '@/i18n/catalog';
import { hindiCoverage, type Entry } from '@/i18n/define';

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

describe('admin message catalogue', () => {
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
      // The plural suffixes are the one deliberate exception: English builds
      // "issue" + "s", Bangla has no plural suffix, so its half is empty.
      if (!key.startsWith('common.plural')) expect(bn.trim(), `${key} (bn)`).not.toBe('');
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

/*
  HINDI. Deliberately partial and arriving in phases, so nothing here requires
  coverage: a missing `hi` is legal, a malformed one is not. Every failure
  message names the KEY and shows both strings.
*/

const BENGALI_BLOCK = /[\u0980-\u09FF]/;
// U+0964/0965 (danda) are shared punctuation, used by both scripts, so excluded.
const DEVANAGARI_BLOCK = /[\u0900-\u0963\u0966-\u097F]/;
const ANY_NON_WESTERN_DIGIT = /[\u0966-\u096F\u09E6-\u09EF]/;
// Suffix keys that are deliberately empty in bn and hi (English builds "issue" + "s").
const EMPTY_HI_ALLOWED = new Set(['common.pluralS', 'common.pluralEs']);

const ENTRIES: Record<string, Entry> = Object.assign({}, ...NAMESPACES) as Record<string, Entry>;

describe('admin Hindi catalogue (partial by design)', () => {
  const withHi = Object.entries(ENTRIES).filter(([, e]) => e[2] !== undefined);

  it('reports Hindi coverage without failing on a gap', () => {
    const c = hindiCoverage(ENTRIES);
    const uiHi = Object.keys(UI_MESSAGES.hi).length;
    console.log(
      `[hindi coverage] admin: ${c.translated}/${c.total} (${((100 * c.translated) / c.total).toFixed(1)}%); ui-messages: ${uiHi}/${Object.keys(UI_MESSAGES.en).length}`,
    );
    expect(c.total).toBe(Object.keys(CATALOGS.en).length);
  });

  it('keeps placeholders identical to English in every Hindi string', () => {
    for (const [key, e] of withHi) {
      expect(placeholders(e[2] ?? ''), `${key}\n  en: ${e[0]}\n  hi: ${e[2]}`).toEqual(
        placeholders(e[0]),
      );
    }
  });

  it('has no Bengali characters in Hindi and no Devanagari in Bangla', () => {
    for (const [key, e] of Object.entries(ENTRIES)) {
      if (e[2] !== undefined)
        expect(BENGALI_BLOCK.test(e[2]), `${key} (hi has Bengali)\n  hi: ${e[2]}`).toBe(false);
      expect(DEVANAGARI_BLOCK.test(e[1]), `${key} (bn has Devanagari)\n  bn: ${e[1]}`).toBe(false);
    }
  });

  it('keeps numerals 0-9 (no Devanagari or Bengali digits) in every string', () => {
    for (const [key, e] of Object.entries(ENTRIES))
      for (const v of e)
        if (v !== undefined)
          expect(ANY_NON_WESTERN_DIGIT.test(v), `${key}\n  string: ${v}`).toBe(false);
  });

  it('has no empty Hindi string except the plural suffix keys', () => {
    for (const [key, e] of withHi) {
      if (EMPTY_HI_ALLOWED.has(key)) continue;
      expect(
        (e[2] ?? '').trim(),
        `${key} has an empty hi (omit the slot instead)\n  en: ${e[0]}`,
      ).not.toBe('');
    }
  });
});

describe('shared UI Hindi catalogue (partial by design)', () => {
  const hi = UI_MESSAGES.hi as Record<string, string | undefined>;
  const en = UI_MESSAGES.en as Record<string, string>;

  it('only uses keys English has', () => {
    const stray = Object.keys(hi).filter((k) => !(k in en));
    expect(stray, `hi keys with no English key (never render): ${stray.join(', ')}`).toEqual([]);
  });

  it('is well-formed for every Hindi string present', () => {
    for (const [key, v] of Object.entries(hi)) {
      const msg = `${key}\n  en: ${en[key]}\n  hi: ${v}`;
      expect((v ?? '').trim(), `${msg}\n(empty)`).not.toBe('');
      expect(placeholders(v ?? ''), msg).toEqual(placeholders(en[key] ?? ''));
      expect(BENGALI_BLOCK.test(v ?? ''), `${msg}\n(Bengali)`).toBe(false);
      expect(ANY_NON_WESTERN_DIGIT.test(v ?? ''), `${msg}\n(non-Western digit)`).toBe(false);
    }
    for (const [key, v] of Object.entries(UI_MESSAGES.bn)) {
      expect(DEVANAGARI_BLOCK.test(v), `${key} (bn has Devanagari)\n  bn: ${v}`).toBe(false);
    }
  });
});
