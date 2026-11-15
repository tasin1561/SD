'use client';

import { useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQueries } from '@tanstack/react-query';
import { ApiError, type SellerVariantSearchHit } from '@skydrop/api-client';
import { useApiClient, useSellerIdentity } from '@skydrop/auth/client';
import { useOrderDetail } from '@/lib/api-hooks';
import { looksLikeOrderId } from '@/lib/order-id';
import { buildSellerClone, CLONE_PARAM, type CloneSeed } from '@/lib/clone-order';

export interface CloneState {
  /** `?cloneFrom=` was given at all. */
  readonly active: boolean;
  /** The order or its products are still loading. */
  readonly pending: boolean;
  /** The order is not readable by this caller — a foreign id is a plain 404. */
  readonly notFound: boolean;
  readonly failed: boolean;
  readonly seed: CloneSeed | null;
}

const IDLE: CloneState = {
  active: false,
  pending: false,
  notFound: false,
  failed: false,
  seed: null,
};

/**
 * Reads the source order through the caller's own scoped order read
 * (`GET /seller/orders/:id`) and re-reads each product from the catalogue,
 * so a price is never copied from the old order.
 */
export function useCloneSeed(): CloneState {
  const raw = useSearchParams().get(CLONE_PARAM) ?? '';
  const id = looksLikeOrderId(raw) ? raw.trim() : '';
  const source = useOrderDetail(id);
  const client = useApiClient();
  const initials = useSellerIdentity()?.initials ?? null;
  const skus = useMemo(
    () => [...new Set((source.data?.items ?? []).map((i) => i.skuCode))],
    [source.data],
  );
  const lookups = useQueries({
    queries: skus.map((sku) => ({
      // Same key as `useVariantSearch`, so the cache is shared.
      queryKey: ['seller-catalog', 'variant-search', sku],
      queryFn: () =>
        client.request<SellerVariantSearchHit[]>(
          `/api/seller/variants?search=${encodeURIComponent(sku)}&limit=20`,
        ),
    })),
  });
  const lookupsDone = lookups.every((q) => !q.isPending);
  const seed = useMemo(() => {
    if (source.data === undefined || !lookupsDone) return null;
    const hits = new Map<string, SellerVariantSearchHit>();
    for (const q of lookups) for (const h of q.data ?? []) hits.set(h.id, h);
    return buildSellerClone(source.data, hits, initials);
    // `lookups` is a fresh array each render; its settled state is `lookupsDone`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source.data, lookupsDone, initials]);

  if (raw === '') return IDLE;
  if (id === '') return { ...IDLE, active: true, notFound: true };
  if (source.isError) {
    const nf = source.error instanceof ApiError && source.error.status === 404;
    return { ...IDLE, active: true, notFound: nf, failed: !nf };
  }
  return { ...IDLE, active: true, pending: seed === null, seed };
}
