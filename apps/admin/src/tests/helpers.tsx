import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { AuthProvider } from '@skydrop/auth/client';
import type { StaffMe } from '@skydrop/api-client';
import type { StaffRole } from '@skydrop/db';
import { vi } from 'vitest';

/**
 * Render the component under test inside a fresh QueryClient + a real
 * AuthProvider with the given identity. The AuthProvider's internal
 * ApiClient uses `globalThis.fetch` by default (no override path
 * exposed); we stub the global so the test controls every network
 * round-trip.
 *
 * This matters for the FE-2 boundary tests: the test simulates the
 * SERVER returning a guardrail rejection by returning an HTTP 400/
 * 403/etc. with the `{code, message}` body the API actually returns.
 * The SUT (under test) goes through the real ApiClient → real
 * ApiError-throwing path → component catches → component displays.
 * No mocked hooks, no faked errors.
 */

export function makeStaff(role: StaffRole = 'SUPER_ADMIN' as StaffRole): StaffMe {
  return {
    id: 'staff-1',
    email: 't@example.com',
    emailDisplay: 't@example.com',
    role,
    emailVerifiedAt: '2026-01-01T00:00:00.000Z',
    lastLoginAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

export interface MockResponseBody {
  readonly status: number;
  readonly body?: unknown;
}

/**
 * Builds a fetch mock that returns sequential responses per regex
 * URL match. Each pattern can have multiple queued responses
 * (consumed in order); the mock exposes `calls` so tests can assert
 * what was actually requested.
 */
export function buildFetchMock(
  routes: ReadonlyArray<{
    readonly match: RegExp;
    readonly responses: ReadonlyArray<MockResponseBody>;
  }>,
): ReturnType<typeof vi.fn> {
  const queues = new Map<RegExp, MockResponseBody[]>();
  for (const r of routes) queues.set(r.match, [...r.responses]);
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    for (const [pattern, queue] of queues) {
      if (pattern.test(url) && queue.length > 0) {
        const r = queue.shift()!;
        return new Response(r.body === undefined ? '' : JSON.stringify(r.body), {
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

export interface TestRenderResult extends RenderResult {
  readonly fetchImpl: ReturnType<typeof vi.fn>;
}

export function renderWithProviders(
  ui: ReactElement,
  opts: {
    readonly identity?: StaffMe | null;
    readonly fetchImpl?: ReturnType<typeof vi.fn>;
    readonly renderOptions?: Omit<RenderOptions, 'wrapper'>;
  } = {},
): TestRenderResult {
  const identity = opts.identity === undefined ? makeStaff() : opts.identity;
  const fetchImpl = opts.fetchImpl ?? buildFetchMock([]);

  // The AuthProvider's internal ApiClient uses globalThis.fetch by
  // default. Stub it so the SUT's real `useApiClient()` ends up
  // talking to our mock.
  vi.stubGlobal('fetch', fetchImpl);

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });

  function Wrapper({ children }: { children: ReactNode }): ReactElement {
    return (
      <QueryClientProvider client={queryClient}>
        <AuthProvider<StaffMe> identityKind="staff" initialIdentity={identity}>
          {children}
        </AuthProvider>
      </QueryClientProvider>
    );
  }

  const result = render(ui, { wrapper: Wrapper, ...(opts.renderOptions ?? {}) });
  return Object.assign(result, { fetchImpl });
}
