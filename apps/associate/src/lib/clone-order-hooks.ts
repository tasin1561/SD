'use client';

import { useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { ApiError } from '@skydrop/api-client';
import { looksLikeOrderId } from '@/lib/order-id';
import { useMyOrder } from '@/lib/order-hooks';
import type { SellCatalogueItem } from '@/lib/catalogue-hooks';
import { buildStoreClone, CLONE_PARAM, type CloneSeed } from '@/lib/clone-order';

export interface CloneState {
  readonly active: boolean;
  readonly notFound: boolean;
  readonly failed: boolean;
  readonly seed: CloneSeed | null;
}

const IDLE: CloneState = { active: false, notFound: false, failed: false, seed: null };

/**
 * Reads the source through the caller's own scoped order read
 * (`GET /store/orders/:id`, so a foreign id is a plain 404) and checks each
 * line against the catalogue as it is now. `items` is `undefined` until
 * the catalogue has loaded.
 */
export function useCloneSeed(items: ReadonlyArray<SellCatalogueItem> | undefined): CloneState {
  const raw = useSearchParams().get(CLONE_PARAM) ?? '';
  const id = looksLikeOrderId(raw) ? raw.trim() : '';
  const source = useMyOrder(id);
  const seed = useMemo(
    () =>
      source.data === undefined || items === undefined ? null : buildStoreClone(source.data, items),
    [source.data, items],
  );
  if (raw === '') return IDLE;
  if (id === '') return { ...IDLE, active: true, notFound: true };
  if (source.isError) {
    const nf = source.error instanceof ApiError && source.error.status === 404;
    return { ...IDLE, active: true, notFound: nf, failed: !nf };
  }
  return { ...IDLE, active: true, seed };
}
