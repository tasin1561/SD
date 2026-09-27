import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccessTokenStore } from '../auth/token-store';
import { ApiClient } from '../client';

/**
 * Cross-tab refresh serialisation.
 *
 * `SingleFlightRefresh` coalesces per `ApiClient` instance — one
 * document and nothing more. Two tabs both boot with an EMPTY token
 * store (FE-1: the access token is memory-only), both 401 on their
 * first call, and both present the SAME refresh cookie. Whichever loses
 * takes the whole family down with it through reuse detection: a HIGH
 * `security.refresh_replay_detected` and a legitimate user signed out
 * everywhere.
 *
 * Web Locks are per-origin and cross-tab and store nothing, so FE-1
 * holds. The loser waits; by the time it runs, the cookie jar carries
 * what the winner minted, so its own rotation presents a live token.
 *
 * Pinned here:
 *   - a second client WAITS while the first rotates (it has not called
 *     /refresh at all while the lock is held);
 *   - a client sharing the winner's store adopts its token rather than
 *     spending a cookie that has already moved on;
 *   - with no `navigator.locks` the refresh still happens — the
 *     documented fallback, and the behaviour before this existed.
 */

const FUTURE = '2099-01-01T00:00:00.000Z';

/**
 * A minimal Web Locks stand-in: exclusive, FIFO, per name. Node has no
 * `navigator.locks`, so without this the production code takes its
 * fallback and the serialisation cannot be observed at all.
 *
 * `heldNames` is appended when a lock is REQUESTED (before waiting), so
 * "queued but not yet running" is observable.
 */
function installFakeLocks(): { uninstall: () => void; requested: string[] } {
  const chains = new Map<string, Promise<unknown>>();
  const requested: string[] = [];
  const locks = {
    request<T>(name: string, callback: () => Promise<T>): Promise<T> {
      requested.push(name);
      const previous = chains.get(name) ?? Promise.resolve();
      const mine = previous.then(callback, callback);
      // The real lock releases on a rejected callback too, so the chain
      // must survive one.
      chains.set(
        name,
        mine.catch(() => undefined),
      );
      return mine;
    },
  };
  const uninstall = swapNavigator({ locks });
  return { requested, uninstall };
}

function swapNavigator(value: unknown): () => void {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true });
  return () => {
    if (original) Object.defineProperty(globalThis, 'navigator', original);
    else Reflect.deleteProperty(globalThis, 'navigator');
  };
}

/**
 * `/api/probe` 401s without a Bearer and 200s with one — so a request
 * drives exactly the real sequence: 401 → refresh → retry → 200.
 *
 * `/refresh` BLOCKS until released, which is what makes overlap
 * observable: `peak` rises above 1 only if two rotations ran at once.
 */
function gatedFetch(): {
  fetchImpl: typeof fetch;
  refreshCalls: () => number;
  peakConcurrentRefreshes: () => number;
  release: () => void;
} {
  let concurrent = 0;
  let peak = 0;
  let calls = 0;
  let minted = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });

  const json = (body: unknown, status: number): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });

  const fetchImpl = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (/\/api\/auth\/staff\/refresh$/.test(url)) {
        calls += 1;
        concurrent += 1;
        peak = Math.max(peak, concurrent);
        await gate;
        concurrent -= 1;
        minted += 1;
        return json({ accessToken: `AT${minted}`, expiresIn: 300, expiresAt: FUTURE }, 200);
      }
      const authorized = new Headers(init?.headers).has('authorization');
      return authorized ? json({ ok: true }, 200) : json({ code: 'UNAUTHORIZED' }, 401);
    },
  );

  return {
    fetchImpl: fetchImpl as unknown as typeof fetch,
    refreshCalls: () => calls,
    peakConcurrentRefreshes: () => peak,
    release,
  };
}

function clientWith(store: AccessTokenStore, fetchImpl: typeof fetch): ApiClient {
  return new ApiClient({ identityKind: 'staff', tokenStore: store, fetchImpl });
}

async function until(cond: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 500; i++) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 1));
  }
  throw new Error(`timed out waiting for ${what}`);
}

describe('refresh is serialised across tabs (Web Locks)', () => {
  let uninstall: (() => void) | null = null;
  afterEach(() => {
    uninstall?.();
    uninstall = null;
  });

  it('a second client WAITS while the first rotates — never two at once', async () => {
    const locks = installFakeLocks();
    uninstall = locks.uninstall;
    const g = gatedFetch();

    // Two tabs: separate stores, separate clients, ONE origin.
    const a = clientWith(new AccessTokenStore(), g.fetchImpl);
    const b = clientWith(new AccessTokenStore(), g.fetchImpl);

    const inFlight = Promise.all([
      a.request<{ ok: boolean }>('/api/probe'),
      b.request<{ ok: boolean }>('/api/probe'),
    ]);

    await until(() => locks.requested.length === 2, 'both clients to queue on the lock');
    // The load-bearing assertion: the second is QUEUED and has not
    // presented the cookie. Without the lock both would be mid-/refresh
    // with the same cookie, and one of them would burn the family.
    expect(g.refreshCalls()).toBe(1);

    g.release();
    expect(await inFlight).toEqual([{ ok: true }, { ok: true }]);

    // BOTH rotate in the end, which is correct: the second one's cookie
    // is the first one's output. Never at the same time.
    expect(g.refreshCalls()).toBe(2);
    expect(g.peakConcurrentRefreshes()).toBe(1);
    expect(locks.requested).toEqual(['skydrop-refresh-staff', 'skydrop-refresh-staff']);
  });

  it('a client sharing the winner’s store adopts its token instead of rotating again', async () => {
    const locks = installFakeLocks();
    uninstall = locks.uninstall;
    const g = gatedFetch();

    const store = new AccessTokenStore();
    const a = clientWith(store, g.fetchImpl);
    const b = clientWith(store, g.fetchImpl);

    const inFlight = Promise.all([
      a.request<{ ok: boolean }>('/api/probe'),
      b.request<{ ok: boolean }>('/api/probe'),
    ]);
    await until(() => locks.requested.length === 2, 'both clients to queue on the lock');
    g.release();
    expect(await inFlight).toEqual([{ ok: true }, { ok: true }]);

    // The loser re-read the store INSIDE the lock, found a fresh token it
    // had not seen on the way in, and took it.
    expect(g.refreshCalls()).toBe(1);
    expect(store.get().token).toBe('AT1');
  });

  it('no navigator.locks — still refreshes (the documented fallback)', async () => {
    uninstall = swapNavigator({ userAgent: 'node' });
    const g = gatedFetch();
    const store = new AccessTokenStore();
    const client = clientWith(store, g.fetchImpl);

    const inFlight = client.request<{ ok: boolean }>('/api/probe');
    await until(() => g.refreshCalls() === 1, 'the unserialised refresh to fire');
    g.release();
    expect(await inFlight).toEqual({ ok: true });
    expect(store.get().token).toBe('AT1');
  });
});
