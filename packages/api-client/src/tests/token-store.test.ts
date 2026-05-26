import { describe, expect, it, vi } from 'vitest';
import { AccessTokenStore } from '../auth/token-store';

describe('AccessTokenStore', () => {
  it('set/get round trip + subscribers fire on change', () => {
    const store = new AccessTokenStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    expect(store.get()).toEqual({ token: null, expiresAt: null });

    store.set('AT', 1000);
    expect(store.get()).toEqual({ token: 'AT', expiresAt: 1000 });
    expect(listener).toHaveBeenCalledWith({ token: 'AT', expiresAt: 1000 });

    store.clear();
    expect(store.get()).toEqual({ token: null, expiresAt: null });
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    store.set('AT2', 2000);
    expect(listener).toHaveBeenCalledTimes(2); // not called after unsubscribe
  });

  it('isFresh() respects the buffer window', () => {
    const store = new AccessTokenStore();
    expect(store.isFresh()).toBe(false); // no token

    store.set('AT', Date.now() + 60_000);
    expect(store.isFresh()).toBe(true);

    store.set('AT', Date.now() + 1_000);
    expect(store.isFresh(5_000)).toBe(false); // within buffer
    expect(store.isFresh(500)).toBe(true);
  });

  it('a listener that throws does not poison the store or other listeners', () => {
    const store = new AccessTokenStore();
    const noisy = vi.fn(() => {
      throw new Error('boom');
    });
    const quiet = vi.fn();
    store.subscribe(noisy);
    store.subscribe(quiet);
    expect(() => store.set('AT', 1)).not.toThrow();
    expect(noisy).toHaveBeenCalled();
    expect(quiet).toHaveBeenCalled();
  });
});
