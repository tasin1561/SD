import { describe, expect, it } from 'vitest';
import { looksLikeOrderId } from '@/lib/order-id';

/**
 * `/orders/[id]` matches ANY segment. `/orders/v2` — a guessed URL —
 * reached the API as an order id and the seller was shown
 * "Validation failed (uuid v 7 is expected)", which is a sentence
 * written for whoever called the endpoint, not for a person who
 * mistyped a URL.
 *
 * Shape only, deliberately. Whether the order EXISTS and whether it is
 * yours stay the server's answer (FE-2).
 */
describe('looksLikeOrderId', () => {
  it('accepts a real v7 id', () => {
    expect(looksLikeOrderId('019fd096-eb5a-70ed-8eca-705d263bb6a6')).toBe(true);
  });

  it('rejects the URL that caused this', () => {
    expect(looksLikeOrderId('v2')).toBe(false);
  });

  it('rejects a well-formed uuid of the WRONG version', () => {
    // Every id in this system is minted v7; a v4 here means somebody
    // pasted an id from another system.
    expect(looksLikeOrderId('019fd096-eb5a-40ed-8eca-705d263bb6a6')).toBe(false);
  });

  it('rejects near-misses rather than letting them reach the API', () => {
    expect(looksLikeOrderId('')).toBe(false);
    expect(looksLikeOrderId('new-v2')).toBe(false);
    expect(looksLikeOrderId('019fd096eb5a70ed8eca705d263bb6a6')).toBe(false);
    expect(looksLikeOrderId('019fd096-eb5a-70ed-8eca-705d263bb6a')).toBe(false);
  });

  it('tolerates surrounding whitespace and either case', () => {
    expect(looksLikeOrderId(' 019FD096-EB5A-70ED-8ECA-705D263BB6A6 ')).toBe(true);
  });
});
