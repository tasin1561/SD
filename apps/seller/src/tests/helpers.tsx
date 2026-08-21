import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { AuthProvider } from '@skydrop/auth/client';
import type { SellerMe } from '@skydrop/api-client';
import { vi } from 'vitest';

/**
 * Render the component under test inside a fresh QueryClient + a real
 * AuthProvider with the seller identity. Mirrors apps/admin/src/tests/helpers
 * with `IdentityKind = 'seller'` and SellerMe — the FE-5
 * identity-parameterization in practice at the test boundary.
 *
 * The AuthProvider's internal ApiClient uses `globalThis.fetch`; we
 * stub it so the SUT's real `useApiClient()` ends up talking to our
 * mock. The fetch mock can simulate server responses verbatim,
 * including verdict bodies (FE-2: the UI surfaces the server's
 * `{code, message}` exactly as returned).
 */

/** Enough of the catalogue for component tests; the real list is served
 *  by the API and duplicating all 30 keys here would be a second list to
 *  keep in step for no benefit. */
const ALL_TEST_SELLER_PERMISSIONS: readonly string[] = [
  'orders.view',
  'orders.create',
  'orders.cancel',
  'catalog.view',
  'catalog.manage',
  'inventory.view',
  'wallet.view',
  'charges.view',
  'team.view',
  'team.manage',
  'roles.manage',
  'profile.view',
];

export function makeSeller(overrides: Partial<SellerMe> = {}): SellerMe {
  return {
    id: 'seller-1',
    roleKey: 'owner',
    roleName: 'Owner',
    // Defaults to an owner's whole catalogue, so a test about something
    // else is not silently gated by a permission it never meant to
    // exercise. Override to test the gating itself.
    permissions: ALL_TEST_SELLER_PERMISSIONS,
    email: 's@example.com',
    emailDisplay: 's@example.com',
    companyName: 'Acme Co',
    initials: 'ACo',
    contactPersonName: 'A. Person',
    phone: '+8801234567890',
    whatsapp: null,
    status: 'APPROVED',
    countryCode: 'BD',
    displayCurrency: 'INR',
    displayFxRate: null,
    displayLanguage: 'en',
    emailVerifiedAt: '2026-01-01T00:00:00.000Z',
    approvedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    sellerUserId: 'seller-user-1',
    role: 'OWNER',
    fullName: 'A. Person',
    ...overrides,
  };
}

export interface MockResponseBody {
  readonly status: number;
  readonly body?: unknown;
}

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
    readonly identity?: SellerMe | null;
    readonly fetchImpl?: ReturnType<typeof vi.fn>;
    readonly renderOptions?: Omit<RenderOptions, 'wrapper'>;
  } = {},
): TestRenderResult {
  const identity = opts.identity === undefined ? makeSeller() : opts.identity;
  const fetchImpl = opts.fetchImpl ?? buildFetchMock([]);

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
        <AuthProvider<SellerMe> identityKind="seller" initialIdentity={identity}>
          {children}
        </AuthProvider>
      </QueryClientProvider>
    );
  }

  const result = render(ui, { wrapper: Wrapper, ...(opts.renderOptions ?? {}) });
  return Object.assign(result, { fetchImpl });
}
