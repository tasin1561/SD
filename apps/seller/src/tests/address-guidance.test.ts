import { readFileSync } from 'node:fs';
import { CATALOGS } from '@/i18n/catalog';
import { IN_DIAL, IN_LOCAL_LENGTH, IN_PHONE_ERROR } from '@/lib/phone';
import { readEnglish } from './english-source';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ADDRESS_LINE_1_HINT,
  ADDRESS_LINE_2_HINT,
  DUPLICATE_LINES_ERROR,
  linesAreDuplicated,
} from '@/lib/address-guidance';

/**
 * The address guidance shown to sellers.
 *
 * The duplicate check is the part with logic in it, and the part that
 * decides whether a real order is refused — so the near-misses matter
 * more than the exact match.
 */

describe('linesAreDuplicated', () => {
  it('catches the exact copy-paste', () => {
    expect(linesAreDuplicated('12 MG Road, Bengaluru', '12 MG Road, Bengaluru')).toBe(true);
  });

  it('catches it through casing and stray whitespace', () => {
    // The seller who "fixed" it by retyping in a different case.
    expect(linesAreDuplicated('12 MG Road', '  12   mg   road ')).toBe(true);
  });

  it('allows a genuinely different line 2', () => {
    expect(linesAreDuplicated('12 MG Road', 'Near City Hospital')).toBe(false);
  });

  it('allows an empty line 2 — it is optional', () => {
    expect(linesAreDuplicated('12 MG Road', '')).toBe(false);
    expect(linesAreDuplicated('12 MG Road', '   ')).toBe(false);
  });

  it('does not fire when BOTH are empty', () => {
    // Otherwise a blank form shows an error before anything is typed.
    expect(linesAreDuplicated('', '')).toBe(false);
  });

  it('allows a line 2 that merely starts the same', () => {
    expect(linesAreDuplicated('12 MG Road', '12 MG Road Extension, Block B')).toBe(false);
  });
});

describe('the copy is in English and names the format', () => {
  it('line 1 lists the parts, in order', () => {
    for (const part of ['Village/City', 'Post Office', 'Police Station', 'District']) {
      expect(ADDRESS_LINE_1_HINT).toContain(part);
    }
  });

  it('line 1 no longer points at a State field, because there is not one', () => {
    expect(ADDRESS_LINE_1_HINT).not.toMatch(/State:/);
    expect(ADDRESS_LINE_1_HINT).not.toMatch(/State and PIN/);
    expect(ADDRESS_LINE_2_HINT).not.toMatch(/State:/);
  });

  it('line 2 IS the landmark field now, and still states the no-duplicate rule', () => {
    // The separate Landmark input was removed: what was typed there was
    // stored but never sent to Delhivery, whose address is line 1 + line 2.
    expect(ADDRESS_LINE_2_HINT.toLowerCase()).toContain('landmark');
    expect(ADDRESS_LINE_2_HINT.toLowerCase()).toContain('never a copy of line 1');
  });

  it('is all ASCII — the source instructions were Bengali', () => {
    for (const s of [ADDRESS_LINE_1_HINT, ADDRESS_LINE_2_HINT, DUPLICATE_LINES_ERROR]) {
      // eslint-disable-next-line no-control-regex
      expect(s).toMatch(/^[\x00-\x7F—’]*$/);
    }
  });
});

describe('both order forms read the same copy', () => {
  // Two screens edit the same fields. If one grows its own wording the
  // seller is told different things depending on the route they took.
  const forms = [
    'app/(authed)/orders/new/_components/new-order-form.tsx',
    'app/(authed)/orders/[id]/edit/_components/edit-order-form.tsx',
  ];

  it.each(forms)('%s imports the shared module rather than inlining strings', (rel) => {
    const src = readEnglish(join(__dirname, '../', rel));
    expect(src).toContain("from '@/lib/address-guidance'");
    // The hints and the duplicate-lines error are catalogue keys now (so Bangla
    // can follow); the English behind each key is pinned to the lib constants
    // by the parity spec below, so the two cannot drift.
    const raw = readFileSync(join(__dirname, '../', rel), 'utf8');
    expect(raw).toContain("'guidance.addressLine1Hint'");
    expect(raw).toContain("'guidance.addressLine2Hint'");
    // The rule must gate submission, not merely be displayed.
    expect(src).toContain('linesAreDuplicated');
    expect(raw).toContain("'guidance.duplicateLines'");
  });

  it('the catalogue says exactly what the shared constants say, in English', () => {
    expect(CATALOGS.en['guidance.addressLine1Hint']).toBe(ADDRESS_LINE_1_HINT);
    expect(CATALOGS.en['guidance.addressLine2Hint']).toBe(ADDRESS_LINE_2_HINT);
    expect(CATALOGS.en['guidance.duplicateLines']).toBe(DUPLICATE_LINES_ERROR);
    expect(
      CATALOGS.en['guidance.phoneError']
        .replace('{len}', String(IN_LOCAL_LENGTH))
        .replace('{dial}', IN_DIAL),
    ).toBe(IN_PHONE_ERROR);
  });

  it.each(forms)('%s no longer collects a separate landmark', (rel) => {
    const src = readEnglish(join(__dirname, '../', rel));
    expect(src).not.toContain('recipientLandmark');
    expect(src).not.toMatch(/label="Landmark"/);
  });

  it.each(forms)('%s no longer asks for city or state', (rel) => {
    // Delhivery routes on the PIN and resolves the locality itself.
    const src = readEnglish(join(__dirname, '../', rel));
    expect(src).not.toContain('recipientCity');
    expect(src).not.toContain('recipientStateProvince');
    expect(src).not.toContain('INDIAN_STATES');
  });

  it.each(forms)('%s requires the landmark before it will submit', (rel) => {
    // Marked required in the markup AND gated in code — a red asterisk
    // that nothing enforces is decoration.
    const src = readEnglish(join(__dirname, '../', rel));
    expect(src).toContain('the landmark) is required');
  });

  it('the edit form gates BOTH of its submit paths', () => {
    // "Save + submit" ran no validation at all, so it was a way around
    // the phone and address rules that "Save" enforces.
    const src = readEnglish(join(__dirname, '../', forms[1]!));
    const guards = src.match(/phoneProblem\(\) \?\? addressProblem\(\)/g) ?? [];
    expect(guards.length).toBe(2);
  });
});
