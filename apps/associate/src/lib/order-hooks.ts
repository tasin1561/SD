'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import type { OrderStatus } from '@skydrop/db';
import { useApiClient } from '@skydrop/auth/client';

/**
 * ASSOC-1 — the orders THIS person placed, and the customers they sold
 * to. Every path is the store's own surface (`/api/store/*`, scoped by
 * the token), narrowed to the caller by `store_roles.order_scope = OWN`
 * in the server's WHERE clause. No id of theirs appears in any URL here,
 * by construction.
 *
 * ── THE TYPES ARE NARROWER THAN THE RESPONSES, ON PURPOSE ───────────
 * `GET /store/orders/:id` answers a store OWNER with the store's cost on
 * every line (`transferPriceInr`) and a transfer total. An associate
 * must not learn what the store pays for a product — it is the spread
 * the store makes on them, the same fact RS-3 keeps from the store about
 * the seller, one level down. So those fields are ABSENT from the types
 * below: a field this file does not declare cannot reach a page, and
 * `src/tests/no-store-cost.test.ts` sweeps the sources so re-adding one
 * fails a test. `GET /store/orders/:id/money` — what the order earns the
 * store — is never called from this app at all.
 */

export interface MyOrderListItem {
  readonly id: string;
  readonly orderNumber: string;
  readonly sellerOrderRef: string | null;
  readonly status: OrderStatus;
  readonly placedAt: string;
  readonly recipientName: string;
  readonly recipientPhoneE164: string;
  readonly recipientCity: string;
  readonly recipientPostalCode: string;
  readonly paymentMode: 'COD' | 'PREPAID';
  readonly codAmountInr: string | null;
  readonly itemCount: number;
}

export interface MyOrderLine {
  readonly id: string;
  readonly variantId: string;
  readonly skuCode: string;
  readonly productName: string;
  readonly variantLabel: string | null;
  readonly imageUrl: string | null;
  readonly quantity: number;
  /** What it was sold for. Never what the store paid for it. */
  readonly retailUnitInr: string | null;
}

export interface MyOrderView {
  readonly id: string;
  readonly orderNumber: string;
  readonly sellerOrderRef: string | null;
  readonly status: OrderStatus;
  readonly terminal: boolean;
  /** What the order's stage leaves room for. Cosmetic — the server decides. */
  readonly stages: {
    /** Cancel — until the parcel is packed. */
    readonly cancel: boolean;
    /**
     * Ask for another delivery attempt — out for delivery, or just
     * failed. The ONE window in which a re-attempt means anything: a
     * parcel that has not reached the city cannot be re-attempted, and
     * one already delivered does not need to be.
     */
    readonly deliveryActions: boolean;
  };
  readonly placedAt: string;
  readonly confirmedAt: string | null;
  readonly cancelledAt: string | null;
  readonly recipient: {
    readonly name: string;
    readonly phoneE164: string;
    readonly altPhoneE164: string | null;
    readonly email: string | null;
    readonly addressLine1: string;
    readonly addressLine2: string | null;
    readonly landmark: string | null;
    readonly city: string;
    readonly stateProvince: string;
    readonly postalCode: string;
  };
  readonly paymentMode: 'COD' | 'PREPAID';
  readonly codAmountInr: string | null;
  readonly deliveryFeeInr: string | null;
  readonly notes: string | null;
  readonly lines: readonly MyOrderLine[];
  readonly totals: { readonly retailInr: string };
  readonly shipments: ReadonlyArray<{
    readonly awbNumber: string | null;
    readonly courierCode: string;
    readonly status: string;
  }>;
}

export interface MyOrderEvent {
  readonly id: string;
  readonly type: string;
  readonly fromStatus: OrderStatus | null;
  readonly toStatus: OrderStatus | null;
  readonly description: string | null;
  readonly createdAt: string;
}

export interface Paged<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

export interface MyOrdersQuery {
  readonly status?: OrderStatus;
  readonly search?: string;
  readonly page?: number;
  readonly pageSize?: number;
}

export interface CreateOrderInput {
  readonly sellerOrderRef?: string;
  readonly recipientName: string;
  readonly recipientPhoneE164: string;
  readonly recipientEmail?: string;
  readonly recipientAddressLine1: string;
  readonly recipientAddressLine2: string;
  readonly recipientPostalCode: string;
  readonly paymentMode: 'COD' | 'PREPAID';
  readonly codAmountInr?: number;
  readonly deliveryFeeInr?: number;
  readonly notes?: string;
  readonly acknowledgeDuplicate?: boolean;
  readonly items: ReadonlyArray<{
    readonly variantId: string;
    readonly quantity: number;
    /**
     * This person's own price, sent back exactly as the catalogue gave
     * it. The price is FIXED — there is no field for it on the form, and
     * a retail that disagrees with their `associate_prices` row is
     * refused by the server rather than accepted.
     */
    readonly retailUnitPriceInr: number;
  }>;
}

export interface MyCustomer {
  readonly id: string;
  readonly phoneE164: string;
  readonly name: string | null;
  readonly email: string | null;
  readonly totalOrdersCount: number;
  readonly lastOrderAt: string | null;
  readonly createdAt: string;
}

/**
 * What came of a cancel: cancelled now, or held for Seller staff because
 * the seller approves this store's cancels first. The REPLY says which —
 * never a policy read when the page loaded.
 */
export interface HeldRequest {
  readonly id: string;
  readonly kind: 'CANCEL' | 'CALL_CAP_DECISION' | 'RAISE_ISSUE';
  readonly status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXECUTED' | 'FAILED' | 'EXPIRED';
  readonly label: string;
  readonly createdAt: string;
}

export type CancelOutcome =
  | { readonly applied: true; readonly order: MyOrderView; readonly request: null }
  | { readonly applied: false; readonly order: null; readonly request: HeldRequest };

export const ORDERS_KEY = ['my-orders'] as const;
const CUSTOMERS = ['my-customers'] as const;

function qs(q: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v !== undefined && v !== '') sp.set(k, String(v));
  }
  const s = sp.toString();
  return s === '' ? '' : `?${s}`;
}

export function useMyOrders(query: MyOrdersQuery): UseQueryResult<Paged<MyOrderListItem>> {
  const client = useApiClient();
  return useQuery({
    queryKey: [...ORDERS_KEY, 'list', query],
    queryFn: () =>
      client.request<Paged<MyOrderListItem>>(
        `/api/store/orders${qs({
          status: query.status,
          search: query.search,
          page: query.page,
          pageSize: query.pageSize,
        })}`,
      ),
  });
}

export function useMyOrder(id: string): UseQueryResult<MyOrderView> {
  const client = useApiClient();
  return useQuery({
    queryKey: [...ORDERS_KEY, 'detail', id],
    queryFn: () => client.request<MyOrderView>(`/api/store/orders/${id}`),
    enabled: id !== '',
  });
}

export function useMyOrderEvents(id: string): UseQueryResult<readonly MyOrderEvent[]> {
  const client = useApiClient();
  return useQuery({
    queryKey: [...ORDERS_KEY, 'events', id],
    queryFn: () => client.request<readonly MyOrderEvent[]>(`/api/store/orders/${id}/events`),
    enabled: id !== '',
  });
}

export function useCreateOrder(): UseMutationResult<MyOrderView, Error, CreateOrderInput> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<MyOrderView>('/api/store/orders', { method: 'POST', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ORDERS_KEY });
      // What is available has just moved.
      void qc.invalidateQueries({ queryKey: ['sell-catalogue'] });
    },
  });
}

export function useCancelOrder(): UseMutationResult<
  CancelOutcome,
  Error,
  { readonly id: string; readonly note?: string }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, note }) =>
      client.request<CancelOutcome>(`/api/store/orders/${id}/cancel`, {
        method: 'POST',
        body: note === undefined || note === '' ? {} : { note },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ORDERS_KEY }),
  });
}

export function useMyCustomers(query: {
  readonly search?: string;
  readonly page?: number;
}): UseQueryResult<Paged<MyCustomer>> {
  const client = useApiClient();
  return useQuery({
    queryKey: [...CUSTOMERS, query],
    queryFn: () =>
      client.request<Paged<MyCustomer>>(
        `/api/store/customers${qs({ search: query.search, page: query.page, pageSize: 20 })}`,
      ),
  });
}

/* ── Asking for another delivery attempt (ASSOC-1) ──────────────────── */

/**
 * The owner's words were "yes can cancel and asl for a reattempt", and
 * the two are different acts: raising an issue starts a conversation,
 * while asking for a re-attempt DISPATCHES A VAN. A sales person whose
 * customer says "I was out, try tomorrow" is exactly who should be able
 * to ask, so it is here.
 *
 * RECALL and RTO (send it back) are deliberately NOT offered from this
 * portal. The owner named cancel and re-attempt; a send-back turns a
 * parcel round at somebody's cost on one click, and a recall spends the
 * call centre's time. Both remain the store's own to ask for.
 */
export type StoreActionMode = 'OFF' | 'ASK_SELLER' | 'DIRECT';

export interface MyActionRequest {
  readonly id: string;
  /** Every kind the store can ask for — the history shows what was asked, by anyone. */
  readonly action: 'RECALL' | 'REATTEMPT' | 'RTO';
  readonly reason: string;
  readonly status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXECUTED' | 'FAILED' | 'EXPIRED';
  readonly decisionNote: string | null;
  readonly decidedAt: string | null;
  readonly executedAt: string | null;
  readonly executionError: string | null;
  readonly createdAt: string;
}

export interface MyOrderActions {
  readonly items: readonly MyActionRequest[];
  /**
   * The SELLER's policy for this store, per capability — `reattempt` is
   * the only one this portal reads. OFF is not rendered at all: an
   * offered button that always refuses teaches people to ignore
   * refusals. ASK_SELLER is offered AND says so, because whether a van
   * is coming is what the associate is about to tell a customer.
   */
  readonly allowed: Readonly<Record<string, StoreActionMode>>;
}

export function useMyOrderActions(orderId: string): UseQueryResult<MyOrderActions> {
  const client = useApiClient();
  return useQuery({
    queryKey: [...ORDERS_KEY, 'actions', orderId],
    queryFn: () => client.request<MyOrderActions>(`/api/store/orders/${orderId}/actions`),
    enabled: orderId !== '',
  });
}

/**
 * What came of asking. `awaitingSeller` is the REPLY's own answer, never
 * inferred from the policy this page read when it loaded — Seller staff
 * may have changed it since, and "a van is coming" told wrongly is worse
 * than not asking at all. A request the courier turns down comes back
 * `status: 'FAILED'` with its reason.
 */
export function useRequestReattempt(): UseMutationResult<
  { readonly request: MyActionRequest; readonly awaitingSeller: boolean },
  Error,
  { readonly orderId: string; readonly reason: string }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, reason }) =>
      client.request<{ request: MyActionRequest; awaitingSeller: boolean }>(
        `/api/store/orders/${orderId}/actions`,
        { method: 'POST', body: { action: 'REATTEMPT', reason } },
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ORDERS_KEY }),
  });
}
