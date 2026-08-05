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
  EarlyReservationReviewStatus,
  Currency,
  InboundFreightMode,
  InboundFreightStatus,
  StockUnitStatus,
  TicketStatus,
  TicketType,
  WithdrawalRequestedBy,
  WithdrawalRequestStatus,
} from '@skydrop/db';
import { usePermission } from './use-permission';

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

export function useTicketsList(
  query: {
    status?: string;
    ticketType?: string;
    sellerId?: string;
    page?: number;
    pageSize?: number;
  },
  opts?: { readonly enabled?: boolean },
): UseQueryResult<Paginated<TicketView>> {
  const client = useApiClient();
  return useQuery({
    enabled: opts?.enabled ?? true,
    queryKey: ['admin-tickets', 'list', query],
    queryFn: () => client.request<Paginated<TicketView>>(`/api/admin/tickets${qs(query)}`),
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
      client.request<readonly TicketEventView[]>(`/api/admin/tickets/${ticketId ?? ''}/events`),
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
      client.request<TicketView>(`/api/admin/tickets/${ticketId}`, {
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
      client.request<readonly FreightChargeView[]>(`/api/admin/inbound-freight${qs(query)}`),
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
      client.request<FreightChargeView>('/api/admin/inbound-freight', {
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
      client.request<FreightChargeView>(`/api/admin/inbound-freight/${freightChargeId}/settle`, {
        method: 'POST',
      }),
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
      client.request<FreightChargeView>(`/api/admin/inbound-freight/${freightChargeId}/waive`, {
        method: 'POST',
        body: { reason },
      }),
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
      client.request<readonly SettlementView[]>(`/api/admin/courier-settlements${qs(query)}`),
  });
}

export function useReconciliation(overdueAfterDays?: number): UseQueryResult<ReconciliationReport> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-settlements', 'reconciliation', overdueAfterDays],
    queryFn: () =>
      client.request<ReconciliationReport>(
        `/api/admin/courier-settlements/reconciliation${qs({ overdueAfterDays })}`,
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
      client.request<SettlementView>('/api/admin/courier-settlements', {
        method: 'POST',
        body,
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-settlements'] }),
  });
}

// ───────── Withdrawals (R2) ─────────

export function useWithdrawalsList(
  query: {
    sellerId?: string;
    status?: string;
    page?: number;
    pageSize?: number;
  },
  opts?: { readonly enabled?: boolean },
): UseQueryResult<Paginated<WithdrawalRequestView>> {
  const client = useApiClient();
  return useQuery({
    enabled: opts?.enabled ?? true,
    queryKey: ['admin-withdrawals', 'list', query],
    queryFn: () =>
      client.request<Paginated<WithdrawalRequestView>>(
        `/api/admin/withdrawal-requests${qs(query)}`,
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
      client.request<WithdrawalRequestView>(`/api/admin/withdrawal-requests/${requestId}/reject`, {
        method: 'PATCH',
        body: { reason },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-withdrawals'] }),
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
      client.request<WithdrawalRequestView>(`/api/admin/withdrawal-requests/${requestId}/paid`, {
        method: 'PATCH',
        body: { linkedRemittanceId },
      }),
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
  const canRead = usePermission('courier.accounts.view');
  return useQuery({
    enabled: canRead,
    queryKey: ['admin-courier-accounts', 'list', query ?? {}],
    queryFn: () =>
      client.request<readonly CourierAccountView[]>(
        `/api/admin/courier-accounts${qs(query ?? {})}`,
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
      client.request<CourierAccountView>('/api/admin/courier-accounts', {
        method: 'POST',
        body,
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-courier-accounts'] }),
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
      client.request<CourierAccountView>(`/api/admin/courier-accounts/${accountId}`, {
        method: 'PATCH',
        body,
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-courier-accounts'] }),
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
        `/api/admin/sellers/${sellerId}/courier-accounts`,
        {
          method: 'POST',
          body,
        },
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-courier-accounts'] }),
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
        `/api/admin/sellers/${sellerId}/courier-accounts/${courierAccountId}`,
        { method: 'PATCH', body },
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-courier-accounts'] }),
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
      client.request<void>(`/api/admin/sellers/${sellerId}/courier-accounts/${courierAccountId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-courier-accounts'] }),
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
        `/api/admin/sellers/${sellerId ?? ''}/courier-accounts`,
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
    queryFn: () => client.request<DelhiveryOpsStatusView>('/api/admin/delhivery/status'),
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
        '/api/admin/delhivery/waybill-pool/refill',
        { method: 'POST' },
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-delhivery'] }),
  });
}

// ───────── Courier ops per shipment (D1–D7 → courier-ops) ─────────

export interface ShipmentInsight {
  readonly shipment: {
    readonly shipmentId: string;
    readonly shipmentNumber: string;
    readonly awbNumber: string | null;
    readonly courierCode: string;
    readonly isManualCourier: boolean;
    readonly originPin: string | null;
    readonly destinationPin: string;
    readonly chargeableWeightGrams: number;
    readonly declaredValueInr: string;
    readonly isCod: boolean;
  };
  readonly tat: {
    readonly tatDays: number | null;
    readonly mode: string;
    readonly fromLiveApi: boolean;
    readonly message: string | null;
  } | null;
  readonly cost: {
    readonly totalInr: string;
    readonly deliveryInr: string;
    readonly codFeeInr: string;
    readonly taxInr: string;
    readonly zone: string | null;
    readonly chargedWeightGrams: number;
    readonly volumetricDivisor: number | null;
    readonly fromLiveApi: boolean;
    readonly components: Readonly<Record<string, string>>;
  } | null;
  readonly unavailable: readonly string[];
}

export interface NdrReadiness {
  readonly eligible: boolean;
  readonly reason: string | null;
  readonly nslCode: string | null;
  readonly attemptCount: number;
}

export interface ActionOutcome {
  readonly success: boolean;
  readonly awbNumber: string;
  readonly message: string | null;
}

export interface NdrOutcome extends ActionOutcome {
  readonly uplId: string | null;
  readonly nslCode: string | null;
  readonly attemptCount: number;
}

const opsBase = (shipmentId: string): string => `/admin/courier-ops/shipments/${shipmentId}`;

export function useShipmentInsight(shipmentId: string | null): UseQueryResult<ShipmentInsight> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['courier-ops', 'insight', shipmentId],
    enabled: shipmentId !== null,
    // A live courier lookup per call; do not re-fire it on every focus.
    staleTime: 5 * 60_000,
    queryFn: () => client.request<ShipmentInsight>(`${opsBase(shipmentId ?? '')}/insight`),
  });
}

export function useNdrReadiness(
  shipmentId: string | null,
  action: 'RE-ATTEMPT' | 'PICKUP_RESCHEDULE' = 'RE-ATTEMPT',
): UseQueryResult<NdrReadiness> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['courier-ops', 'ndr-readiness', shipmentId, action],
    enabled: shipmentId !== null,
    queryFn: () =>
      client.request<NdrReadiness>(
        `${opsBase(shipmentId ?? '')}/ndr-readiness?action=${encodeURIComponent(action)}`,
      ),
  });
}

export function useFetchDocument(): UseMutationResult<
  { url: string | null; message: string | null; docType: string },
  Error,
  { shipmentId: string; docType: string }
> {
  const client = useApiClient();
  return useMutation({
    mutationFn: ({ shipmentId, docType }) =>
      client.request<{ url: string | null; message: string | null; docType: string }>(
        `${opsBase(shipmentId)}/document?docType=${encodeURIComponent(docType)}`,
      ),
  });
}

export function useEditShipment(): UseMutationResult<
  ActionOutcome,
  Error,
  {
    shipmentId: string;
    name?: string;
    phone?: string;
    address?: string;
    productsDesc?: string;
  }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ shipmentId, ...body }) =>
      client.request<ActionOutcome>(`${opsBase(shipmentId)}/edit`, {
        method: 'POST',
        body,
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-orders'] }),
  });
}

export function useCancelWithCourier(): UseMutationResult<
  ActionOutcome,
  Error,
  { shipmentId: string; reason: string }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ shipmentId, reason }) =>
      client.request<ActionOutcome>(`${opsBase(shipmentId)}/cancel`, {
        method: 'POST',
        body: { reason },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-orders'] }),
  });
}

export function useAttachEwaybill(): UseMutationResult<
  ActionOutcome,
  Error,
  { shipmentId: string; invoiceNumber: string; ewaybillNumber: string }
> {
  const client = useApiClient();
  return useMutation({
    mutationFn: ({ shipmentId, ...body }) =>
      client.request<ActionOutcome>(`${opsBase(shipmentId)}/ewaybill`, {
        method: 'POST',
        body,
      }),
  });
}

export function useNdrAction(): UseMutationResult<
  NdrOutcome,
  Error,
  { shipmentId: string; action: 'RE-ATTEMPT' | 'PICKUP_RESCHEDULE' }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ shipmentId, action }) =>
      client.request<NdrOutcome>(`${opsBase(shipmentId)}/ndr-action`, {
        method: 'POST',
        body: { action },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['courier-ops', 'ndr-readiness'] }),
  });
}

// ───────── Pickup requests (D6) ─────────

export interface PickupRequestView {
  readonly id: string;
  readonly courierCode: string;
  readonly warehouseId: string;
  readonly warehouseName: string | null;
  readonly pickupLocationName: string;
  readonly pickupDate: string;
  readonly pickupTime: string;
  readonly expectedPackageCount: number;
  readonly status: 'REQUESTED' | 'FAILED' | 'CLOSED' | 'CANCELLED';
  readonly courierPickupId: string | null;
  readonly courierMessage: string | null;
  readonly createdAt: string;
}

export function usePickupRequests(): UseQueryResult<readonly PickupRequestView[]> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['courier-pickups', 'list'],
    queryFn: () => client.request<readonly PickupRequestView[]>('/api/admin/courier-ops/pickups'),
  });
}

export function useRaisePickup(): UseMutationResult<
  PickupRequestView,
  Error,
  {
    warehouseId: string;
    pickupDate: string;
    pickupTime: string;
    expectedPackageCount: number;
  }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<PickupRequestView>('/api/admin/courier-ops/pickups', {
        method: 'POST',
        body,
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['courier-pickups'] }),
  });
}

export function useClosePickup(): UseMutationResult<
  PickupRequestView,
  Error,
  { requestId: string; status: 'CLOSED' | 'CANCELLED' | 'FAILED' }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ requestId, status }) =>
      client.request<PickupRequestView>(`/api/admin/courier-ops/pickups/${requestId}`, {
        method: 'PATCH',
        body: { status },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['courier-pickups'] }),
  });
}

export function useReleasePickupDay(): UseMutationResult<
  { released: boolean },
  Error,
  { requestId: string; reason: string }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ requestId, reason }) =>
      client.request<{ released: boolean }>(
        `/api/admin/courier-ops/pickups/${requestId}/release-day`,
        {
          method: 'POST',
          body: { reason },
        },
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['courier-pickups'] }),
  });
}

export interface WarehouseOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly status: string;
}

/**
 * SELF-GATING. These three are LOOKUPS — a warehouse picker, a seller
 * picker, a courier-account picker — dropped into pages all over the
 * app, most of which are gated on something else entirely. Asking each
 * of a dozen call sites to remember the permission is how one of them
 * forgets, and the symptom is a 403 on a page that was otherwise fine.
 *
 * So the check lives in the hook. Somebody without the permission gets
 * an empty list and no request, and the dropdown renders with no
 * options — which is the truth: there is nothing here they may choose
 * from. Callers already handle `data === undefined` because that is also
 * the loading state.
 */
export function useWarehouseOptions(): UseQueryResult<readonly WarehouseOption[]> {
  const client = useApiClient();
  const canRead = usePermission('warehouse.view');
  return useQuery({
    enabled: canRead,
    queryKey: ['admin-warehouses', 'options'],
    staleTime: 10 * 60_000,
    queryFn: () => client.request<readonly WarehouseOption[]>('/api/admin/warehouses'),
  });
}

// ───────── Margin report (real courier cost) ─────────

export interface MarginRow {
  readonly shipmentId: string;
  readonly shipmentNumber: string;
  readonly awbNumber: string | null;
  readonly orderId: string | null;
  readonly lane: string;
  readonly billedToSellerInr: string;
  readonly actualCourierCostInr: string;
  readonly marginInr: string;
  readonly marginPercent: string;
  readonly lossMaking: boolean;
  readonly assumedCostInr: string | null;
  readonly assumptionDriftInr: string | null;
}

export interface MarginReport {
  readonly generatedAt: string;
  readonly sampledShipments: number;
  readonly totalBilledInr: string;
  readonly totalActualCostInr: string;
  readonly totalMarginInr: string;
  readonly lossMakingCount: number;
  readonly rows: readonly MarginRow[];
  readonly skipped: readonly { shipmentId: string; reason: string }[];
}

export function useMarginReport(limit: number, enabled: boolean): UseQueryResult<MarginReport> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-margin', 'report', limit],
    // Explicitly opt-in: every row is a live rate-limited courier call,
    // so this must not fire just because a page mounted.
    enabled,
    staleTime: 15 * 60_000,
    queryFn: () =>
      client.request<MarginReport>(`/api/admin/courier-ops/margin-report?limit=${limit}`),
  });
}

// ───────── Serialized-unit discrepancies, admin side (R4) ─────────

export interface SellerDiscrepancySummary {
  readonly sellerId: string;
  readonly companyName: string | null;
  readonly stuckUnits: number;
  readonly unresolvedDispatched: number;
  readonly countMismatches: number;
  readonly needsAttention: number;
  readonly thresholds: {
    readonly stuckSlaHours: number;
    readonly dispatchedUnresolvedDays: number;
  };
}

export interface DiscrepancyTriage {
  readonly generatedAt: string;
  readonly sellers: readonly SellerDiscrepancySummary[];
  readonly totalNeedsAttention: number;
  readonly truncated: boolean;
  readonly examined: number;
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

export function useUnitTriage(): UseQueryResult<DiscrepancyTriage> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-units', 'triage'],
    queryFn: () => client.request<DiscrepancyTriage>('/api/admin/stock-units/triage'),
  });
}

export function useSellerUnitReport(
  sellerId: string | null,
): UseQueryResult<UnitDiscrepancyReport> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-units', 'report', sellerId],
    enabled: sellerId !== null,
    queryFn: () =>
      client.request<UnitDiscrepancyReport>(
        `/api/admin/stock-units/discrepancies/${sellerId ?? ''}`,
      ),
  });
}

// ───────── Held-stock reviews, admin side (R5) ─────────

export interface AdminReviewRow {
  readonly id: string;
  readonly sellerId: string;
  readonly orderId: string;
  readonly status: EarlyReservationReviewStatus;
  readonly attemptCount: number;
  readonly heldQty: number;
  readonly note: string | null;
  readonly resolvedAt: string | null;
  readonly createdAt: string;
}

export function useAdminHoldReviews(query: {
  status?: string;
  sellerId?: string;
}): UseQueryResult<readonly AdminReviewRow[]> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-hold-reviews', 'list', query],
    queryFn: () =>
      client.request<readonly AdminReviewRow[]>(`/api/admin/early-reservation-reviews${qs(query)}`),
  });
}

// ───────── Courier escalation: outbox + write-mode (Phase 3/4) ─────────

export interface OpsQueueItem {
  readonly id: string;
  readonly kind: 'COMMENT' | 'RAISE_TICKET';
  readonly status: 'PENDING' | 'SENDING' | 'SENT_UNCONFIRMED' | 'CONFIRMED' | 'FAILED';
  readonly body: string;
  readonly categoryId: string | null;
  readonly awbNumber: string | null;
  readonly externalTicketId: string | null;
  readonly orderId: string | null;
  readonly sellerId: string | null;
  readonly sellerName: string | null;
  readonly deepLink: string;
  readonly claimedByStaffId: string | null;
  readonly claimExpiresAt: string | null;
  readonly createdAt: string;
  readonly lastError: string | null;
}

export interface OpsQueueCounts {
  readonly pending: number;
  readonly sending: number;
  readonly sentUnconfirmed: number;
  readonly confirmedToday: number;
  readonly failedToday: number;
}

export interface CourierChannelView {
  readonly settings: {
    readonly courierCode: string;
    readonly writeMode: 'MANUAL' | 'SUPERVISED' | 'AUTO';
    readonly autoCategories: readonly string[];
    readonly pausedUntil: string | null;
    readonly pauseReason: string | null;
    readonly effectivelyPaused: boolean;
    readonly updatedAt: string;
  };
  readonly capabilities: Record<string, boolean>;
  readonly lockedCategoryLabels: readonly string[];
  readonly counts: OpsQueueCounts;
}

export function useCourierOutbox(): UseQueryResult<OpsQueueItem[]> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['courier-escalation', 'outbox'],
    queryFn: () => client.request<OpsQueueItem[]>('/api/admin/courier-escalation/outbox'),
    // A claim lease is ten minutes; a stale queue shows work someone
    // else already took.
    refetchInterval: 20_000,
  });
}

export function useCourierChannel(): UseQueryResult<CourierChannelView> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['courier-escalation', 'channel'],
    queryFn: () => client.request<CourierChannelView>('/api/admin/courier-escalation/channel'),
    refetchInterval: 30_000,
  });
}

export function useClaimOutboxItem(): UseMutationResult<OpsQueueItem, Error, string> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) =>
      client.request<OpsQueueItem>(`/api/admin/courier-escalation/outbox/${itemId}/claim`, {
        method: 'POST',
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['courier-escalation'] }),
  });
}

export function useMarkOutboxSent(): UseMutationResult<
  { ok: true },
  Error,
  { itemId: string; externalTicketId?: string }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, externalTicketId }) =>
      client.request<{ ok: true }>(`/api/admin/courier-escalation/outbox/${itemId}/mark-sent`, {
        method: 'POST',
        body: externalTicketId === undefined ? {} : { externalTicketId },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['courier-escalation'] }),
  });
}

export function useReleaseOutboxItem(): UseMutationResult<{ ok: true }, Error, string> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) =>
      client.request<{ ok: true }>(`/api/admin/courier-escalation/outbox/${itemId}/release`, {
        method: 'POST',
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['courier-escalation'] }),
  });
}

export function useRequestModeChange(): UseMutationResult<
  { challengeId: string; expiresAt: string },
  Error,
  { writeMode: string; autoCategories: string[]; reason: string }
> {
  const client = useApiClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<{ challengeId: string; expiresAt: string }>(
        '/api/admin/courier-escalation/channel/mode/request',
        { method: 'POST', body },
      ),
  });
}

export function useConfirmModeChange(): UseMutationResult<
  CourierChannelView['settings'],
  Error,
  { challengeId: string; code: string }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<CourierChannelView['settings']>(
        '/api/admin/courier-escalation/channel/mode/confirm',
        { method: 'POST', body },
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['courier-escalation'] }),
  });
}

export function usePauseCourierChannel(): UseMutationResult<
  CourierChannelView['settings'],
  Error,
  { minutes: number; reason: string }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<CourierChannelView['settings']>(
        '/api/admin/courier-escalation/channel/pause',
        {
          method: 'POST',
          body,
        },
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['courier-escalation'] }),
  });
}

export function useResumeCourierChannel(): UseMutationResult<
  CourierChannelView['settings'],
  Error,
  void
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      client.request<CourierChannelView['settings']>(
        '/api/admin/courier-escalation/channel/resume',
        { method: 'POST' },
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['courier-escalation'] }),
  });
}
