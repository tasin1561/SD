import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { AuthProvider } from '@skydrop/auth/client';
import { Toaster } from '@skydrop/ui/components';
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

/**
 * Every permission, as the fixture's default. The real catalogue lives
 * in the API and is served at runtime; duplicating all 68 keys here
 * would be a second list to keep in step for no benefit, since these
 * tests are about components rather than about which keys exist.
 */
const ALL_TEST_PERMISSIONS: readonly string[] = [
  'orders.view',
  'orders.cancel',
  'orders.override',
  'orders.charges.view',
  'orders.charges.compute',
  'sellers.view',
  'sellers.approve',
  'sellers.suspend',
  'staff.view',
  'staff.manage',
  'rbac.manage',
];

export function makeStaff(
  role: StaffRole = 'SUPER_ADMIN' as StaffRole,
  permissions?: readonly string[],
): StaffMe {
  return {
    id: 'staff-1',
    email: 't@example.com',
    emailDisplay: 't@example.com',
    role,
    roleKey: role.toLowerCase(),
    roleName: role,
    // Defaults to a super admin's whole catalogue, so a test about
    // something else is not silently gated by a permission it never
    // meant to exercise. Pass a list to test the gating itself.
    permissions: permissions ?? ALL_TEST_PERMISSIONS,
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
          {/* The real AuthedShell mounts this around everything, so a
              component that reports an outcome with useToast renders here
              exactly as it does in the app. Without it the harness threw
              on any such component and the failure looked like a broken
              test rather than a missing provider. */}
          <Toaster>{children}</Toaster>
        </AuthProvider>
      </QueryClientProvider>
    );
  }

  const result = render(ui, { wrapper: Wrapper, ...(opts.renderOptions ?? {}) });
  return Object.assign(result, { fetchImpl });
}
