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
  AdminCancelOrderRequest,
  ApiClient,
  ComputeOrderChargesResponse,
  ForceMutationRequest,
  ForceMutationResult,
  ListOrdersQuery,
  OrderChargeView,
  ListSellersQuery,
  OrderListResponse,
  OrderView,
  ReleaseReservationsRequest,
  ReleaseReservationsResult,
  SellerInvitationListItem,
  SellerListResponse,
  SystemSettingFull,
  SystemSettingsCategoryGroup,
  TransitionStatusResult,
  UpdateSellerStatusRequest,
  UpdateSellerStatusResponse,
  UpdateSystemSettingRequest,
} from '@skydrop/api-client';

/**
 * Thin TanStack Query wrappers over `ApiClient.request<T>(path)`.
 * Keep the api-client itself feature-agnostic (FE-5); endpoint
 * knowledge lives at the consuming-app boundary.
 *
 * Query-key convention: `[domain, op, ...args]`. Mutations invalidate
 * the appropriate domain prefix on success.
 */

// ───────── Admin sellers / invitations ─────────

export function useSellersList(query: ListSellersQuery): UseQueryResult<SellerListResponse> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-sellers', 'list', query],
    queryFn: () => fetchSellers(client, query),
  });
}

async function fetchSellers(
  client: ApiClient,
  query: ListSellersQuery,
): Promise<SellerListResponse> {
  const sp = new URLSearchParams();
  if (query.status) sp.set('status', query.status);
  if (query.search) sp.set('search', query.search);
  if (query.page) sp.set('page', String(query.page));
  if (query.pageSize) sp.set('pageSize', String(query.pageSize));
  const qs = sp.toString();
  return client.request<SellerListResponse>(`/api/admin/sellers${qs ? `?${qs}` : ''}`);
}

// The detail payload type from /admin/sellers/:id is broad (includes
// addresses + recent audit + notes + onboarding); types live with the
// server. For now we use `unknown` and let the page narrow what it
// renders — the M12 docs commit will tighten this in line with the
// actual API shape via a `SellerDetailView` shared type when warranted.
export interface SellerDetailLite {
  readonly id: string;
  readonly email: string;
  readonly emailDisplay: string;
  readonly companyName: string;
  readonly contactPersonName: string;
  readonly phone: string;
  readonly whatsapp: string | null;
  readonly status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';
  readonly approvedAt: string | null;
  readonly displayCurrency: string;
  readonly displayLanguage: string;
  readonly countryCode: string;
  readonly emailVerifiedAt: string | null;
  readonly createdAt: string;
}

export function useSellerDetail(id: string): UseQueryResult<SellerDetailLite> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-sellers', 'detail', id],
    queryFn: () => client.request<SellerDetailLite>(`/api/admin/sellers/${id}`),
    enabled: Boolean(id),
  });
}

export function useUpdateSellerStatus(
  sellerId: string,
): UseMutationResult<UpdateSellerStatusResponse, Error, UpdateSellerStatusRequest> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<UpdateSellerStatusResponse>(`/api/admin/sellers/${sellerId}/status`, {
        method: 'PATCH',
        body,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-sellers'] });
    },
  });
}

export function useInvitationsList(): UseQueryResult<{
  readonly items: readonly SellerInvitationListItem[];
  readonly total: number;
}> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-invitations', 'list', 'PENDING'],
    queryFn: () =>
      client.request<{
        items: SellerInvitationListItem[];
        total: number;
        // Lowercase: the DTO's @IsIn list is ['pending','used','expired',
        // 'deleted'] — these are derived lifecycle names, not the enum
        // values they look like, and 'PENDING' is a 400.
      }>(`/api/admin/seller-invitations?status=pending`),
  });
}

export function useCreateInvitation(): UseMutationResult<
  SellerInvitationListItem,
  Error,
  { email: string }
> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<SellerInvitationListItem>(`/api/admin/seller-invitations`, {
        method: 'POST',
        body,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-invitations'] });
    },
  });
}

export function useResendInvitation(): UseMutationResult<
  SellerInvitationListItem,
  Error,
  { id: string }
> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id }) =>
      client.request<SellerInvitationListItem>(`/api/admin/seller-invitations/${id}/resend`, {
        method: 'POST',
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-invitations'] });
    },
  });
}

export function useDeleteInvitation(): UseMutationResult<void, Error, { id: string }> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id }) =>
      client.request<void>(`/api/admin/seller-invitations/${id}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-invitations'] });
    },
  });
}

// ───────── Admin orders ─────────

export function useOrdersList(query: ListOrdersQuery): UseQueryResult<OrderListResponse> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-orders', 'list', query],
    queryFn: () => fetchOrders(client, query),
  });
}

async function fetchOrders(client: ApiClient, query: ListOrdersQuery): Promise<OrderListResponse> {
  const sp = new URLSearchParams();
  if (query.status) sp.set('status', query.status);
  if (query.source) sp.set('source', query.source);
  if (query.search) sp.set('search', query.search);
  if (query.sellerId) sp.set('sellerId', query.sellerId);
  if (query.page) sp.set('page', String(query.page));
  if (query.pageSize) sp.set('pageSize', String(query.pageSize));
  const qs = sp.toString();
  return client.request<OrderListResponse>(`/api/admin/orders${qs ? `?${qs}` : ''}`);
}

export function useOrderDetail(id: string): UseQueryResult<OrderView> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-orders', 'detail', id],
    queryFn: () => client.request<OrderView>(`/api/admin/orders/${id}`),
    enabled: Boolean(id),
  });
}

// Admin order events — full timeline (all events, including
// isVisibleToSeller=false ones the seller wouldn't see).
import type { SellerOrderEventView as AdminOrderEventView } from '@skydrop/api-client';

export function useAdminOrderEvents(
  id: string,
): UseQueryResult<ReadonlyArray<AdminOrderEventView>> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-orders', 'events', id],
    queryFn: () =>
      client.request<ReadonlyArray<AdminOrderEventView>>(`/api/admin/orders/${id}/events`),
    enabled: Boolean(id),
  });
}

export function useCancelOrder(
  orderId: string,
): UseMutationResult<TransitionStatusResult, Error, AdminCancelOrderRequest> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<TransitionStatusResult>(`/api/admin/orders/${orderId}/cancel`, {
        method: 'POST',
        body,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-orders'] });
    },
  });
}

export function useForceMutation(
  orderId: string,
): UseMutationResult<ForceMutationResult, Error, ForceMutationRequest> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<ForceMutationResult>(`/api/admin/orders/${orderId}/force-mutation`, {
        method: 'POST',
        body,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-orders'] });
    },
  });
}

export function useReleaseReservations(
  orderId: string,
): UseMutationResult<ReleaseReservationsResult, Error, ReleaseReservationsRequest> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<ReleaseReservationsResult>(
        `/api/admin/orders/${orderId}/release-reservations`,
        { method: 'POST', body },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-orders'] });
    },
  });
}

// ───────── Admin system settings (Module 14) ─────────

export function useSystemSettingsList(): UseQueryResult<readonly SystemSettingsCategoryGroup[]> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-system-settings', 'list'],
    queryFn: () =>
      client.request<readonly SystemSettingsCategoryGroup[]>('/api/admin/system-settings'),
  });
}

export function useSystemSetting(key: string): UseQueryResult<SystemSettingFull> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-system-settings', 'detail', key],
    queryFn: () =>
      client.request<SystemSettingFull>(`/api/admin/system-settings/${encodeURIComponent(key)}`),
    enabled: Boolean(key),
  });
}

export function useUpdateSystemSetting(
  key: string,
): UseMutationResult<SystemSettingFull, Error, UpdateSystemSettingRequest> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<SystemSettingFull>(`/api/admin/system-settings/${encodeURIComponent(key)}`, {
        method: 'PATCH',
        body,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-system-settings'] });
    },
  });
}

// ───────── Admin order charges (Module 17) ─────────

export function useOrderCharges(orderId: string): UseQueryResult<readonly OrderChargeView[]> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-order-charges', orderId],
    queryFn: () =>
      client.request<readonly OrderChargeView[]>(`/api/admin/orders/${orderId}/charges`),
    enabled: Boolean(orderId),
  });
}

export function useComputeOrderCharges(
  orderId: string,
): UseMutationResult<ComputeOrderChargesResponse, Error, void> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      client.request<ComputeOrderChargesResponse>(`/api/admin/orders/${orderId}/charges/compute`, {
        method: 'POST',
        body: {},
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-order-charges', orderId] });
    },
  });
}

// ───────── Admin warehouse-ops (M8 + M9 manual placement / dispatch) ─────────

import type {
  PulledPick,
  StartPickResult,
  RecordPickItemRequest,
  RecordPickItemResult,
  CompletePickResult,
  PulledPack,
  CompletePackResult,
  ListManifestsQuery,
  ListManifestsResponse,
  ManifestDetail,
  CloseManifestResult,
  MoveShipmentRequest,
  MoveShipmentResult,
  ConfirmHandoffResult,
  PlaceManualAwbRequest,
  PlaceManualAwbResult,
  CancelManualPlacementRequest,
  RtoShipmentDetail,
  ReceiveRtoRequest,
  ReceiveRtoResult,
  InspectRtoItemRequest,
  InspectRtoItemResult,
  FinalizeRtoResult,
} from '@skydrop/api-client';

// Pick
export function usePullNextPick(): UseMutationResult<{ pick: PulledPick | null }, Error, void> {
  const client = useApiClient();
  return useMutation({
    mutationFn: () =>
      client.request<{ pick: PulledPick | null }>(`/api/warehouse/picks/next`, {
        method: 'POST',
        body: {},
      }),
  });
}
export function useStartPick(): UseMutationResult<StartPickResult, Error, { shipmentId: string }> {
  const client = useApiClient();
  return useMutation({
    mutationFn: ({ shipmentId }) =>
      client.request<StartPickResult>(`/api/warehouse/picks/${shipmentId}/start`, {
        method: 'POST',
        body: {},
      }),
  });
}
export function useRecordPickItem(): UseMutationResult<
  RecordPickItemResult,
  Error,
  { shipmentId: string } & RecordPickItemRequest
> {
  const client = useApiClient();
  return useMutation({
    mutationFn: ({ shipmentId, ...body }) =>
      client.request<RecordPickItemResult>(`/api/warehouse/picks/${shipmentId}/items`, {
        method: 'POST',
        body,
      }),
  });
}
export function useCompletePick(): UseMutationResult<
  CompletePickResult,
  Error,
  { shipmentId: string }
> {
  const client = useApiClient();
  return useMutation({
    mutationFn: ({ shipmentId }) =>
      client.request<CompletePickResult>(`/api/warehouse/picks/${shipmentId}/complete`, {
        method: 'POST',
        body: {},
      }),
  });
}

// Pack
// ───────── The pack box (scan to open → scan in → scan to close) ─────────

export interface PackBoxLine {
  variantId: string;
  skuCode: string;
  productName: string;
  quantity: number;
}
export interface OpenPackBox {
  packBoxId: string;
  shipmentId: string;
  orderId: string;
  awbNumber: string;
  expiresAt: string;
  expected: PackBoxLine[];
  alreadyOpen: boolean;
}
export interface PackScanResult {
  packBoxId: string;
  variantId: string;
  skuCode: string;
  stockUnitId: string | null;
  scannedCount: number;
  expectedCount: number;
  complete: boolean;
}

export function useOpenPackBox(): UseMutationResult<OpenPackBox, Error, { awbNumber: string }> {
  const client = useApiClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<OpenPackBox>('/api/warehouse/packs/boxes/open', { method: 'POST', body }),
  });
}

export function useScanIntoPackBox(): UseMutationResult<
  PackScanResult,
  Error,
  { packBoxId: string; code: string }
> {
  const client = useApiClient();
  return useMutation({
    mutationFn: ({ packBoxId, code }) =>
      client.request<PackScanResult>(`/api/warehouse/packs/boxes/${packBoxId}/scan`, {
        method: 'POST',
        body: { code },
      }),
  });
}

export function useClosePackBox(): UseMutationResult<
  CompletePackResult,
  Error,
  { packBoxId: string; awbNumber: string }
> {
  const client = useApiClient();
  return useMutation({
    mutationFn: ({ packBoxId, awbNumber }) =>
      client.request<CompletePackResult>(`/api/warehouse/packs/boxes/${packBoxId}/close`, {
        method: 'POST',
        body: { awbNumber },
      }),
  });
}

export function useCancelPackBox(): UseMutationResult<
  { packBoxId: string; releasedScans: number },
  Error,
  { packBoxId: string; reason: string }
> {
  const client = useApiClient();
  return useMutation({
    mutationFn: ({ packBoxId, reason }) =>
      client.request<{ packBoxId: string; releasedScans: number }>(
        `/api/warehouse/packs/boxes/${packBoxId}/cancel`,
        { method: 'POST', body: { reason } },
      ),
  });
}

export function usePullNextPack(): UseMutationResult<{ pack: PulledPack | null }, Error, void> {
  const client = useApiClient();
  return useMutation({
    mutationFn: () =>
      client.request<{ pack: PulledPack | null }>(`/api/warehouse/packs/next`, {
        method: 'POST',
        body: {},
      }),
  });
}
export function useCompletePack(): UseMutationResult<
  CompletePackResult,
  Error,
  { shipmentId: string }
> {
  const client = useApiClient();
  return useMutation({
    mutationFn: ({ shipmentId }) =>
      client.request<CompletePackResult>(`/api/warehouse/packs/${shipmentId}/complete`, {
        method: 'POST',
        body: {},
      }),
  });
}

// Manifest
export function useManifestsList(query: ListManifestsQuery): UseQueryResult<ListManifestsResponse> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-manifests', 'list', query],
    queryFn: () => {
      const sp = new URLSearchParams();
      if (query.status) sp.set('status', query.status);
      if (query.courierCode) sp.set('courierCode', query.courierCode);
      if (query.warehouseId) sp.set('warehouseId', query.warehouseId);
      if (query.page) sp.set('page', String(query.page));
      if (query.pageSize) sp.set('pageSize', String(query.pageSize));
      const qs = sp.toString();
      return client.request<ListManifestsResponse>(
        `/api/admin/warehouse/manifests${qs ? `?${qs}` : ''}`,
      );
    },
  });
}
export function useManifestDetail(id: string): UseQueryResult<ManifestDetail> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-manifests', 'detail', id],
    queryFn: () => client.request<ManifestDetail>(`/api/admin/warehouse/manifests/${id}`),
    enabled: Boolean(id),
  });
}
export function useCloseManifest(): UseMutationResult<
  CloseManifestResult,
  Error,
  { manifestId: string }
> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ manifestId }) =>
      client.request<CloseManifestResult>(`/api/admin/warehouse/manifests/${manifestId}/close`, {
        method: 'POST',
        body: {},
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-manifests'] });
    },
  });
}
export function useMoveShipment(): UseMutationResult<
  MoveShipmentResult,
  Error,
  { shipmentId: string } & MoveShipmentRequest
> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ shipmentId, ...body }) =>
      client.request<MoveShipmentResult>(
        `/api/admin/warehouse/shipments/${shipmentId}/move-manifest`,
        { method: 'POST', body },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-manifests'] });
    },
  });
}

// Dispatch
export function useConfirmHandoff(): UseMutationResult<
  ConfirmHandoffResult,
  Error,
  { manifestId: string }
> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ manifestId }) =>
      client.request<ConfirmHandoffResult>(
        `/api/admin/courier/manifests/${manifestId}/confirm-handoff`,
        { method: 'POST', body: {} },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-manifests'] });
    },
  });
}

// Manual placement
export function usePlaceManualAwb(): UseMutationResult<
  PlaceManualAwbResult,
  Error,
  { shipmentId: string } & PlaceManualAwbRequest
> {
  const client = useApiClient();
  return useMutation({
    mutationFn: ({ shipmentId, ...body }) =>
      client.request<PlaceManualAwbResult>(
        `/api/admin/courier/manual-placement/shipments/${shipmentId}/place-awb`,
        { method: 'POST', body },
      ),
  });
}
export function useCancelManualPlacement(): UseMutationResult<
  void,
  Error,
  { shipmentId: string } & CancelManualPlacementRequest
> {
  const client = useApiClient();
  return useMutation({
    mutationFn: ({ shipmentId, ...body }) =>
      client.request<void>(`/api/admin/courier/manual-placement/shipments/${shipmentId}/cancel`, {
        method: 'POST',
        body,
      }),
  });
}

// RTO
export function useReceiveRto(): UseMutationResult<ReceiveRtoResult, Error, ReceiveRtoRequest> {
  const client = useApiClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<ReceiveRtoResult>(`/api/warehouse/rto/receive`, {
        method: 'POST',
        body,
      }),
  });
}
export function useInspectRtoItem(): UseMutationResult<
  InspectRtoItemResult,
  Error,
  { shipmentItemId: string } & InspectRtoItemRequest
> {
  const client = useApiClient();
  return useMutation({
    mutationFn: ({ shipmentItemId, ...body }) =>
      client.request<InspectRtoItemResult>(`/api/warehouse/rto/items/${shipmentItemId}/inspect`, {
        method: 'POST',
        body,
      }),
  });
}
export function useFinalizeRto(): UseMutationResult<
  FinalizeRtoResult,
  Error,
  { shipmentId: string }
> {
  const client = useApiClient();
  return useMutation({
    mutationFn: ({ shipmentId }) =>
      client.request<FinalizeRtoResult>(`/api/warehouse/rto/shipments/${shipmentId}/finalize`, {
        method: 'POST',
        body: {},
      }),
  });
}

export function useRtoShipmentDetail(shipmentId: string | null): UseQueryResult<RtoShipmentDetail> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-rto', 'shipment', shipmentId],
    queryFn: () => client.request<RtoShipmentDetail>(`/api/warehouse/rto/shipments/${shipmentId}`),
    enabled: Boolean(shipmentId),
  });
}

// ───────── Admin call-center (CC-1 / CC-3 / CC-4) ─────────

import type {
  PulledAssignment,
  RecordAttemptRequest,
  RecordAttemptResult,
} from '@skydrop/api-client';

export function usePullNextCall(): UseMutationResult<
  { assignment: PulledAssignment | null },
  Error,
  void
> {
  const client = useApiClient();
  return useMutation({
    mutationFn: () =>
      client.request<{ assignment: PulledAssignment | null }>(`/api/agent/calls/next`, {
        method: 'POST',
        body: {},
      }),
  });
}

export function useCurrentCalls(): UseQueryResult<{
  readonly assignments: ReadonlyArray<PulledAssignment>;
}> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['agent-calls', 'current'],
    queryFn: () =>
      client.request<{ assignments: ReadonlyArray<PulledAssignment> }>(`/api/agent/calls/current`),
  });
}

export function useRecordCallAttempt(): UseMutationResult<
  RecordAttemptResult,
  Error,
  { assignmentId: string } & RecordAttemptRequest
> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ assignmentId, ...body }) =>
      client.request<RecordAttemptResult>(`/api/agent/calls/${assignmentId}/record-attempt`, {
        method: 'POST',
        body,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['agent-calls'] });
    },
  });
}

export function useReleaseCall(): UseMutationResult<
  { released: boolean },
  Error,
  { assignmentId: string }
> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ assignmentId }) =>
      client.request<{ released: boolean }>(`/api/agent/calls/${assignmentId}/release`, {
        method: 'POST',
        body: {},
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['agent-calls'] });
    },
  });
}

export interface AdminShipmentRow {
  readonly id: string;
  readonly shipmentNumber: string;
  readonly status: string;
  readonly awbNumber: string | null;
  readonly courierCode: string;
  readonly isManualCourier: boolean;
  readonly createdAt: string;
  readonly supersedesShipmentId: string | null;
}

export function useAdminOrderShipments(
  id: string,
): UseQueryResult<ReadonlyArray<AdminShipmentRow>> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-orders', 'shipments', id],
    queryFn: () =>
      client.request<ReadonlyArray<AdminShipmentRow>>(`/api/admin/orders/${id}/shipments`),
    enabled: Boolean(id),
  });
}

// ───────── Admin goods-receipts ─────────

import type {
  AdminGoodsReceiptListResponse,
  GoodsReceiptView,
  ListAdminGoodsReceiptsQuery,
  RecordReceiptLineInput,
} from '@skydrop/api-client';

export function useGoodsReceiptsList(
  query: ListAdminGoodsReceiptsQuery,
): UseQueryResult<AdminGoodsReceiptListResponse> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-goods-receipts', 'list', query],
    queryFn: () => {
      const sp = new URLSearchParams();
      if (query.sellerId) sp.set('sellerId', query.sellerId);
      if (query.warehouseId) sp.set('warehouseId', query.warehouseId);
      if (query.status) sp.set('status', query.status);
      if (query.page) sp.set('page', String(query.page));
      if (query.pageSize) sp.set('pageSize', String(query.pageSize));
      const qs = sp.toString();
      return client.request<AdminGoodsReceiptListResponse>(
        `/api/admin/goods-receipts${qs ? `?${qs}` : ''}`,
      );
    },
  });
}

export function useGoodsReceiptDetail(id: string): UseQueryResult<GoodsReceiptView> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-goods-receipts', 'detail', id],
    queryFn: () => client.request<GoodsReceiptView>(`/api/admin/goods-receipts/${id}`),
    enabled: Boolean(id),
  });
}

export function useStartReceiving(): UseMutationResult<GoodsReceiptView, Error, { id: string }> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id }) =>
      client.request<GoodsReceiptView>(`/api/admin/goods-receipts/${id}/start-receiving`, {
        method: 'POST',
        body: {},
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-goods-receipts'] });
    },
  });
}

export function useRecordReceiptLines(): UseMutationResult<
  GoodsReceiptView,
  Error,
  { id: string; lines: ReadonlyArray<RecordReceiptLineInput> }
> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, lines }) =>
      client.request<GoodsReceiptView>(`/api/admin/goods-receipts/${id}/lines`, {
        method: 'POST',
        body: { lines },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-goods-receipts'] });
    },
  });
}

export function useCompleteGoodsReceipt(): UseMutationResult<
  GoodsReceiptView,
  Error,
  { id: string }
> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id }) =>
      client.request<GoodsReceiptView>(`/api/admin/goods-receipts/${id}/complete`, {
        method: 'POST',
        body: {},
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-goods-receipts'] });
    },
  });
}

// Warehouse bins for a putaway-bin picker
export interface WarehouseBin {
  readonly id: string;
  readonly code: string;
  readonly type: string;
  readonly zoneId: string;
}

export function useWarehouseBins(warehouseId: string): UseQueryResult<ReadonlyArray<WarehouseBin>> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-warehouses', 'bins', warehouseId],
    queryFn: () =>
      client.request<ReadonlyArray<WarehouseBin>>(`/api/admin/warehouses/${warehouseId}/bins`),
    enabled: Boolean(warehouseId),
  });
}

// ───────── Admin: categories ─────────

import type {
  CategoryView,
  CategoryTreeNode,
  CreateCategoryRequest,
  UpdateCategoryRequest,
  MoveCategoryRequest,
} from '@skydrop/api-client';

export function useCategoriesList(): UseQueryResult<ReadonlyArray<CategoryView>> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-categories', 'list'],
    queryFn: () => client.request<ReadonlyArray<CategoryView>>(`/api/admin/categories`),
  });
}

export function useCategoryTree(): UseQueryResult<ReadonlyArray<CategoryTreeNode>> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-categories', 'tree'],
    queryFn: () => client.request<ReadonlyArray<CategoryTreeNode>>(`/api/admin/categories/tree`),
  });
}

export function useCreateCategory(): UseMutationResult<CategoryView, Error, CreateCategoryRequest> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<CategoryView>(`/api/admin/categories`, {
        method: 'POST',
        body,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-categories'] });
    },
  });
}

export function useUpdateCategory(): UseMutationResult<
  CategoryView,
  Error,
  { id: string; body: UpdateCategoryRequest }
> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }) =>
      client.request<CategoryView>(`/api/admin/categories/${id}`, {
        method: 'PATCH',
        body,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-categories'] });
    },
  });
}

export function useMoveCategory(): UseMutationResult<
  CategoryView,
  Error,
  { id: string; body: MoveCategoryRequest }
> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }) =>
      client.request<CategoryView>(`/api/admin/categories/${id}/move`, {
        method: 'PATCH',
        body,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-categories'] });
    },
  });
}

export function useDeleteCategory(): UseMutationResult<void, Error, string> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id) => {
      await client.request<void>(`/api/admin/categories/${id}`, {
        method: 'DELETE',
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-categories'] });
    },
  });
}

// ───────── Admin: remittances (Phase 1B M23) ─────────

import type { RemittanceListResponse, CreateRemittanceRequest } from '@skydrop/api-client';

export function useRemittancesList(query?: {
  sellerId?: string;
  page?: number;
  pageSize?: number;
}): UseQueryResult<RemittanceListResponse> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-remittances', 'list', query ?? {}],
    queryFn: () => {
      const sp = new URLSearchParams();
      if (query?.sellerId) sp.set('sellerId', query.sellerId);
      if (query?.page) sp.set('page', String(query.page));
      if (query?.pageSize) sp.set('pageSize', String(query.pageSize));
      const qs = sp.toString();
      return client.request<RemittanceListResponse>(`/api/admin/remittances${qs ? `?${qs}` : ''}`);
    },
  });
}

export function useCreateRemittance(): UseMutationResult<
  { id: string },
  Error,
  CreateRemittanceRequest
> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<{ id: string }>('/api/admin/remittances', {
        method: 'POST',
        body,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-remittances'] });
      void queryClient.invalidateQueries({ queryKey: ['admin-sellers'] });
    },
  });
}

/** Read-only view of any seller's wallet balance for the remittance form
 *  (uses the admin /admin/sellers/:id/wallet endpoint when it lands; for
 *  now we approximate by reading seller list + leaving balance fetch as a
 *  TODO when the admin-side wallet read endpoint is added). */

// ───────── Admin: reports / ops dashboard (#3) ─────────

import type { ReportSummary } from '@skydrop/api-client';

export function useReportSummary(query?: {
  from?: string;
  to?: string;
}): UseQueryResult<ReportSummary> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-reports', 'summary', query ?? {}],
    queryFn: () => {
      const sp = new URLSearchParams();
      if (query?.from) sp.set('from', query.from);
      if (query?.to) sp.set('to', query.to);
      const qs = sp.toString();
      return client.request<ReportSummary>(`/api/admin/reports/summary${qs ? `?${qs}` : ''}`);
    },
  });
}

// ───────── Admin: webhook deliveries (bundle #4) ─────────

import type { WebhookDeliveryListResponse } from '@skydrop/api-client';

export function useWebhookDeliveriesList(query?: {
  sellerId?: string;
  endpointId?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}): UseQueryResult<WebhookDeliveryListResponse> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-webhook-deliveries', 'list', query ?? {}],
    queryFn: () => {
      const sp = new URLSearchParams();
      if (query?.sellerId) sp.set('sellerId', query.sellerId);
      if (query?.endpointId) sp.set('endpointId', query.endpointId);
      if (query?.status) sp.set('status', query.status);
      if (query?.page) sp.set('page', String(query.page));
      if (query?.pageSize) sp.set('pageSize', String(query.pageSize));
      const qs = sp.toString();
      return client.request<WebhookDeliveryListResponse>(
        `/api/admin/webhook-deliveries${qs ? `?${qs}` : ''}`,
      );
    },
  });
}

// ───────── Admin: webhook retry + bank reveal (bundle followup) ─────────

import type {
  RetryWebhookDeliveryResponse,
  RevealBankAccountRequest,
  RevealBankAccountResponse,
} from '@skydrop/api-client';

export function useRetryWebhookDelivery(): UseMutationResult<
  RetryWebhookDeliveryResponse,
  Error,
  { id: string }
> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id }) =>
      client.request<RetryWebhookDeliveryResponse>(`/api/admin/webhook-deliveries/${id}/retry`, {
        method: 'POST',
        body: {},
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['admin-webhook-deliveries'],
      });
    },
  });
}

export function useRevealBankAccount(
  sellerId: string,
): UseMutationResult<RevealBankAccountResponse, Error, RevealBankAccountRequest> {
  const client = useApiClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<RevealBankAccountResponse>(
        `/api/admin/sellers/${sellerId}/bank-account/reveal`,
        { method: 'POST', body },
      ),
    // No invalidation — this is a transient reveal, not a state mutation.
  });
}

// ───────── Admin: FX rates + history ─────────

import type { FxRateView, SetFxRateRequest, FxRateHistoryRow } from '@skydrop/api-client';

export function useFxRatesList(): UseQueryResult<ReadonlyArray<FxRateView>> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-fx', 'list'],
    queryFn: () => client.request<ReadonlyArray<FxRateView>>('/api/admin/fx-rates'),
  });
}

export function useSetFxRate(): UseMutationResult<FxRateView, Error, SetFxRateRequest> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<FxRateView>('/api/admin/fx-rates', {
        method: 'PATCH',
        body,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-fx'] });
    },
  });
}

export function useFxRateHistory(
  from: string,
  to: string,
): UseQueryResult<ReadonlyArray<FxRateHistoryRow>> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-fx', 'history', from, to],
    queryFn: () =>
      client.request<ReadonlyArray<FxRateHistoryRow>>(`/api/admin/fx-rates/history/${from}/${to}`),
    enabled: Boolean(from && to),
  });
}

// ───────── Admin: seller wallet balance (for the remittance form) ─────────

export function useSellerWalletBalance(
  sellerId: string,
): UseQueryResult<{ balances: Array<{ currency: string; balance: string }> }> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-remittance', 'seller-balance', sellerId],
    queryFn: () =>
      client.request<{ balances: Array<{ currency: string; balance: string }> }>(
        `/api/admin/remittances/seller/${sellerId}/balance`,
      ),
    enabled: Boolean(sellerId),
  });
}

// ───────── Admin: staff invitations + users ─────────

import type {
  StaffInvitationListItem,
  CreatedStaffInvitation,
  CreateStaffInvitationRequest,
  StaffUserRow,
} from '@skydrop/api-client';

export function useStaffInvitationsList(): UseQueryResult<{
  items: StaffInvitationListItem[];
  total: number;
}> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-staff', 'invitations'],
    queryFn: () =>
      client.request<{ items: StaffInvitationListItem[]; total: number }>(
        '/api/admin/staff/invitations',
      ),
  });
}

export function useCreateStaffInvitation(): UseMutationResult<
  CreatedStaffInvitation,
  Error,
  CreateStaffInvitationRequest
> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<CreatedStaffInvitation>('/api/admin/staff/invitations', {
        method: 'POST',
        body,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-staff'] });
    },
  });
}

export function useResendStaffInvitation(): UseMutationResult<
  CreatedStaffInvitation,
  Error,
  { id: string }
> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id }) =>
      client.request<CreatedStaffInvitation>(`/api/admin/staff/invitations/${id}/resend`, {
        method: 'POST',
        body: {},
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-staff'] });
    },
  });
}

export function useRevokeStaffInvitation(): UseMutationResult<void, Error, { id: string }> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }) => {
      await client.request<void>(`/api/admin/staff/invitations/${id}`, {
        method: 'DELETE',
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-staff'] });
    },
  });
}

export function useStaffUsersList(): UseQueryResult<StaffUserRow[]> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-staff', 'users'],
    queryFn: () => client.request<StaffUserRow[]>('/api/admin/staff/users'),
  });
}

export function useUpdateStaffRole(): UseMutationResult<
  { id: string; role: string },
  Error,
  { id: string; role: string }
> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, role }) =>
      client.request<{ id: string; role: string }>(`/api/admin/staff/users/${id}/role`, {
        method: 'PATCH',
        body: { role },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-staff'] });
    },
  });
}

export function useDeactivateStaffUser(): UseMutationResult<void, Error, { id: string }> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }) => {
      await client.request<void>(`/api/admin/staff/users/${id}`, {
        method: 'DELETE',
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-staff'] });
    },
  });
}
