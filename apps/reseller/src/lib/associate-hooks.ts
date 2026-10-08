'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useApiClient } from '@skydrop/auth/client';
import type { Window } from './report-hooks';

/**
 * ASSOC-1 — the reseller's own sales people.
 *
 * An associate is a store user holding the `associate` role: they place
 * orders, follow the ones they placed, and sell at a price THIS store
 * sets per person per product. Nothing here is about the seller's cost
 * or the store's share of Skydrop's fees — those are the two privacy
 * boundaries ASSOC-1 draws, and both are drawn server-side (the
 * associate's own catalogue is a different projection behind a different
 * permission). This file is the RESELLER's side: who the associates are,
 * what each sells at, and how each is doing.
 *
 * Every path is `/api/store/associates*` — scoped server-side by the
 * token, so no store id appears in any URL here (RS-2). The ids that DO
 * appear are store USER ids, which the server answers with a bare 404
 * when they are not a live member of the caller's own store.
 */

export interface AssociateSummary {
  readonly storeUserId: string;
  readonly fullName: string;
  readonly email: string;
  /**
   * When their order CREATION was switched off, or null while it is on.
   *
   * ASSOC-1: pausing stops NEW orders only — everything already placed
   * carries on, and they keep reading, tracking, cancelling and chasing
   * it. So this is never read as "suspended".
   */
  readonly ordersPausedAt: string | null;
  readonly lastLoginAt: string | null;
  /**
   * How many products they have a price for and how many they do not —
   * out of `sellableProducts`, the denominator the server states once
   * for the whole list rather than repeating on every row.
   *
   * These are the thing that silently stops somebody selling: a product
   * with no price is refused BY NAME at the order, and so is one whose
   * price the seller's range has moved out from under. They belong on
   * the LIST, not behind a click.
   */
  readonly pricedProducts: number;
  readonly unpricedProducts: number;
  readonly outOfRangePrices: number;
}

export interface AssociateListView {
  /** What the store may sell at all — every person's denominator. */
  readonly sellableProducts: number;
  readonly associates: readonly AssociateSummary[];
}

export interface AssociatePriceRow {
  readonly variantId: string;
  readonly productName: string;
  readonly variantLabel: string | null;
  readonly skuCode: string;
  /** This person's price. Null means unpriced — and therefore unsellable. */
  readonly retailPriceInr: string | null;
  /** The seller's terms. Null on a side means they set no bound there. */
  readonly minRetailInr: string | null;
  readonly maxRetailInr: string | null;
  readonly suggestedRetailInr: string | null;
  /**
   * A stored price the seller's range has moved out from under —
   * through the SELLER moving it, not through anybody here doing
   * anything. Deliberately not auto-adjusted (ASSOC-1): a price
   * somebody negotiated is not ours to change.
   */
  readonly outOfRange: boolean;
  readonly setAt: string | null;
}

export interface AssociatePricesView {
  readonly storeUserId: string;
  readonly fullName: string;
  readonly email: string;
  readonly ordersPausedAt: string | null;
  readonly rows: readonly AssociatePriceRow[];
}

export type AssociateCopySkipReason = 'NOT_SELLABLE' | 'ASSOCIATE_PRICE_OUT_OF_SELLER_RANGE';

/**
 * What a copy actually did — every product NAMED, never a bare count.
 *
 * The screen shows all four lists. A copy that silently dropped a third
 * of its rows and reported "done" is how somebody finds out at the
 * order instead, which is the one place this is expensive.
 */
export interface AssociateCopyResult {
  readonly from: { readonly storeUserId: string; readonly fullName: string };
  readonly to: { readonly storeUserId: string; readonly fullName: string };
  readonly created: ReadonlyArray<{
    readonly variantId: string;
    readonly skuCode: string;
    readonly retailPriceInr: string;
  }>;
  readonly overwritten: ReadonlyArray<{
    readonly variantId: string;
    readonly skuCode: string;
    readonly fromInr: string;
    readonly toInr: string;
  }>;
  readonly unchanged: ReadonlyArray<{
    readonly variantId: string;
    readonly skuCode: string;
    readonly retailPriceInr: string;
  }>;
  readonly skipped: ReadonlyArray<{
    readonly variantId: string;
    readonly skuCode: string;
    readonly code: AssociateCopySkipReason;
    readonly message: string;
  }>;
}

export interface AssociatePausedResult {
  readonly storeUserId: string;
  readonly ordersPausedAt: string | null;
}

/**
 * A rate as the API reports it: a PERCENTAGE (0–100), or null when
 * nothing has had an outcome yet. Never a fraction, and never 0 standing
 * in for "unknown" — RS-9's rule is that an unknown rate says so.
 */
export type Rate = number | null;

export interface AssociateAnalysisRow {
  readonly storeUserId: string;
  readonly fullName: string;
  readonly email: string;
  readonly ordersPausedAt: string | null;

  readonly ordersPlaced: number;
  readonly confirmed: number;
  readonly delivered: number;
  /** Cancelled OR rejected — `orderFate`'s "called off". */
  readonly cancelled: number;
  /** Orders that EVER hit a failed delivery, counted once each. */
  readonly ndr: number;
  readonly rto: number;

  /** The retail their customers paid on delivered orders. */
  readonly retailSoldInr: string;
  /**
   * Retail less the store's transfer price, over delivered lines where
   * BOTH are snapshotted.
   *
   * A line missing either is left OUT, not counted as zero (TRE-6), and
   * `marginCoverage` says how many — which is why the screen prints the
   * coverage beside the figure rather than the figure alone: a zero
   * reads as "we made the whole retail".
   */
  readonly storeMarginInr: string;
  readonly marginCoverage: {
    readonly lines: number;
    readonly linesWithTransferPrice: number;
  };

  readonly confirmationRate: Rate;
  readonly deliveryRate: Rate;
  readonly returnRate: Rate;
  /** The denominators, so the page states its coverage rather than implying none. */
  readonly decidedCount: number;
  readonly outcomeKnownCount: number;

  readonly pricedProducts: number;
  readonly unpricedProducts: number;
  readonly outOfRangePrices: number;
}

export interface AssociateAnalysisView {
  /** The window actually used, echoed back as ISO instants. */
  readonly from: string;
  readonly to: string;
  /** What the store may sell at all — the denominator behind the price counts. */
  readonly sellableProducts: number;
  /**
   * Orders of this store in the window that NOBODY on the roster placed
   * — the reseller's own, a seller-side CSV, an API key (which carries
   * no person). Shown on the screen rather than dropped, so the page's
   * numbers add up to the store's order list instead of quietly falling
   * short of it.
   */
  readonly ordersNotByAnAssociate: number;
  /** Ranked best-selling first by the server, which is this screen's default order. */
  readonly rows: readonly AssociateAnalysisRow[];
}

const ASSOCIATES = ['store-associates'] as const;

export function useAssociates(enabled = true): UseQueryResult<AssociateListView> {
  const client = useApiClient();
  return useQuery({
    queryKey: ASSOCIATES,
    enabled,
    queryFn: () => client.request<AssociateListView>('/api/store/associates'),
  });
}

export function useAssociatePrices(
  storeUserId: string,
  enabled = true,
): UseQueryResult<AssociatePricesView> {
  const client = useApiClient();
  return useQuery({
    queryKey: [...ASSOCIATES, 'prices', storeUserId],
    enabled: enabled && storeUserId !== '',
    queryFn: () =>
      client.request<AssociatePricesView>(`/api/store/associates/${storeUserId}/prices`),
  });
}

/**
 * Set one associate's price for one product.
 *
 * NOTHING is checked here. The seller's range is SHOWN beside the field
 * so the refusal is rarely met at all, but the rule itself is the
 * server's: `ASSOCIATE_PRICE_OUT_OF_SELLER_RANGE` is the seller's terms
 * talking, and a copy of that check in a browser is a second place able
 * to disagree with the one that counts (FE-2).
 *
 * The list is invalidated on SUCCESS and on FAILURE both: a refusal may
 * mean the seller moved the range while this screen was open, and the
 * next attempt has to be made against what is true now.
 */
export function useSetAssociatePrice(
  storeUserId: string,
): UseMutationResult<AssociatePriceRow, Error, { variantId: string; retailPriceInr: string }> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ variantId, retailPriceInr }) =>
      client.request<AssociatePriceRow>(
        `/api/store/associates/${storeUserId}/prices/${variantId}`,
        { method: 'PUT', body: { retailPriceInr } },
      ),
    onSettled: () => void qc.invalidateQueries({ queryKey: ASSOCIATES }),
  });
}

export function useCopyAssociatePrices(
  storeUserId: string,
): UseMutationResult<AssociateCopyResult, Error, { fromStoreUserId: string }> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ fromStoreUserId }) =>
      client.request<AssociateCopyResult>(
        `/api/store/associates/${storeUserId}/prices/copy-from/${fromStoreUserId}`,
        { method: 'POST' },
      ),
    onSettled: () => void qc.invalidateQueries({ queryKey: ASSOCIATES }),
  });
}

/**
 * Switch one associate's order creation on or off.
 *
 * It gates CREATING an order and nothing else (ASSOC-1), which is why
 * the screens say so in those words rather than "suspend": the person
 * keeps their login, their history and every order already placed.
 */
export function usePauseAssociateOrders(): UseMutationResult<
  AssociatePausedResult,
  Error,
  { storeUserId: string; paused: boolean }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ storeUserId, paused }) =>
      client.request<AssociatePausedResult>(`/api/store/associates/${storeUserId}/orders-paused`, {
        method: 'PATCH',
        body: { paused },
      }),
    onSettled: () => void qc.invalidateQueries({ queryKey: ASSOCIATES }),
  });
}

/**
 * Who is selling how much over a window.
 *
 * The window is a pair of ISO instants at IST midnight (`istDayRange`),
 * half-open, exactly as the store's own reports send it — business days
 * are Indian days and adjacent windows must tile.
 */
export function useAssociateAnalysis(window: Window): UseQueryResult<AssociateAnalysisView> {
  const client = useApiClient();
  return useQuery({
    queryKey: [...ASSOCIATES, 'analysis', window.from, window.to],
    queryFn: () => {
      const qs = new URLSearchParams({ from: window.from, to: window.to }).toString();
      return client.request<AssociateAnalysisView>(`/api/store/associates/analysis?${qs}`);
    },
  });
}
