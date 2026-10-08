import { describe, expect, it } from 'vitest';
import { ordersPaused, seesOwnOnly } from '@/lib/orders-paused';

/**
 * ASSOC-1 — the pause is a NOTICE, not a lock, and `orderScope` is COPY.
 * Both are read off `/auth/store/me`; the server decides both.
 */
describe('orders paused / order scope', () => {
  it('is paused only when a timestamp is actually there', () => {
    expect(ordersPaused({ ordersPausedAt: '2026-10-08T09:00:00.000Z' })).toBe(true);
    expect(ordersPaused({ ordersPausedAt: null })).toBe(false);
    expect(ordersPaused({ ordersPausedAt: '' })).toBe(false);
    // No identity yet (the provider is still hydrating) reads as NOT
    // paused: an unexplained warning on a loading page is worse than a
    // late one, and the server refuses the create either way.
    expect(ordersPaused(null)).toBe(false);
  });

  it('OWN means "only what you placed"', () => {
    expect(seesOwnOnly({ orderScope: 'OWN' })).toBe(true);
    expect(seesOwnOnly({ orderScope: 'ALL' })).toBe(false);
    expect(seesOwnOnly(null)).toBe(false);
  });
});
