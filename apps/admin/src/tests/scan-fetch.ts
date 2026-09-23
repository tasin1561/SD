import { vi } from 'vitest';

/**
 * Support for the `scan-*.test.tsx` behaviour pins (apps restyle, Phase 0).
 *
 * `buildFetchMock` hands out a fixed queue per URL and cannot tell a GET
 * from a POST on the same path, nor hold a request open. The scan benches
 * need both: "the field is disabled while the request is in flight" can
 * only be observed while a request IS in flight. So this mock answers
 * every matching request (no queue to run dry on a refetch), may answer
 * by method, and a reply may be a promise the test resolves itself.
 *
 * Not a test file — vitest only collects `*.test.{ts,tsx}`.
 */

export interface SeenRequest {
  readonly url: string;
  readonly method: string;
  readonly body: unknown;
}

export interface Reply {
  readonly status: number;
  /** Omitted ⇒ an empty body, which the ApiClient reads as `null`. */
  readonly body?: unknown;
}

export interface ScanRoute {
  readonly match: RegExp;
  /** Omitted ⇒ any method. */
  readonly method?: string;
  readonly reply: Reply | ((req: SeenRequest, n: number) => Reply | Promise<Reply>);
}

function toResponse(r: Reply): Response {
  return new Response(r.body === undefined ? '' : JSON.stringify(r.body), {
    status: r.status,
    headers: { 'content-type': 'application/json' },
  });
}

function seen(input: RequestInfo | URL, init: RequestInit | undefined): SeenRequest {
  const raw = init?.body;
  let body: unknown = undefined;
  if (typeof raw === 'string' && raw.length > 0) body = JSON.parse(raw) as unknown;
  return { url: String(input), method: (init?.method ?? 'GET').toUpperCase(), body };
}

/** A fetch mock that answers by URL (and optionally method). First match wins. */
export function scanFetch(routes: readonly ScanRoute[]): ReturnType<typeof vi.fn> {
  const counts = new Map<ScanRoute, number>();
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = seen(input, init);
    for (const route of routes) {
      if (route.method !== undefined && route.method.toUpperCase() !== req.method) continue;
      if (!route.match.test(req.url)) continue;
      const n = counts.get(route) ?? 0;
      counts.set(route, n + 1);
      const reply = typeof route.reply === 'function' ? await route.reply(req, n) : route.reply;
      return toResponse(reply);
    }
    return toResponse({ status: 599, body: { code: 'NOT_MOCKED', url: req.url } });
  });
}

/** Every request the mock saw, optionally narrowed by URL and method. */
export function requestsTo(
  fetchImpl: ReturnType<typeof vi.fn>,
  match?: RegExp,
  method?: string,
): SeenRequest[] {
  return fetchImpl.mock.calls
    .map((c) => seen(c[0] as RequestInfo | URL, c[1] as RequestInit | undefined))
    .filter((r) => (match === undefined ? true : match.test(r.url)))
    .filter((r) => (method === undefined ? true : r.method === method.toUpperCase()));
}

/** Every request that was not a GET — i.e. everything that could change something. */
export function writesSeen(fetchImpl: ReturnType<typeof vi.fn>): SeenRequest[] {
  return requestsTo(fetchImpl).filter((r) => r.method !== 'GET');
}

export interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

export function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
