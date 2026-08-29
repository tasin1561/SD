import { describe, expect, it } from 'vitest';
import { absAmount, isZeroAmount } from '../app/(authed)/treasury/_components/treasury-index';

/**
 * Money is carried as a decimal STRING everywhere in this codebase so
 * it never touches a binary float. These two helpers exist so the
 * treasury page can take a magnitude and test for zero without
 * reaching for `Number()` on the figure that says whether the money we
 * hold for sellers covers what we owe them.
 */
describe('treasury money helpers', () => {
  it('takes a magnitude without parsing to a float', () => {
    expect(absAmount('-5000.00')).toBe('5000.00');
    expect(absAmount('5000.00')).toBe('5000.00');
    // The precision that a float round-trip would quietly destroy.
    expect(absAmount('-12345678901234.56')).toBe('12345678901234.56');
  });

  it('recognises zero however it is written', () => {
    for (const z of ['0', '0.00', '-0.00', '0.0000', ' 0.00 ']) {
      expect(isZeroAmount(z)).toBe(true);
    }
  });

  it('does not mistake a real amount for zero', () => {
    // `0.01` starting with a zero is the trap a loose prefix check falls
    // into, and it would report a shortfall as "exactly covered".
    for (const n of ['0.01', '-0.01', '100000.00', '0.001']) {
      expect(isZeroAmount(n)).toBe(false);
    }
  });
});
