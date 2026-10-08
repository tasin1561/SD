import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import { vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import type { StoreMe } from '@skydrop/api-client';
import { AuthProvider } from '@skydrop/auth/client';
import { ToastProvider } from '@skydrop/ui/app/toast';
import { Toaster } from '@skydrop/ui/components';

/**
 * The providers a screen here renders under: the query client, the store
 * identity (the third `IdentityKind`) and BOTH toasters the shell mounts
 * — the legacy `Toaster` and the brand `ToastProvider`, which have
 * separate contexts while the restyle is half done. A component calling
 * either `useToast` throws inside render without its own provider, with
 * a message that blames the layout.
 */

/** An associate: the nine permissions the `associate` role holds. */
export const ASSOCIATE_PERMISSIONS = [
  'store.profile.view',
  'catalogue.sell',
  'orders.view',
  'orders.create',
  'orders.cancel',
  'orders.actions',
  'customers.view',
  'tickets.view',
  'tickets.manage',
] as const;

export function makeAssociate(over: Partial<StoreMe> = {}): StoreMe {
  return {
    id: '019fad84-0000-7000-8000-000000000001',
    email: 'sells@kurtacorner.example',
    emailDisplay: 'sells@kurtacorner.example',
    fullName: 'Asha Sells',
    emailVerifiedAt: '2026-10-01T00:00:00.000Z',
    roleKey: 'associate',
    roleName: 'Associate',
    roleKeys: ['associate'],
    roleNames: ['Associate'],
    permissions: [...ASSOCIATE_PERMISSIONS],
    orderScope: 'OWN',
    ordersPausedAt: null,
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

export interface AssociateRenderResult extends RenderResult {
  readonly fetchImpl: ReturnType<typeof vi.fn>;
}

/** Renders `ui` with a stubbed `fetch`; the calls it made are returned. */
export function renderAssociateScreen(
  ui: ReactElement,
  opts: { readonly identity?: StoreMe; readonly fetchImpl?: ReturnType<typeof vi.fn> } = {},
): AssociateRenderResult {
  const identity = opts.identity ?? makeAssociate();
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
          <Toaster>
            <ToastProvider>{children}</ToastProvider>
          </Toaster>
        </AuthProvider>
      </QueryClientProvider>
    );
  }

  return Object.assign(render(ui, { wrapper: Wrapper }), { fetchImpl });
}

/** A `fetch` stub that answers each path from a map; anything else 404s. */
export function fetchFrom(routes: Record<string, unknown>): ReturnType<typeof vi.fn> {
  return vi.fn(async (input: unknown) => {
    const url = String(input);
    for (const [path, body] of Object.entries(routes)) {
      if (url.includes(path)) {
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
    }
    return new Response(JSON.stringify({ code: 'NOT_STUBBED', message: url }), { status: 404 });
  });
}
