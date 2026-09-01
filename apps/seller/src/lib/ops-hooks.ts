'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useApiClient } from '@skydrop/auth/client';
import type {
  Currency,
  EarlyReservationReviewStatus,
  InboundFreightMode,
  InboundFreightStatus,
  StockUnitStatus,
  TicketStatus,
  TicketType,
  WithdrawalRequestedBy,
  WithdrawalRequestStatus,
} from '@skydrop/db';

/**
 * Seller-side wrappers for the R-phase surfaces: tickets, inbound
 * freight, withdrawal requests, at-placement hold reviews, and the
 * serialized-unit discrepancy report.
 *
 * These mirror the admin `ops-hooks` but hit the seller endpoints, which
 * are scoped to the caller's own seller by the guard — no sellerId is
 * ever sent from the client.
 */

export interface TicketView {
  readonly id: string;
  readonly ticketType: TicketType;
  readonly status: TicketStatus;
  readonly sellerId: string;
  readonly orderId: string | null;
  readonly shipmentId: string | null;
  readonly shipmentItemId: string | null;
  readonly courierCode: string | null;
  readonly subject: string;
  readonly description: string | null;
  readonly resolutionAmountInr: string | null;
  readonly resolutionWalletEntryId: string | null;
  readonly resolutionNotes: string | null;
  readonly resolvedAt: string | null;
  readonly createdAt: string;
}

export interface FreightChargeView {
  readonly id: string;
  readonly goodsReceiptId: string;
  readonly receiptNumber: string | null;
  readonly consignmentId: string;
  readonly consignmentNumber: string | null;
  readonly amountInr: string;
  readonly mode: InboundFreightMode;
  readonly serviceChargePercent: string | null;
  readonly serviceChargeInr: string | null;
  readonly totalInr: string;
  readonly totalUnits: number;
  readonly unitsSettled: number;
  readonly amountSettledInr: string;
  readonly outstandingInr: string;
  readonly status: InboundFreightStatus;
  readonly settledAt: string | null;
  readonly note: string | null;
  readonly createdAt: string;
}

export interface WithdrawalRequestView {
  readonly id: string;
  readonly sellerId: string;
  readonly currency: Currency;
  readonly amountRequested: string;
  readonly status: WithdrawalRequestStatus;
  readonly requestedBy: WithdrawalRequestedBy;
  readonly linkedRemittanceId: string | null;
  /** Set on an INBOUND_FREIGHT debit — freight belongs to a consignment. */
  readonly linkedConsignmentId: string | null;
  readonly linkedConsignmentNumber: string | null;
  readonly rejectionReason: string | null;
  readonly note: string | null;
  readonly createdAt: string;
  readonly resolvedAt: string | null;
}

export interface ReviewView {
  readonly id: string;
  readonly orderId: string;
  readonly status: EarlyReservationReviewStatus;
  readonly attemptCount: number;
  readonly heldQty: number;
  readonly note: string | null;
  readonly resolvedAt: string | null;
  readonly createdAt: string;
}

export interface DecisionResult {
  readonly review: ReviewView;
  readonly orderStatus: string | null;
  readonly orderMoved: boolean;
}

export interface StuckUnitRow {
  readonly stockUnitId: string;
  readonly serialBarcode: string;
  readonly variantId: string;
  readonly skuCode: string | null;
  readonly status: StockUnitStatus;
  readonly warehouseId: string;
  readonly hoursInStatus: number;
  readonly lastScanAt: string | null;
  readonly shipmentId: string | null;
}

export interface UnitCountMismatchRow {
  readonly variantId: string;
  readonly skuCode: string | null;
  readonly warehouseId: string;
  readonly unitsInStock: number;
  readonly qtyOnHand: number;
  readonly delta: number;
}

export interface UnitDiscrepancyReport {
  readonly sellerId: string;
  readonly generatedAt: string;
  readonly thresholds: {
    readonly stuckSlaHours: number;
    readonly dispatchedUnresolvedDays: number;
  };
  readonly stuckUnits: readonly StuckUnitRow[];
  readonly unresolvedDispatched: readonly StuckUnitRow[];
  readonly retiredUnits: readonly StuckUnitRow[];
  readonly countMismatches: readonly UnitCountMismatchRow[];
}

// ───────── Tickets (R7) ─────────

export function useSellerTickets(query: {
  status?: string;
}): UseQueryResult<readonly TicketView[]> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['seller-tickets', 'list', query],
    queryFn: () =>
      client.request<readonly TicketView[]>(
        `/api/seller/tickets${query.status === undefined || query.status === '' ? '' : `?status=${query.status}`}`,
      ),
  });
}

export function useCreateTicket(): UseMutationResult<
  TicketView,
  Error,
  { subject: string; description?: string; orderId?: string; shipmentId?: string }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<TicketView>('/api/seller/tickets', { method: 'POST', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['seller-tickets'] }),
  });
}

// ───────── Inbound freight (R3) ─────────

export function useSellerFreight(query: { status?: string }): UseQueryResult<{
  items: readonly FreightChargeView[];
  outstandingInr: string;
}> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['seller-freight', 'list', query],
    queryFn: () =>
      client.request<{
        items: readonly FreightChargeView[];
        outstandingInr: string;
      }>(
        `/api/seller/inbound-freight${query.status === undefined || query.status === '' ? '' : `?status=${query.status}`}`,
      ),
  });
}

// ───────── Withdrawals (R2) ─────────

export function useSellerWithdrawals(): UseQueryResult<readonly WithdrawalRequestView[]> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['seller-withdrawals', 'list'],
    queryFn: () =>
      client.request<readonly WithdrawalRequestView[]>('/api/seller/wallet/withdrawal-requests'),
  });
}

export interface WalletTerm {
  readonly key: string;
  readonly label: string;
  readonly kind: string;
  readonly hint: string;
  readonly value: string;
}

/**
 * The rules this wallet runs on.
 *
 * Read-only EXCEPT the two withdrawal-schedule ones, which the seller owns
 * (useWithdrawalSchedule writes those). Everything else is what Skydrop
 * charges and allows: a seller who could raise their own withdrawal cap
 * would not have one.
 *
 * The schedule is safe to hand over because an automatic request passes
 * the identical guard chain as a manual one (WAL-3) — turning it on
 * cannot take money a manual request could not.
 */
export interface CreditStandingView {
  readonly balanceInr: string;
  readonly stockValueInr: string;
  readonly allowanceInr: string;
  readonly headroomInr: string;
  readonly blocked: boolean;
  readonly reason: string | null;
}

export function useCreditStanding(): UseQueryResult<CreditStandingView> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['seller-wallet', 'credit'],
    queryFn: () => client.request<CreditStandingView>('/api/seller/wallet/credit'),
  });
}

export function useWalletTerms(): UseQueryResult<{ items: WalletTerm[] }> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['seller-wallet', 'terms'],
    queryFn: () => client.request<{ items: WalletTerm[] }>('/api/seller/wallet/settings'),
  });
}

export interface ActiveRestrictionView {
  readonly id: string;
  readonly blockedCapabilities: readonly string[];
  readonly clearAtBalanceInr: string;
  readonly balanceInr: string;
  readonly shortfallInr: string;
  readonly reason: string;
  readonly createdAt: string;
}

/**
 * The hold on this account, if any.
 *
 * Its own query rather than a field on /me: /me is resolved once on the
 * server per page load, and a seller who tops up needs the banner to go
 * away without navigating.
 */
export function useSellerRestriction(): UseQueryResult<ActiveRestrictionView | null> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['seller-restriction'],
    queryFn: () => client.request<ActiveRestrictionView | null>('/api/seller/restriction'),
  });
}

export interface WithdrawalEligibility {
  readonly withdrawableInr: string;
  readonly balanceInr: string;
  readonly minimumBalanceInr: string;
  /** Already asked for and not yet paid — held out of what is available. */
  readonly pendingWithdrawalInr: string;
  readonly hasBankAccount: boolean;
}

/**
 * What the withdrawal form needs before a seller starts typing: how much
 * they can actually take, and whether we have anywhere to send it.
 */
export function useWithdrawalEligibility(): UseQueryResult<WithdrawalEligibility> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['seller-withdrawals', 'eligibility'],
    queryFn: () =>
      client.request<WithdrawalEligibility>('/api/seller/wallet/withdrawal-requests/eligibility'),
  });
}

export function useRequestWithdrawal(): UseMutationResult<
  WithdrawalRequestView,
  Error,
  { currency: string; amount: string; note?: string }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<WithdrawalRequestView>('/api/seller/wallet/withdrawal-requests', {
        method: 'POST',
        body,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['seller-withdrawals'] });
      void qc.invalidateQueries({ queryKey: ['seller-wallet'] });
    },
  });
}

// ───────── At-placement hold reviews (R5) ─────────

export function useHoldReviews(query: { status?: string }): UseQueryResult<readonly ReviewView[]> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['seller-hold-reviews', 'list', query],
    queryFn: () =>
      client.request<readonly ReviewView[]>(
        `/api/seller/early-reservation-reviews${query.status === undefined || query.status === '' ? '' : `?status=${query.status}`}`,
      ),
  });
}

export function useDecideHoldReview(): UseMutationResult<
  DecisionResult,
  Error,
  { reviewId: string; decision: 'RELEASE' | 'REQUEST_MORE_ATTEMPTS'; note?: string }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ reviewId, ...body }) =>
      client.request<DecisionResult>(`/api/seller/early-reservation-reviews/${reviewId}`, {
        method: 'PATCH',
        body,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['seller-hold-reviews'] });
      // Releasing a hold changes available stock, and the decision may
      // move the order.
      void qc.invalidateQueries({ queryKey: ['seller-stock'] });
      void qc.invalidateQueries({ queryKey: ['seller-orders'] });
    },
  });
}

// ───────── Serialized units (R4) ─────────

/**
 * Where one of your units has been.
 *
 * Scoped to the caller's own account by the server, so a serial another
 * company printed simply is not found — `stock_units` is keyed on
 * `(sellerId, serialBarcode)` and two companies may legitimately print
 * the same number.
 */
export interface UnitTraceEvent {
  readonly fromStatus: StockUnitStatus | null;
  readonly toStatus: StockUnitStatus;
  /** Which step moved it: PICK, PACK, DISPATCH, RTO_RECEIVE, ... */
  readonly gate: string;
  readonly at: string;
  readonly shipmentId: string | null;
  readonly note: string | null;
}

export interface UnitTrace {
  /** null when no unit with that serial is yours. */
  readonly unit: StuckUnitRow | null;
  readonly events: readonly UnitTraceEvent[];
}

export function useUnitTrace(serialBarcode: string): UseQueryResult<UnitTrace> {
  const client = useApiClient();
  const serial = serialBarcode.trim();
  return useQuery({
    queryKey: ['seller-stock-units', 'trace', serial],
    // An empty lookup would render "no such unit", which reads as an
    // answer rather than as a question nobody asked.
    enabled: serial !== '',
    queryFn: () =>
      client.request<UnitTrace>(`/api/seller/stock-units/trace/${encodeURIComponent(serial)}`),
  });
}

export function useUnitDiscrepancies(warehouseId?: string): UseQueryResult<UnitDiscrepancyReport> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['seller-units', 'discrepancies', warehouseId ?? null],
    queryFn: () =>
      client.request<UnitDiscrepancyReport>(
        `/api/seller/stock-units/discrepancies${
          warehouseId === undefined || warehouseId === '' ? '' : `?warehouseId=${warehouseId}`
        }`,
      ),
  });
}

// ───────── Courier conversation (the escalation thread) ─────────

export interface CourierThreadMessage {
  readonly id: string;
  readonly direction: 'INBOUND' | 'OUTBOUND';
  readonly channel: string;
  /** VERBATIM — the courier's words, or yours. Never rewritten. */
  readonly body: string;
  readonly occurredAt: string;
  readonly state: string | null;
  readonly templateCode: string | null;
  readonly needsReview: boolean;
}

export interface CourierThread {
  readonly id: string;
  readonly ticketId: string;
  readonly externalTicketId: string | null;
  readonly awbNumber: string | null;
  readonly state: string | null;
  readonly lastMessageAt: string | null;
  readonly needsReviewAt: string | null;
  readonly pendingOutbound: number;
  readonly messages: readonly CourierThreadMessage[];
}

/** The conversation for a ticket, or null when none has been opened. */
export function useCourierThreadForTicket(ticketId: string): UseQueryResult<CourierThread | null> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['courier-thread', ticketId],
    queryFn: () =>
      client.request<CourierThread | null>(`/api/seller/courier-escalations/by-ticket/${ticketId}`),
    // A courier reply can arrive at any time and the seller is often
    // sitting on this screen waiting for one.
    refetchInterval: 30_000,
  });
}

export function useReplyToCourier(): UseMutationResult<
  { messageId: string; outboxItemId: string | null },
  Error,
  { escalationId: string; body: string; ticketId: string }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ escalationId, body }) =>
      client.request<{ messageId: string; outboxItemId: string | null }>(
        `/api/seller/courier-escalations/${escalationId}/reply`,
        { method: 'POST', body: { body } },
      ),
    onSuccess: (_r, vars) =>
      void qc.invalidateQueries({ queryKey: ['courier-thread', vars.ticketId] }),
  });
}

// ───────── Failed deliveries (NDR) ─────────

export type DeliveryActionKind = 'REATTEMPT' | 'RECALL' | 'RTO';
export type DeliveryActionStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXECUTED' | 'FAILED';

export interface DeliveryActionRequestView {
  readonly id: string;
  readonly action: DeliveryActionKind;
  readonly reason: string;
  readonly status: DeliveryActionStatus;
  readonly decisionNote: string | null;
  readonly decidedAt: string | null;
  readonly executedAt: string | null;
  readonly executionError: string | null;
  readonly createdAt: string;
}

export function useDeliveryActions(
  orderId: string,
): UseQueryResult<{ items: DeliveryActionRequestView[]; canRequest: boolean }> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['seller-delivery-actions', orderId],
    queryFn: () =>
      client.request<{ items: DeliveryActionRequestView[]; canRequest: boolean }>(
        `/api/seller/orders/${orderId}/delivery-actions`,
      ),
  });
}

export function useRequestDeliveryAction(): UseMutationResult<
  DeliveryActionRequestView,
  Error,
  { orderId: string; action: DeliveryActionKind; reason: string }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, ...body }) =>
      client.request<DeliveryActionRequestView>(`/api/seller/orders/${orderId}/delivery-actions`, {
        method: 'POST',
        body,
      }),
    onSuccess: (_d, v) =>
      void qc.invalidateQueries({ queryKey: ['seller-delivery-actions', v.orderId] }),
  });
}

export interface SellerVisibleCall {
  readonly id: string;
  readonly calledAt: string;
  readonly outcome: string;
  readonly notes: string | null;
  readonly customerSaidName: string | null;
  readonly customerSaidAddress: string | null;
  readonly rescheduledFor: string | null;
}

export function useCallHistory(orderId: string): UseQueryResult<{ items: SellerVisibleCall[] }> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['seller-call-history', orderId],
    queryFn: () =>
      client.request<{ items: SellerVisibleCall[] }>(`/api/seller/orders/${orderId}/call-history`),
  });
}

// ───────── Can we deliver there? ─────────

export interface ServiceabilityVerdict {
  readonly serviceable: boolean;
  readonly reason: string | null;
  /** False means we could not find out — NOT that it is undeliverable. */
  readonly known: boolean;
}

/**
 * Advisory, and cheap.
 *
 * The underlying courier lookup is cached for a day server-side, so
 * typing a pincode costs nothing after the first order to it. Enabled
 * only on a complete pincode — asking about "5600" would spend a lookup
 * on a value that cannot be an answer.
 */
export function useServiceability(
  pincode: string,
  paymentMode: 'COD' | 'PREPAID',
): UseQueryResult<ServiceabilityVerdict> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['seller-serviceability', pincode, paymentMode],
    enabled: /^\d{6}$/.test(pincode),
    // A pin's serviceability does not change while a form is open.
    staleTime: 10 * 60 * 1000,
    retry: false,
    queryFn: () =>
      client.request<ServiceabilityVerdict>(
        `/api/seller/serviceability?pincode=${pincode}&paymentMode=${paymentMode}`,
      ),
  });
}

/* ── NSA — orders of ours that are stuck out for delivery ──────────── */

export interface NsaOrderView {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly sellerId: string;
  readonly sellerName: string | null;
  readonly status: string;
  readonly recipientName: string;
  readonly recipientCity: string;
  readonly recipientPhoneE164: string;
  readonly codAmountInr: string | null;
  readonly awbNumber: string | null;
  readonly courierCode: string | null;
  /** Which evening this is — 1 the first night, 2 and 3 after. */
  readonly dayCount: number;
  readonly raisedAt: string;
  readonly outForDeliveryAt: string | null;
  readonly acknowledgedAt: string | null;
  readonly note: string | null;
}

/**
 * The seller's own stuck parcels. No sellerId crosses the wire — the
 * guard supplies it, so this can only ever return their own.
 */
export function useMyNsaOrders(): UseQueryResult<readonly NsaOrderView[]> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['seller-nsa', 'list'],
    queryFn: () => client.request<readonly NsaOrderView[]>('/api/seller/nsa'),
  });
}
