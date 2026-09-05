import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every audience the API can resolve is one a person can pick.
 *
 * The first version of the broadcast screen offered five of ten. The
 * other five were not broken — they were unreachable, which looks
 * identical to not having been built and is the same class of gap as an
 * endpoint with no caller. A capability nobody can invoke is one nobody
 * knows they have.
 *
 * Source-read rather than rendered: the question is which selectors the
 * screen DECLARES, and the file is the honest place to read that.
 */
const VIEW = join(
  __dirname,
  '../app/(authed)/notifications/broadcasts/_components/broadcasts-view.tsx',
);

/** Every selector kind the API's union declares. */
const API_KINDS = [
  'ALL_SELLERS',
  'SELLER_ORG',
  'SELLER_ROLE',
  'SELLER_PERMISSION',
  'SELLER_USER',
  'ALL_STAFF',
  'STAFF_ROLE',
  'STAFF_PERMISSION',
  'STAFF_USER',
  'SUBSCRIBERS',
] as const;

describe('the broadcast screen reaches every audience the API has', () => {
  const src = readFileSync(VIEW, 'utf8');

  it('finds the selectors (guards against a scan that silently matches nothing)', () => {
    expect(/kind: '[A-Z_]+'/.test(src)).toBe(true);
  });

  it('offers all ten', () => {
    const offered = new Set([...src.matchAll(/kind: '([A-Z_]+)'/g)].map((m) => m[1]));
    const missing = API_KINDS.filter((k) => !offered.has(k));
    expect(missing).toEqual([]);
  });

  it('every option that needs a value asks for one', () => {
    // A selector missing half of itself resolves to nobody, and "0
    // people" is a confusing way to learn a box was left empty. Two
    // options were dropped from the first version rather than shipped
    // with one field between them.
    //
    // Each option is one `label:`-headed block; ALL_SELLERS and
    // ALL_STAFF are the only two that legitimately need nothing typed.
    const blocks = src.split(/\n  \{\n    label:/).slice(1);
    expect(blocks.length).toBe(10);
    for (const block of blocks) {
      const kind = /kind: '([A-Z_]+)'/.exec(block)?.[1] ?? '';
      const fields = /fields: \[([^\]]*)\]/.exec(block)?.[1]?.trim() ?? '';
      if (kind === 'ALL_SELLERS' || kind === 'ALL_STAFF') {
        expect(fields).toBe('');
      } else {
        expect(fields.length).toBeGreaterThan(0);
      }
    }
  });

  it('preview is blocked until every named field is filled', () => {
    expect(src).toContain('audienceComplete');
    expect(src).toMatch(/disabled=\{[^}]*!audienceComplete/);
  });
});
