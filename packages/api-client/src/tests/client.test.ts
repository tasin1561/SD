import { describe, expect, it, vi } from 'vitest';
import { AccessTokenStore } from '../auth/token-store';
import { ApiClient, ApiError } from '../client';

interface FakeResponse {
  status: number;
  body?: unknown;
}

/** Helper: builds a mock fetch that returns one of a sequence of responses
 *  keyed by URL path. Multiple entries for the same path return them in order. */
function mockFetch(
  responses: Array<{ urlMatch: RegExp; res: FakeResponse }>,
): ReturnType<typeof vi.fn> {
  const queues = new Map<RegExp, FakeResponse[]>();
  for (const entry of responses) {
    const arr = queues.get(entry.urlMatch) ?? [];
    arr.push(entry.res);
    queues.set(entry.urlMatch, arr);
  }
  return vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    for (const [pattern, queue] of queues) {
      if (pattern.test(url) && queue.length > 0) {
        const r = queue.shift()!;
        const body = r.body === undefined ? '' : JSON.stringify(r.body);
        return new Response(body, {
          status: r.status,
          headers: { 'content-type': 'application/json' },
        });
      }
    }
    return new Response(JSON.stringify({ code: 'NOT_MOCKED', url }), {
      status: 599,
      headers: { 'content-type': 'application/json' },
    });
  });
}

function makeClient(fetchImpl: typeof fetch) {
  const store = new AccessTokenStore();
  const client = new ApiClient({ identityKind: 'staff', tokenStore: store, fetchImpl });
  return { client, store };
}

describe('ApiClient', () => {
  it('login() stores the access token + expiresAt in epoch ms', async () => {
    const future = '2099-01-01T00:00:00.000Z';
    const fetchImpl = mockFetch([
      {
        urlMatch: /\/api\/auth\/staff\/login$/,
        res: { status: 200, body: { accessToken: 'AT', expiresIn: 300, expiresAt: future } },
      },
    ]);
    const { client, store } = makeClient(fetchImpl as unknown as typeof fetch);

    await client.login({ email: 'a@b', password: 'p' });

    const snap = store.get();
    expect(snap.token).toBe('AT');
    expect(snap.expiresAt).toBe(Date.parse(future));
    expect(store.isFresh()).toBe(true);
  });

  it('request() attaches Bearer when the store has a token; omits when empty', async () => {
    const fetchImpl = mockFetch([
      { urlMatch: /\/api\/probe$/, res: { status: 200, body: { ok: true } } },
      { urlMatch: /\/api\/probe$/, res: { status: 200, body: { ok: true } } },
    ]);
    const { client, store } = makeClient(fetchImpl as unknown as typeof fetch);

    // Without a token, no Authorization header.
    await client.request('/api/probe');
    expect(fetchImpl.mock.calls[0]![1].headers.get('Authorization')).toBeNull();

    // After setting one, Authorization is attached.
    store.set('TOKEN-A', Date.now() + 60_000);
    await client.request('/api/probe');
    expect(fetchImpl.mock.calls[1]![1].headers.get('Authorization')).toBe('Bearer TOKEN-A');
  });

  it('401 → single-flight refresh → retry → returns success on the second attempt', async () => {
    const future = '2099-01-01T00:00:00.000Z';
    const fetchImpl = mockFetch([
      { urlMatch: /\/api\/probe$/, res: { status: 401, body: { code: 'UNAUTHORIZED' } } },
      {
        urlMatch: /\/api\/auth\/staff\/refresh$/,
        res: { status: 200, body: { accessToken: 'AT2', expiresIn: 300, expiresAt: future } },
      },
      { urlMatch: /\/api\/probe$/, res: { status: 200, body: { ok: true } } },
    ]);
    const { client, store } = makeClient(fetchImpl as unknown as typeof fetch);
    store.set('AT1', Date.now() + 60_000);

    const result = await client.request<{ ok: boolean }>('/api/probe');
    expect(result.ok).toBe(true);
    expect(store.get().token).toBe('AT2');

    // Calls: probe (401) → refresh → probe (200). Three total.
    expect(fetchImpl.mock.calls).toHaveLength(3);
    expect(String(fetchImpl.mock.calls[0]![0])).toMatch(/\/probe$/);
    expect(String(fetchImpl.mock.calls[1]![0])).toMatch(/\/refresh$/);
    expect(String(fetchImpl.mock.calls[2]![0])).toMatch(/\/probe$/);
  });

  it('CONCURRENT 401 (the load-bearing test) — 3 simultaneous failed requests → EXACTLY ONE /refresh fired', async () => {
    const future = '2099-01-01T00:00:00.000Z';
    // We need to gate the refresh so that all three 401s arrive
    // BEFORE the refresh resolves. Otherwise the first probe would
    // 401-refresh-retry to completion before the second probe even
    // fires, which doesn't exercise the concurrency.
    let releaseRefresh!: () => void;
    const refreshGate = new Promise<void>((r) => {
      releaseRefresh = r;
    });

    let refreshCalls = 0;
    let probeCalls = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      if (/\/api\/auth\/staff\/refresh$/.test(url)) {
        refreshCalls += 1;
        await refreshGate; // block until released
        return new Response(
          JSON.stringify({ accessToken: 'AT2', expiresIn: 300, expiresAt: future }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (/\/api\/probe-\w$/.test(url)) {
        probeCalls += 1;
        // First three calls 401; calls 4-6 (the retries) return 200.
        if (probeCalls <= 3) {
          return new Response(JSON.stringify({ code: 'UNAUTHORIZED' }), {
            status: 401,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ ok: true, n: probeCalls }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    const { client, store } = makeClient(fetchImpl as unknown as typeof fetch);
    store.set('AT1', Date.now() + 60_000);

    // Fire three requests CONCURRENTLY.
    const p1 = client.request<{ ok: true }>('/api/probe-a');
    const p2 = client.request<{ ok: true }>('/api/probe-b');
    const p3 = client.request<{ ok: true }>('/api/probe-c');

    // Yield so the three initial fetches dispatch + 401 + each
    // calls refresher.run() (which coalesces to one underlying
    // refresh, currently blocked on the gate).
    await new Promise((r) => setTimeout(r, 30));

    // Critical assertion: only ONE refresh in flight, not three.
    expect(refreshCalls).toBe(1);

    releaseRefresh();
    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(r3.ok).toBe(true);

    // After completion: still only ONE refresh fired. Each probe
    // ran twice (initial 401 + retried 200) = 6 probe calls.
    expect(refreshCalls).toBe(1);
    expect(probeCalls).toBe(6);
    expect(store.get().token).toBe('AT2');
  });

  it('failed refresh → original 401 surfaces, store cleared', async () => {
    const fetchImpl = mockFetch([
      { urlMatch: /\/api\/probe$/, res: { status: 401, body: { code: 'UNAUTHORIZED' } } },
      {
        urlMatch: /\/api\/auth\/staff\/refresh$/,
        res: { status: 401, body: { code: 'INVALID_REFRESH' } },
      },
    ]);
    const { client, store } = makeClient(fetchImpl as unknown as typeof fetch);
    store.set('AT1', Date.now() + 60_000);

    await expect(client.request('/api/probe')).rejects.toBeInstanceOf(ApiError);
    expect(store.get().token).toBeNull();
  });

  it('suppressRefresh=true → 401 surfaces directly (no refresh attempt)', async () => {
    const fetchImpl = mockFetch([
      { urlMatch: /\/api\/auth\/staff\/me$/, res: { status: 401, body: { code: 'UNAUTHORIZED' } } },
    ]);
    const { client } = makeClient(fetchImpl as unknown as typeof fetch);

    await expect(client.meStaff({ suppressRefresh: true })).rejects.toBeInstanceOf(ApiError);
    expect(fetchImpl.mock.calls).toHaveLength(1); // no refresh attempted
  });

  it('logout() clears the store even if the network call fails', async () => {
    const fetchImpl = mockFetch([
      { urlMatch: /\/logout$/, res: { status: 500, body: { code: 'BOOM' } } },
    ]);
    const { client, store } = makeClient(fetchImpl as unknown as typeof fetch);
    store.set('AT1', Date.now() + 60_000);

    await expect(client.logout()).rejects.toBeInstanceOf(ApiError);
    expect(store.get().token).toBeNull();
  });

  it('credentials: include is set on every request (the __Host- cookie must flow through the proxy)', async () => {
    const fetchImpl = mockFetch([
      { urlMatch: /\/api\/probe$/, res: { status: 200, body: { ok: true } } },
    ]);
    const { client } = makeClient(fetchImpl as unknown as typeof fetch);

    await client.request('/api/probe');
    expect(fetchImpl.mock.calls[0]![1].credentials).toBe('include');
  });
});
