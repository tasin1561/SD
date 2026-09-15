import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import { vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import type { StoreMe } from '@skydrop/api-client';
import { AuthProvider } from '@skydrop/auth/client';
import { Toaster } from '@skydrop/ui/components';

/**
 * The providers a store screen renders under: the query client, the store
 * identity (RS-2's third `IdentityKind`) and the toaster the app layout
 * mounts. A component that toasts throws without the last one, so it
 * belongs here rather than in each test.
 */

export function makeStoreUser(over: Partial<StoreMe> = {}): StoreMe {
  return {
    id: '019fad84-0000-7000-8000-000000000001',
    email: 'owner@kurtacorner.example',
    emailDisplay: 'owner@kurtacorner.example',
    fullName: 'Store Owner',
    emailVerifiedAt: '2026-09-01T00:00:00.000Z',
    roleKey: 'owner',
    roleName: 'Owner',
    permissions: ['wallet.view', 'wallet.withdrawals.manage', 'wallet.topups.manage'],
    store: {
      id: '019fad84-0000-7000-8000-000000000002',
      name: 'Kurta Corner',
      displayName: null,
      status: 'ACTIVE',
      walletManagedBy: 'SKYDROP',
      logoUrl: null,
      contactEmail: null,
      contactPhone: null,
    },
    seller: { id: '019fad84-0000-7000-8000-000000000003', companyName: 'Menev Store' },
    ...over,
  } as StoreMe;
}

export interface StoreRenderResult extends RenderResult {
  readonly fetchImpl: ReturnType<typeof vi.fn>;
}

/** Renders `ui` with a stubbed `fetch`; the calls it made are returned. */
export function renderStoreScreen(
  ui: ReactElement,
  opts: { readonly identity?: StoreMe; readonly fetchImpl?: ReturnType<typeof vi.fn> } = {},
): StoreRenderResult {
  const identity = opts.identity ?? makeStoreUser();
  const fetchImpl =
    opts.fetchImpl ?? vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }));
  vi.stubGlobal('fetch', fetchImpl);

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });

  function Wrapper({ children }: { readonly children: ReactNode }): ReactElement {
    return (
      <QueryClientProvider client={queryClient}>
        <AuthProvider<StoreMe> identityKind="store" initialIdentity={identity}>
          <Toaster>{children}</Toaster>
        </AuthProvider>
      </QueryClientProvider>
    );
  }

  return Object.assign(render(ui, { wrapper: Wrapper }), { fetchImpl });
}
