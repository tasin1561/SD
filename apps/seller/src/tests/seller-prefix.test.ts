import { describe, expect, it } from 'vitest';
import { prefixHint, stripSellerPrefix } from '@/lib/seller-prefix';

/**
 * The display half of the seller code on recipient names.
 *
 * The compose lives server-side (every entry path must agree, and only
 * the server sees all of them); this strips for the edit form. The
 * strip is the risky direction — too eager and it eats part of a real
 * customer's name in a field they are about to save.
 */

describe('stripSellerPrefix', () => {
  it('takes the code off a stored name', () => {
    expect(stripSellerPrefix('MSt', 'MSt John Doe')).toBe('John Doe');
  });

  it('leaves an unprefixed name alone', () => {
    expect(stripSellerPrefix('MSt', 'John Doe')).toBe('John Doe');
  });

  it('needs the separator, so a real name survives', () => {
    expect(stripSellerPrefix('MSt', 'MStanley Roy')).toBe('MStanley Roy');
  });

  it('ignores another seller’s code', () => {
    expect(stripSellerPrefix('MSt', 'QTT John Doe')).toBe('QTT John Doe');
  });

  it('is a no-op for a seller with no code', () => {
    expect(stripSellerPrefix(null, 'MSt John Doe')).toBe('MSt John Doe');
    expect(stripSellerPrefix('', 'MSt John Doe')).toBe('MSt John Doe');
  });

  it('strips only once', () => {
    expect(stripSellerPrefix('MSt', 'MSt MSt Roy')).toBe('MSt Roy');
  });
});

describe('prefixHint', () => {
  it('names the code so the prefix is explained, not just present', () => {
    expect(prefixHint('MSt')).toContain('MSt');
  });

  it('says nothing when there is no code to explain', () => {
    expect(prefixHint(null)).toBe('');
    expect(prefixHint('  ')).toBe('');
  });
});

describe('it agrees with the server implementation', () => {
  /**
   * Two copies of this rule exist. The duplication is deliberate (the
   * client cannot import from apps/api) and SAFE, because the server's
   * compose is idempotent — a disagreement shows a stale prefix in an
   * input, it cannot write "MSt MSt John Doe". But "safe" is not
   * "fine", so pin that they behave the same on the cases that matter,
   * in the same idiom as the wallet CREDIT_DIRECTIONS cross-check.
   */
  it('produces the same answer as apps/api on every shared case', async () => {
    // Imported, not re-implemented or regex-detyped: vitest transforms
    // the TS, so this compares the REAL function rather than a copy of
    // it that could drift on its own.
    const api = (await import('../../../api/src/common/text/recipient-name')) as {
      stripSellerPrefix: (i: string | null, n: string) => string;
    };
    const apiStrip = api.stripSellerPrefix;

    const cases: ReadonlyArray<readonly [string | null, string]> = [
      ['MSt', 'MSt John Doe'],
      ['MSt', 'John Doe'],
      ['MSt', 'MStanley Roy'],
      ['MSt', 'QTT John Doe'],
      ['MSt', 'MSt MSt Roy'],
      ['MSt', 'mst john doe'],
      [null, 'MSt John Doe'],
      ['QTT', '  QTT  Spaced  '],
    ];
    for (const [initials, name] of cases) {
      expect({ initials, name, out: stripSellerPrefix(initials, name) }).toEqual({
        initials,
        name,
        out: apiStrip(initials, name),
      });
    }
  });
});
