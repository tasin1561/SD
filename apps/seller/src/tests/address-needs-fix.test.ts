/**
 * Owner, 2026-11-13: "in our whole system if the address validation score
 * is less than 60 only then highlight the address is need fix". One shared
 * rule; issues on a good score are listed, never highlighted.
 */
import { describe, expect, it } from 'vitest';
import { ADDRESS_FIX_BELOW_SCORE, addressNeedsFix } from '@skydrop/ui/app/address-check';

describe('addressNeedsFix — the one threshold every console uses', () => {
  it('the threshold is 60', () => {
    expect(ADDRESS_FIX_BELOW_SCORE).toBe(60);
  });
  it.each([
    [93, false],
    [60, false],
    [59, true],
    [0, true],
  ])('score %i → %s', (score, expected) => {
    expect(addressNeedsFix({ available: true, score })).toBe(expected);
  });
  it('no score, no check, or a check that could not run: never highlighted', () => {
    expect(addressNeedsFix({ available: true, score: null })).toBe(false);
    expect(addressNeedsFix({ available: false, score: 10 })).toBe(false);
    expect(addressNeedsFix(null)).toBe(false);
    expect(addressNeedsFix(undefined)).toBe(false);
  });
});
