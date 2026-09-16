'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import type { EarlyReservationReviewStatus, OrderStatus } from '@skydrop/db';
import { useApiClient } from '@skydrop/auth/client';
import { STORE_ORDERS_KEY } from './order-hooks';

/**
 * 2026-09-16 — the call-cap question, on this store's own orders.
 *
 * We rang the customer as many times as the seller allows and never
 * reached them. Their stock is still held against an order that may
 * never happen, and on a reseller order the STORE is the party who knows
 * whether another call is worth making — so they are asked.
 *
 * Whether they MAY answer is the seller's `callCapDecision` policy for
 * the store, and the server decides it: both endpoints refuse with
 * `STORE_ACTION_NOT_ALLOWED` when the seller kept the question. Nothing
 * here predicts that (FE-2) — the refusal is shown in the server's own
 * words, and it is a sentence that says who does answer it instead.
 */

export interface StoreCallReview {
  readonly id: string;
  readonly orderId: string;
  readonly status: EarlyReservationReviewStatus;
  /** How many times the call centre has tried the customer. */
  readonly attemptCount: number;
  /** Units of the seller's stock held against this order meanwhile. */
  readonly heldQty: number;
  readonly note: string | null;
  readonly resolvedAt: string | null;
  /** When the question was raised — what "waiting since" is read from. */
  readonly createdAt: string;
}

export type CallReviewDecision = 'RELEASE' | 'REQUEST_MORE_ATTEMPTS';

/**
 * What the answer came back as.
 *
 * `orderMoved` is the half that is easy to miss: the review is recorded
 * and the stock released FIRST, the order transition LAST, and the order
 * may legitimately have moved on while somebody was deciding. That is
 * not an error — but "we recorded it and calling did not restart" is a
 * different thing to tell a person than "we will keep trying".
 */
export interface CallReviewDecisionResult {
  readonly review: StoreCallReview;
  readonly orderStatus: OrderStatus | null;
  readonly orderMoved: boolean;
}

export const STORE_CALL_REVIEWS_KEY = ['store-call-reviews'] as const;

/**
 * The open questions on this store's orders. Empty when there are none.
 *
 * `enabled` exists because the shell reads the count on EVERY page: this
 * needs `orders.actions`, so asked unconditionally it would fire a 403
 * on every page view for anybody without it.
 *
 * `retry: false` because the two refusals this endpoint gives — the
 * permission and the seller's policy — will refuse again a second later.
 * Retrying them costs a round trip and delays the page saying why.
 */
export function useStoreCallReviews(
  options: { readonly enabled?: boolean } = {},
): UseQueryResult<readonly StoreCallReview[]> {
  const client = useApiClient();
  return useQuery({
    queryKey: STORE_CALL_REVIEWS_KEY,
    queryFn: () => client.request<readonly StoreCallReview[]>('/api/store/call-reviews'),
    enabled: options.enabled ?? true,
    retry: false,
  });
}

/**
 * Answering it.
 *
 * RELEASE gives the seller's stock back AND rejects the order; there is
 * no undo, which is why the screen asking this spells out both halves
 * before it is sent. REQUEST_MORE_ATTEMPTS keeps the hold and puts the
 * order back in the call queue.
 */
export function useDecideStoreCallReview(): UseMutationResult<
  CallReviewDecisionResult,
  Error,
  { readonly reviewId: string; readonly decision: CallReviewDecision; readonly note?: string }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ reviewId, decision, note }) =>
      client.request<CallReviewDecisionResult>(`/api/store/call-reviews/${reviewId}`, {
        method: 'PATCH',
        body: { decision, ...(note === undefined || note === '' ? {} : { note }) },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: STORE_CALL_REVIEWS_KEY });
      // Either answer moves the ORDER — rejected, or back in the call
      // queue — so every list and detail holding it is now stale. This
      // also feeds the nav count, which reads the reviews key above: left
      // alone it keeps advertising a queue the person has just emptied.
      void qc.invalidateQueries({ queryKey: STORE_ORDERS_KEY });
    },
  });
}
