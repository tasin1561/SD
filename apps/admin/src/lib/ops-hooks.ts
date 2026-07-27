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
  CredentialEnvironment,
  Currency,
  InboundFreightMode,
  InboundFreightStatus,
  TicketStatus,
  TicketType,
  WithdrawalRequestedBy,
  WithdrawalRequestStatus,
} from '@skydrop/db';

/**
 * TanStack Query wrappers for the money + exception surfaces added by
 * R0–R7 and D1–D7 — tickets, inbound freight, courier settlements,
 * courier accounts and withdrawals.
 *
 * Kept out of `api-hooks.ts` (which already carries the original 18
 * modules at ~70 hooks) purely for navigability. Same conventions:
 * query key `[domain, op, ...args]`, mutations invalidate the domain
 * prefix, and the shapes below mirror the service view types exactly —
 * dates arrive as ISO strings over the wire even though the server
 * types them as `Date`.
 */

// ───────── shared shapes ─────────

export interface Paginated<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

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

export interface TicketEventView {
  readonly id: string;
  readonly ticketId: string;
  readonly fromStatus: string | null;
  readonly toStatus: string;
  readonly notes: string | null;
  readonly actorType: string;
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
  readonly walletEntryId: string | null;
  readonly note: string | null;
  readonly createdAt: string;
}

export interface SettlementLineView {
  readonly orderId: string;
  readonly orderNumber: string | null;
  readonly expectedInr: string;
  readonly settledInr: string;
  /** settled − expected. Negative ⇒ the courier short-paid this order. */
  readonly varianceInr: string;
}

export interface SettlementView {
  readonly id: string;
  readonly courierAccountId: string;
  readonly reference: string;
  readonly amountInr: string;
  readonly allocatedInr: string;
  /** amount − allocated. Non-zero ⇒ the payout isn't fully explained. */
  readonly unallocatedInr: string;
  readonly receivedAt: string;
  readonly note: string | null;
  readonly lines: readonly SettlementLineView[];
  readonly createdAt: string;
}

export interface UnsettledOrderRow {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly sellerId: string;
  readonly deliveredAt: string | null;
  readonly ageDays: number;
  readonly expectedInr: string;
  readonly settledInr: string;
  readonly shortfallInr: string;
}

export interface ReconciliationReport {
  readonly generatedAt: string;
  readonly overdueAfterDays: number;
  readonly outstandingFloatInr: string;
  readonly overdueInr: string;
  readonly overdueOrders: readonly UnsettledOrderRow[];
  readonly shortPaidOrders: readonly UnsettledOrderRow[];
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

export interface CourierAccountView {
  readonly id: string;
  readonly courierCode: string;
  readonly environment: CredentialEnvironment;
  readonly label: string;
  readonly isDefault: boolean;
  readonly isActive: boolean;
  readonly notes: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SellerCourierAccountLinkView {
  readonly id: string;
  readonly sellerId: string;
  readonly courierAccountId: string;
  readonly distributionWeight: number;
  readonly isActive: boolean;
  readonly createdAt: string;
}

/** Drops undefined/empty entries so a blank filter doesn't become `?status=`. */
function qs(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text === '' ? '' : `?${text}`;
}

// ───────── Tickets (R7) ─────────

export function useTicketsList(query: {
  status?: string;
  ticketType?: string;
  sellerId?: string;
  page?: number;
  pageSize?: number;
}): UseQueryResult<Paginated<TicketView>> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-tickets', 'list', query],
    queryFn: () =>
      client.request<Paginated<TicketView>>(`/admin/tickets${qs(query)}`),
  });
}

export function useTicketEvents(
  ticketId: string | null,
): UseQueryResult<readonly TicketEventView[]> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-tickets', 'events', ticketId],
    enabled: ticketId !== null,
    queryFn: () =>
      client.request<readonly TicketEventView[]>(
        `/admin/tickets/${ticketId ?? ''}/events`,
      ),
  });
}

export function useTransitionTicket(): UseMutationResult<
  TicketView,
  Error,
  { ticketId: string; to: string; notes?: string; refundAmountInr?: string }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ticketId, ...body }) =>
      client.request<TicketView>(`/admin/tickets/${ticketId}`, {
        method: 'PATCH',
        body,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-tickets'] });
      // A RESOLVED_REFUND credits the seller's wallet in the same tx,
      // so any ledger view on screen is stale the moment this returns.
      void qc.invalidateQueries({ queryKey: ['admin-wallet'] });
    },
  });
}

// ───────── Inbound freight (R3) ─────────

export function useFreightList(query: {
  sellerId?: string;
  status?: string;
}): UseQueryResult<readonly FreightChargeView[]> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-freight', 'list', query],
    queryFn: () =>
      client.request<readonly FreightChargeView[]>(
        `/admin/inbound-freight${qs(query)}`,
      ),
  });
}

export function useRecordFreight(): UseMutationResult<
  FreightChargeView,
  Error,
  { goodsReceiptId: string; amountInr: string; mode?: string; note?: string }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<FreightChargeView>('/admin/inbound-freight', {
        method: 'POST',
        body,
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-freight'] }),
  });
}

export function useSettleFreight(): UseMutationResult<
  FreightChargeView,
  Error,
  { freightChargeId: string }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ freightChargeId }) =>
      client.request<FreightChargeView>(
        `/admin/inbound-freight/${freightChargeId}/settle`,
        { method: 'POST' },
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-freight'] }),
  });
}

export function useWaiveFreight(): UseMutationResult<
  FreightChargeView,
  Error,
  { freightChargeId: string; reason: string }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ freightChargeId, reason }) =>
      client.request<FreightChargeView>(
        `/admin/inbound-freight/${freightChargeId}/waive`,
        { method: 'POST', body: { reason } },
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-freight'] }),
  });
}

// ───────── Courier settlements (R2c) ─────────

export function useSettlementsList(query: {
  courierAccountId?: string;
  limit?: number;
}): UseQueryResult<readonly SettlementView[]> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-settlements', 'list', query],
    queryFn: () =>
      client.request<readonly SettlementView[]>(
        `/admin/courier-settlements${qs(query)}`,
      ),
  });
}

export function useReconciliation(
  overdueAfterDays?: number,
): UseQueryResult<ReconciliationReport> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-settlements', 'reconciliation', overdueAfterDays],
    queryFn: () =>
      client.request<ReconciliationReport>(
        `/admin/courier-settlements/reconciliation${qs({ overdueAfterDays })}`,
      ),
  });
}

export function useRecordSettlement(): UseMutationResult<
  SettlementView,
  Error,
  {
    courierAccountId: string;
    reference: string;
    amountInr: string;
    receivedAt: string;
    lines: ReadonlyArray<{ orderId: string; settledInr: string }>;
    note?: string;
  }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<SettlementView>('/admin/courier-settlements', {
        method: 'POST',
        body,
      }),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['admin-settlements'] }),
  });
}

// ───────── Withdrawals (R2) ─────────

export function useWithdrawalsList(query: {
  sellerId?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}): UseQueryResult<Paginated<WithdrawalRequestView>> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-withdrawals', 'list', query],
    queryFn: () =>
      client.request<Paginated<WithdrawalRequestView>>(
        `/admin/withdrawal-requests${qs(query)}`,
      ),
  });
}

export function useRejectWithdrawal(): UseMutationResult<
  WithdrawalRequestView,
  Error,
  { requestId: string; reason: string }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ requestId, reason }) =>
      client.request<WithdrawalRequestView>(
        `/admin/withdrawal-requests/${requestId}/reject`,
        { method: 'PATCH', body: { reason } },
      ),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['admin-withdrawals'] }),
  });
}

export function useMarkWithdrawalPaid(): UseMutationResult<
  WithdrawalRequestView,
  Error,
  { requestId: string; linkedRemittanceId: string }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ requestId, linkedRemittanceId }) =>
      client.request<WithdrawalRequestView>(
        `/admin/withdrawal-requests/${requestId}/paid`,
        { method: 'PATCH', body: { linkedRemittanceId } },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-withdrawals'] });
      void qc.invalidateQueries({ queryKey: ['admin-remittances'] });
    },
  });
}

// ───────── Courier accounts (R1) ─────────

export function useCourierAccounts(query?: {
  courierCode?: string;
  environment?: string;
}): UseQueryResult<readonly CourierAccountView[]> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-courier-accounts', 'list', query ?? {}],
    queryFn: () =>
      client.request<readonly CourierAccountView[]>(
        `/admin/courier-accounts${qs(query ?? {})}`,
      ),
  });
}

export function useCreateCourierAccount(): UseMutationResult<
  CourierAccountView,
  Error,
  {
    courierCode: string;
    environment: string;
    label: string;
    /** Encrypted at rest by the server (CUR-1). Never echoed back in
     *  any response, never cached here — this object exists only for
     *  the duration of the POST. */
    credentialFields: Record<string, string>;
    isDefault?: boolean;
    notes?: string;
  }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<CourierAccountView>('/admin/courier-accounts', {
        method: 'POST',
        body,
      }),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['admin-courier-accounts'] }),
  });
}

export function useUpdateCourierAccount(): UseMutationResult<
  CourierAccountView,
  Error,
  {
    accountId: string;
    label?: string;
    isDefault?: boolean;
    isActive?: boolean;
    notes?: string;
  }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ accountId, ...body }) =>
      client.request<CourierAccountView>(`/admin/courier-accounts/${accountId}`, {
        method: 'PATCH',
        body,
      }),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['admin-courier-accounts'] }),
  });
}

export function useLinkSellerCourierAccount(): UseMutationResult<
  SellerCourierAccountLinkView,
  Error,
  { sellerId: string; courierAccountId: string; distributionWeight?: number }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sellerId, ...body }) =>
      client.request<SellerCourierAccountLinkView>(
        `/admin/sellers/${sellerId}/courier-accounts`,
        { method: 'POST', body },
      ),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['admin-courier-accounts'] }),
  });
}

export function useUpdateSellerCourierLink(): UseMutationResult<
  SellerCourierAccountLinkView,
  Error,
  {
    sellerId: string;
    courierAccountId: string;
    distributionWeight?: number;
    isActive?: boolean;
  }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sellerId, courierAccountId, ...body }) =>
      client.request<SellerCourierAccountLinkView>(
        `/admin/sellers/${sellerId}/courier-accounts/${courierAccountId}`,
        { method: 'PATCH', body },
      ),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['admin-courier-accounts'] }),
  });
}

export function useUnlinkSellerCourierAccount(): UseMutationResult<
  void,
  Error,
  { sellerId: string; courierAccountId: string }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sellerId, courierAccountId }) =>
      client.request<void>(
        `/admin/sellers/${sellerId}/courier-accounts/${courierAccountId}`,
        { method: 'DELETE' },
      ),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['admin-courier-accounts'] }),
  });
}

export function useSellerCourierLinks(
  sellerId: string | null,
): UseQueryResult<readonly SellerCourierAccountLinkView[]> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-courier-accounts', 'links', sellerId],
    enabled: sellerId !== null,
    queryFn: () =>
      client.request<readonly SellerCourierAccountLinkView[]>(
        `/admin/sellers/${sellerId ?? ''}/courier-accounts`,
      ),
  });
}

// ───────── Delhivery ops console (D-phase) ─────────

export interface DelhiveryRateBudgetView {
  readonly endpoint: string;
  readonly budget: number;
  readonly remaining: number;
}

export interface DelhiveryOpsStatusView {
  readonly liveMode: boolean;
  readonly liveWritesEnabled: boolean;
  readonly waybillPool: {
    readonly available: number;
    readonly usableNow: number;
    readonly assigned: number;
    readonly used: number;
    readonly void: number;
  };
  readonly rateBudgets: readonly DelhiveryRateBudgetView[];
}

export function useDelhiveryStatus(): UseQueryResult<DelhiveryOpsStatusView> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-delhivery', 'status'],
    queryFn: () => client.request<DelhiveryOpsStatusView>('/admin/delhivery/status'),
    // Pool depth and rate budget are live operational numbers; a stale
    // reading is worse than none when you are deciding whether to refill.
    refetchInterval: 30_000,
  });
}

export function useRefillWaybillPool(): UseMutationResult<
  { fetched: number; poolAfter: number },
  Error,
  void
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      client.request<{ fetched: number; poolAfter: number }>(
        '/admin/delhivery/waybill-pool/refill',
        { method: 'POST' },
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-delhivery'] }),
  });
}
