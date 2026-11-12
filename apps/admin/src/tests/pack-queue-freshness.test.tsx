import { describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { AuthProvider } from '@skydrop/auth/client';
import type { StaffMe } from '@skydrop/api-client';
import { useCompletePack, useOpenPackBox, usePackQueue } from '@/lib/api-hooks';

/**
 * The pack queue must be re-read after a write that changes it.
 *
 * ── WHY THIS FILE EXISTS SEPARATELY FROM THE BENCH TESTS ─────────────
 * A packer packed a parcel and it stayed under "waiting to be packed"
 * (owner, 2026-11-12). The cause is `staleTime: 30_000` in the app's
 * QueryProvider: the list unmounts while a box is open and remounts
 * when it closes, and on that remount the cached list is under 30s old,
 * so React Query calls it FRESH and serves it without asking.
 *
 * The bench suite CANNOT catch this. `renderWithProviders` builds its
 * QueryClient with `gcTime: 0`, so the query is collected the moment
 * the list unmounts and any remount refetches — a test written there
 * passes whether the fix is present or not. It was, and it did; this
 * file replaced it.
 *
 * So the client here is deliberately built like PRODUCTION's, and the
 * assertion is on the thing that actually breaks: whether the cached
 * queue is still considered fresh after a write.
 */

const IDENTITY = {
  id: 'staff-1',
  email: 'packer@skydrop.global',
  emailDisplay: 'packer@skydrop.global',
  permissions: ['warehouse.pack'],
} as unknown as StaffMe;

/** The app's real defaults — see `components/query-provider.tsx`. */
function productionLikeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, retry: false },
      mutations: { retry: false },
    },
  });
}

function harness(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }): ReactElement {
    return (
      <QueryClientProvider client={qc}>
        <AuthProvider<StaffMe> identityKind="staff" initialIdentity={IDENTITY}>
          {children}
        </AuthProvider>
      </QueryClientProvider>
    );
  };
}

function stubFetch(): ReturnType<typeof vi.fn> {
  return vi.fn(async (input: unknown) => {
    const url = String(input);
    const body = url.includes('/packs/queue')
      ? { waiting: [], inProgress: [] }
      : { packBoxId: 'pb-1', shipmentId: 's-1', manifestNumber: 'MF-1' };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
}

/** How many times the queue endpoint has actually been asked. */
function queueCalls(fetchImpl: ReturnType<typeof vi.fn>): number {
  return fetchImpl.mock.calls.filter((c) => String(c[0]).includes('/packs/queue')).length;
}

describe('the pack queue is re-read after a write that changes it', () => {
  it('completing a pack makes the cached queue stale', async () => {
    const fetchImpl = stubFetch();
    vi.stubGlobal('fetch', fetchImpl);
    const qc = productionLikeClient();
    const wrapper = harness(qc);

    const queue = renderHook(() => usePackQueue(), { wrapper });
    await waitFor(() => expect(queue.result.current.isSuccess).toBe(true));

    const before = queueCalls(fetchImpl);

    const complete = renderHook(() => useCompletePack(), { wrapper });
    complete.result.current.mutate({ shipmentId: 's-1' });
    await waitFor(() => expect(complete.result.current.isSuccess).toBe(true));

    // The queue is asked again. WITHOUT the invalidation this count does
    // not move: staleTime is 30s, the cache is seconds old, and React
    // Query answers from it — which is exactly how a packed parcel kept
    // its place in the waiting list.
    await waitFor(() => expect(queueCalls(fetchImpl)).toBeGreaterThan(before));
  });

  it('opening a box makes it stale too — the parcel moves to another bench', async () => {
    const fetchImpl = stubFetch();
    vi.stubGlobal('fetch', fetchImpl);
    const qc = productionLikeClient();
    const wrapper = harness(qc);

    const queue = renderHook(() => usePackQueue(), { wrapper });
    await waitFor(() => expect(queue.result.current.isSuccess).toBe(true));

    const before = queueCalls(fetchImpl);

    const open = renderHook(() => useOpenPackBox(), { wrapper });
    open.result.current.mutate({ awbNumber: 'AWB100' });
    await waitFor(() => expect(open.result.current.isSuccess).toBe(true));

    await waitFor(() => expect(queueCalls(fetchImpl)).toBeGreaterThan(before));
  });
});
