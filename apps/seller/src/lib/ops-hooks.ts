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
        `/seller/tickets${query.status === undefined || query.status === '' ? '' : `?status=${query.status}`}`,
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
      client.request<TicketView>('/seller/tickets', { method: 'POST', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['seller-tickets'] }),
  });
}

// ───────── Inbound freight (R3) ─────────

export function useSellerFreight(query: {
  status?: string;
}): UseQueryResult<{
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
        `/seller/inbound-freight${query.status === undefined || query.status === '' ? '' : `?status=${query.status}`}`,
      ),
  });
}

// ───────── Withdrawals (R2) ─────────

export function useSellerWithdrawals(): UseQueryResult<
  readonly WithdrawalRequestView[]
> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['seller-withdrawals', 'list'],
    queryFn: () =>
      client.request<readonly WithdrawalRequestView[]>(
        '/seller/wallet/withdrawal-requests',
      ),
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
      client.request<WithdrawalRequestView>('/seller/wallet/withdrawal-requests', {
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

export function useHoldReviews(query: {
  status?: string;
}): UseQueryResult<readonly ReviewView[]> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['seller-hold-reviews', 'list', query],
    queryFn: () =>
      client.request<readonly ReviewView[]>(
        `/seller/early-reservation-reviews${query.status === undefined || query.status === '' ? '' : `?status=${query.status}`}`,
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
      client.request<DecisionResult>(
        `/seller/early-reservation-reviews/${reviewId}`,
        { method: 'PATCH', body },
      ),
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

export function useUnitDiscrepancies(warehouseId?: string): UseQueryResult<
  UnitDiscrepancyReport
> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['seller-units', 'discrepancies', warehouseId ?? null],
    queryFn: () =>
      client.request<UnitDiscrepancyReport>(
        `/seller/stock-units/discrepancies${
          warehouseId === undefined || warehouseId === ''
            ? ''
            : `?warehouseId=${warehouseId}`
        }`,
      ),
  });
}
