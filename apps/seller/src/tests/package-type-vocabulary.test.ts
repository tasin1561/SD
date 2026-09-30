import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PACKAGE_TYPES, isPackageType, packageWords } from '@/lib/package-type';

/**
 * The seller app's package types are the DATABASE's, not its own.
 *
 * It had invented three — STANDARD, FRAGILE and DOCUMENT — over an enum
 * that has only ever held BOX, POLYBAG, ENVELOPE, TUBE and CUSTOM. The
 * edit form sent `packageType` on every save, so `@IsEnum(PackageType)`
 * refused every one and NO ORDER EDIT COULD BE SAVED AT ALL, draft or
 * pending, whatever the seller had changed. Found by filming the edit
 * screen (2026-09-30).
 *
 * Pinned against `schema.prisma` itself rather than against a copy of
 * the list: a second hand-written list is the thing that went wrong, and
 * a test holding one would drift the same way.
 */
const SCHEMA = join(__dirname, '..', '..', '..', '..', 'packages', 'db', 'prisma', 'schema.prisma');

function enumValues(name: string): string[] {
  const src = readFileSync(SCHEMA, 'utf8');
  const block = new RegExp(`enum ${name} \\{([^}]*)\\}`).exec(src);
  if (block?.[1] === undefined) throw new Error(`no enum ${name} in schema.prisma`);
  return block[1]
    .split('\n')
    .map((l) => l.trim().split(/\s+/)[0] ?? '')
    .filter((v) => /^[A-Z_]+$/.test(v));
}

describe('what a parcel may be packed in', () => {
  it('offers exactly what the database accepts', () => {
    expect([...PACKAGE_TYPES].sort()).toEqual(enumValues('PackageType').sort());
  });

  it('has a word for every one of them', () => {
    for (const value of PACKAGE_TYPES) {
      // Not the raw enum name: the fallback returns the value as it came,
      // so a missing case would pass a looser assertion.
      expect(packageWords(value)).not.toBe(value);
      expect(packageWords(value)).toMatch(/^[A-Z]/);
    }
  });

  it('refuses the three it used to invent', () => {
    for (const invented of ['STANDARD', 'FRAGILE', 'DOCUMENT']) {
      expect(isPackageType(invented)).toBe(false);
    }
  });
});
