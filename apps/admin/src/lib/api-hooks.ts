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
  CancelConsignmentResult,
  ComputeOrderChargesResponse,
  ConsignmentEventView,
  ConsignmentListResult,
  ConsignmentView,
  DispatchResult,
  DispatchToIndiaBody,
  LabelPreview,
  LabelSheet,
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
import type { ConsignmentRoute, ConsignmentStatus, LabellingSite } from '@skydrop/db';
import { usePermission } from './use-permission';

/**
 * Thin TanStack Query wrappers over `ApiClient.request<T>(path)`.
 * Keep the api-client itself feature-agnostic (FE-5); endpoint
 * knowledge lives at the consuming-app boundary.
 *
 * Query-key convention: `[domain, op, ...args]`. Mutations invalidate
 * the appropriate domain prefix on success.
 */

// ───────── Admin sellers / invitations ─────────

/** Self-gating — see the note on `useWarehouseOptions`. */
export function useSellersList(query: ListSellersQuery): UseQueryResult<SellerListResponse> {
  const client = useApiClient();
  const canRead = usePermission('sellers.view');
  return useQuery({
    enabled: canRead,
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
  /** Operations short code — staff-visible only. See the rename hook below. */
  readonly initials: string | null;
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

/**
 * Rename a seller's operations short code.
 *
 * There is deliberately no seller-side equivalent: the code is written on
 * totes and read down manifests, so a seller renaming it would invalidate
 * paperwork that already exists. The server refuses a duplicate with
 * INITIALS_TAKEN, surfaced verbatim per FE-2.
 */
export function useUpdateSellerInitials(
  id: string,
): UseMutationResult<{ sellerId: string; initials: string }, Error, string> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (initials: string) =>
      client.request<{ sellerId: string; initials: string }>(`/api/admin/sellers/${id}/initials`, {
        method: 'PATCH',
        body: { initials },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-sellers'] }),
  });
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

export interface UpdateSellerIdentityRequest {
  /** 2..120. Omit to leave unchanged. */
  readonly companyName?: string;
  /** E.164 BD — /^\+880\d{9,12}$/. Omit to leave unchanged. */
  readonly phone?: string;
  /** REQUIRED, 20..500. The only record of WHY the identity changed. */
  readonly reason: string;
}

export interface UpdateSellerIdentityResponse {
  readonly sellerId: string;
  readonly companyName: string;
  readonly phone: string;
}

/**
 * Correct the company name / phone a seller was APPROVED under.
 *
 * The seller cannot edit either field themselves — they are the identity
 * an admin approved, and a seller quietly rewriting them turns the
 * approved entity into a different one. That left "we approved a typo"
 * with no answer; this is the answer.
 *
 * FE-2: nothing here is pre-checked. Whether the phone is a valid BD
 * number, whether the reason is long enough, whether anything actually
 * CHANGED (IDENTITY_NO_CHANGES) — all of it is the server's call, and
 * its refusal is shown verbatim. A client-side mirror of those rules
 * would go stale the first time one of them moved.
 */
export function useUpdateSellerIdentity(
  sellerId: string,
): UseMutationResult<UpdateSellerIdentityResponse, Error, UpdateSellerIdentityRequest> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<UpdateSellerIdentityResponse>(`/api/admin/sellers/${sellerId}/identity`, {
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

/**
 * Any seller invitation for one email, whatever its state.
 *
 * Distinct from `useInvitationsList`, which asks for `status=pending`
 * only — the lead drawer needs to know about a USED one too, because
 * "they already registered" and "nobody has been invited" are different
 * answers and only one of them warrants a button.
 *
 * Self-gating on `sellers.view`: the drawer lives on the leads page,
 * which is gated on `leads.view`.
 */
export function useSellerInvitationFor(
  email: string | null,
): UseQueryResult<SellerInvitationListItem | null> {
  const client = useApiClient();
  const canRead = usePermission('sellers.view');
  return useQuery({
    enabled: canRead && email !== null && email !== '',
    queryKey: ['admin-invitations', 'for-email', email],
    queryFn: async () => {
      const res = await client.request<{ items: SellerInvitationListItem[] }>(
        `/api/admin/seller-invitations?email=${encodeURIComponent(email ?? '')}`,
      );
      // `email` is a `contains` filter server-side, so narrow it here to
      // an exact match — inviting `a@b.com` must not report on
      // `xa@b.com`. Newest first is the server's order.
      const exact = res.items.filter((i) => i.email.toLowerCase() === (email ?? '').toLowerCase());
      return exact[0] ?? null;
    },
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

/**
 * `enabled` exists so a caller who lacks `orders.view` never issues the
 * request. Hiding the result while still asking spends the round trip
 * and leaves a 403 in the server log for something nobody did wrong.
 */
export function useOrdersList(
  query: ListOrdersQuery,
  opts?: { readonly enabled?: boolean },
): UseQueryResult<OrderListResponse> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-orders', 'list', query],
    queryFn: () => fetchOrders(client, query),
    enabled: opts?.enabled ?? true,
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

/**
 * Recovery from the two states an order could enter and never leave.
 *
 * Both matrix edges existed from the start; neither had a driver, so an
 * order that ran out of stock or short-picked could only be cancelled or
 * god-moded. These are ordinary transitions — the state machine still
 * decides, and the saga still runs.
 */
export function useRetryStock(
  orderId: string,
): UseMutationResult<TransitionStatusResult, Error, void> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      client.request<TransitionStatusResult>(`/api/admin/orders/${orderId}/retry-stock`, {
        method: 'POST',
        body: {},
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-orders'] });
      // Succeeding RESERVES stock, so availability moved.
      void queryClient.invalidateQueries({ queryKey: ['admin-inventory'] });
    },
  });
}

export function useReturnToPick(
  orderId: string,
): UseMutationResult<TransitionStatusResult, Error, void> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      client.request<TransitionStatusResult>(`/api/admin/orders/${orderId}/return-to-pick`, {
        method: 'POST',
        body: {},
      }),
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

export function useOrderCharges(
  orderId: string,
  opts?: { readonly enabled?: boolean },
): UseQueryResult<readonly OrderChargeView[]> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-order-charges', orderId],
    queryFn: () =>
      client.request<readonly OrderChargeView[]>(`/api/admin/orders/${orderId}/charges`),
    enabled: (opts?.enabled ?? true) && Boolean(orderId),
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

/**
 * R4 — the mode a warehouse gate will actually enforce on one line.
 *
 * The pick and pack pulls now resolve this per line and hand it over
 * (`inventoryMode` on `PulledPickItem` / `PulledPackItem`), so a station
 * knows a SKU needs serials BEFORE the record is refused for lacking
 * them. Fail-open: the server reports NORMAL when the resolve fails, and
 * the gate re-resolves independently — these fields are display only.
 *
 * Declared here rather than in @skydrop/api-client because the shared
 * package's interfaces predate the field; the intersections below are
 * the local truth until that package catches up.
 */
export type WarehouseInventoryMode = 'NORMAL' | 'STRICT';

export type StrictPulledPickItem = PulledPick['items'][number] & {
  readonly variantId: string;
  readonly inventoryMode: WarehouseInventoryMode;
};

export type StrictPulledPick = Omit<PulledPick, 'items'> & {
  readonly items: ReadonlyArray<StrictPulledPickItem>;
};

// Pick
export function usePullNextPick(): UseMutationResult<
  { pick: StrictPulledPick | null },
  Error,
  void
> {
  const client = useApiClient();
  return useMutation({
    mutationFn: () =>
      client.request<{ pick: StrictPulledPick | null }>(`/api/warehouse/picks/next`, {
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
/**
 * `scannedSerials` matches `RecordPickItemDto.scannedSerials?: string[]`
 * verbatim — the API runs `forbidNonWhitelisted`, so one wrong field
 * name 400s every record. OMIT it on a NORMAL line rather than sending
 * an empty array: the gate only looks at it for a STRICT SKU, and an
 * empty array on every pick is a field the floor learns to ignore.
 */
export type RecordPickItemBody = RecordPickItemRequest & {
  readonly scannedSerials?: readonly string[];
};

export function useRecordPickItem(): UseMutationResult<
  RecordPickItemResult,
  Error,
  { shipmentId: string } & RecordPickItemBody
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
/**
 * `scannedSerials` matches `CompletePackDto.scannedSerials?: string[]`
 * verbatim.
 *
 * The pack gate checks the scanned SET against the parcel's PICKED
 * units, so there is no target count to compute here — the caller sends
 * what was scanned and the server decides. Omitted entirely for a parcel
 * that carries no serialized units.
 */
export function useCompletePack(): UseMutationResult<
  CompletePackResult,
  Error,
  { shipmentId: string; scannedSerials?: readonly string[] }
> {
  const client = useApiClient();
  return useMutation({
    mutationFn: ({ shipmentId, scannedSerials }) =>
      client.request<CompletePackResult>(`/api/warehouse/packs/${shipmentId}/complete`, {
        method: 'POST',
        body: scannedSerials === undefined ? {} : { scannedSerials },
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
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ shipmentId, ...body }) =>
      client.request<PlaceManualAwbResult>(
        `/api/admin/courier/manual-placement/shipments/${shipmentId}/place-awb`,
        { method: 'POST', body },
      ),
    onSuccess: () => {
      // This DISPATCHES the order and takes stock off hand. Leaving the
      // page showing PENDING_MANUAL_PLACEMENT afterwards reads as the
      // action having failed, and invites a second attempt.
      void queryClient.invalidateQueries({ queryKey: ['admin-orders'] });
      void queryClient.invalidateQueries({ queryKey: ['admin-inventory'] });
    },
  });
}
export function useCancelManualPlacement(): UseMutationResult<
  void,
  Error,
  { shipmentId: string } & CancelManualPlacementRequest
> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ shipmentId, ...body }) =>
      client.request<void>(`/api/admin/courier/manual-placement/shipments/${shipmentId}/cancel`, {
        method: 'POST',
        body,
      }),
    onSuccess: () => {
      // Cancelling releases the reservation, so availability moved too.
      void queryClient.invalidateQueries({ queryKey: ['admin-orders'] });
      void queryClient.invalidateQueries({ queryKey: ['admin-inventory'] });
    },
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

/**
 * What is still sitting in a hold bin for a finalised return.
 *
 * Restocked goods land in RTO_HOLD, and availability deliberately
 * ignores hold bins (INV-3) — so until these are shelved they exist,
 * are counted as on-hand, and cannot be sold. This list is how an
 * operator finds them.
 */
export interface RtoPutawayPending {
  readonly shipmentItemId: string;
  readonly variantId: string;
  readonly skuCode: string;
  readonly productName: string;
  readonly quantity: number;
  readonly holdBinId: string;
  readonly holdBinCode: string;
  /** The RECEIVING warehouse — on a cross-warehouse return, not the origin. */
  readonly warehouseId: string;
  readonly suggestedBinId: string | null;
  readonly suggestedBinCode: string | null;
  readonly suggestionReason: 'PICKED_FROM' | 'RECENT_LOCATION' | null;
}

export interface RtoPutawayResult {
  readonly shipmentId: string;
  readonly movedCount: number;
  readonly lines: ReadonlyArray<{
    shipmentItemId: string;
    destBinId: string;
    qty: number;
    transferGroupId: string;
  }>;
}

export function useRtoPutawayPending(
  shipmentId: string | null,
): UseQueryResult<ReadonlyArray<RtoPutawayPending>> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-rto', 'putaway', shipmentId],
    queryFn: () =>
      client.request<ReadonlyArray<RtoPutawayPending>>(
        `/api/warehouse/rto/shipments/${shipmentId}/putaway`,
      ),
    enabled: Boolean(shipmentId),
  });
}

export function useRtoPutaway(): UseMutationResult<
  RtoPutawayResult,
  Error,
  { shipmentId: string; lines: ReadonlyArray<{ shipmentItemId: string; destBinId: string }> }
> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ shipmentId, lines }) =>
      client.request<RtoPutawayResult>(`/api/warehouse/rto/shipments/${shipmentId}/putaway`, {
        method: 'POST',
        body: { lines },
      }),
    onSuccess: () => {
      // The pending list AND the stock the operator just made sellable.
      void queryClient.invalidateQueries({ queryKey: ['admin-rto'] });
      void queryClient.invalidateQueries({ queryKey: ['admin-inventory'] });
    },
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

/**
 * The calling agent's OWN attempts, newest first.
 *
 * Scoped to the caller by the server — an agent sees their own work and
 * nobody else's, which is what makes this safe to put on the station
 * beside the live call rather than behind a supervisor permission.
 *
 * It is the answer to "what did I just tell that customer", asked when
 * the same number comes back around, and to "did that one actually
 * save" after a flaky moment. `callcenter.work` is all it needs, the
 * same permission that lets them take a call at all.
 */
export interface AgentCallHistoryRow {
  readonly attemptId: string;
  readonly orderId: string;
  readonly queueEntryId: string;
  readonly outcome: string;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly durationSeconds: number | null;
  readonly outcomeNotes: string | null;
  readonly rescheduledFor: string | null;
}

export interface AgentCallHistory {
  readonly items: ReadonlyArray<AgentCallHistoryRow>;
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

export function useAgentCallHistory(page: number, pageSize = 10): UseQueryResult<AgentCallHistory> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['agent-calls', 'history', page, pageSize],
    queryFn: () =>
      client.request<AgentCallHistory>(
        `/api/agent/calls/history?page=${page}&pageSize=${pageSize}`,
      ),
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

/**
 * R4 — the DETAIL endpoint carries `inventoryMode` per line
 * (`GoodsReceiptDetailView` on the API side); the LIST deliberately does
 * not, so this type is not `GoodsReceiptView` everywhere.
 */
export type GoodsReceiptDetail = Omit<GoodsReceiptView, 'lines'> & {
  readonly lines: ReadonlyArray<
    GoodsReceiptView['lines'][number] & { readonly inventoryMode: WarehouseInventoryMode }
  >;
};

export function useGoodsReceiptDetail(id: string): UseQueryResult<GoodsReceiptDetail> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-goods-receipts', 'detail', id],
    queryFn: () => client.request<GoodsReceiptDetail>(`/api/admin/goods-receipts/${id}`),
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

/**
 * `serialsByLineId` matches `CompleteGoodsReceiptDto.serialsByLineId?:
 * Record<string, string[]>` verbatim — keyed by GOODS-RECEIPT-LINE id,
 * not variant id.
 *
 * Only consulted for a STRICT line, and a short list is legitimate: a
 * supplier who does not serialize is normal, and the server prints
 * Skydrop serials for whatever was not scanned. Omitted when the receipt
 * has no strict lines.
 */
export function useCompleteGoodsReceipt(): UseMutationResult<
  GoodsReceiptView,
  Error,
  { id: string; serialsByLineId?: Readonly<Record<string, readonly string[]>> }
> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, serialsByLineId }) =>
      client.request<GoodsReceiptView>(`/api/admin/goods-receipts/${id}/complete`, {
        method: 'POST',
        body: serialsByLineId === undefined ? {} : { serialsByLineId },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-goods-receipts'] });
    },
  });
}

// ───────── Admin: who is on the other end of the call ─────────

export interface CustomerOrderSummary {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly status: string;
  readonly placedAt: string;
  readonly valueInr: string | null;
  readonly itemCount: number;
}

export interface CustomerReputation {
  readonly phoneE164: string;
  readonly platform: {
    readonly totalOrders: number;
    readonly delivered: number;
    readonly returned: number;
    readonly refusedOnCall: number;
    readonly returnRatePercent: string | null;
    readonly firstOrderAt: string | null;
    readonly lastOrderAt: string | null;
  };
  readonly yours: {
    readonly totalOrders: number;
    readonly delivered: number;
    readonly returned: number;
    readonly recentOrders: ReadonlyArray<CustomerOrderSummary>;
    readonly openOrders: ReadonlyArray<CustomerOrderSummary>;
  };
  readonly riskLevel: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'BLOCKED';
  readonly riskNotes: string | null;
  readonly customerName: string | null;
}

/**
 * Reached from the ORDER, not a phone number — the agent is looking at
 * an assignment, not typing anything.
 */
/** Self-gating: it reads an order, and the call station is reachable by
 *  a role that may work the queue without being able to read orders. */
export function useOrderCustomerReputation(
  orderId: string | null,
): UseQueryResult<CustomerReputation> {
  const client = useApiClient();
  const canRead = usePermission('orders.view');
  return useQuery({
    queryKey: ['admin-order-customer-reputation', orderId],
    enabled: orderId !== null && canRead,
    staleTime: 60_000,
    queryFn: () =>
      client.request<CustomerReputation>(`/api/admin/orders/${orderId ?? ''}/customer-reputation`),
  });
}

// ───────── Admin: warehouse topology (zones + bins) ─────────

export interface WarehouseBin {
  readonly id: string;
  readonly code: string;
  readonly type: string;
  readonly zoneId: string;
  readonly aisle: string | null;
  readonly rack: string | null;
  readonly shelf: string | null;
}

export interface WarehouseZone {
  readonly id: string;
  readonly warehouseId: string;
  readonly code: string;
  readonly name: string;
  readonly pickOrder: number;
  readonly isActive: boolean;
}

export interface WarehouseSummary {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly status: string;
  readonly countryCode: string;
  readonly timezone: string;
  /** Does this building record WHERE stock sits? Per-warehouse. */
  readonly binTrackingEnabled: boolean;
  /**
   * Can customer orders ship FROM here? False for an intake-only site
   * such as the Bangladesh warehouse: its stock is real and on hand and
   * sellable from nowhere until it reaches India.
   */
  readonly fulfilsOrders: boolean;
}

export function useWarehouses(): UseQueryResult<ReadonlyArray<WarehouseSummary>> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-warehouses', 'list'],
    queryFn: () => client.request<ReadonlyArray<WarehouseSummary>>('/api/admin/warehouses'),
  });
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

export function useWarehouseZones(
  warehouseId: string,
): UseQueryResult<ReadonlyArray<WarehouseZone>> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-warehouses', 'zones', warehouseId],
    queryFn: () =>
      client.request<ReadonlyArray<WarehouseZone>>(`/api/admin/warehouses/${warehouseId}/zones`),
    enabled: Boolean(warehouseId),
  });
}

export function useCreateZone(
  warehouseId: string,
): UseMutationResult<WarehouseZone, Error, { code: string; name: string; pickOrder?: number }> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<WarehouseZone>(`/api/admin/warehouses/${warehouseId}/zones`, {
        method: 'POST',
        body,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-warehouses'] });
    },
  });
}

export interface CreateBinBody {
  readonly zoneId: string;
  readonly type: string;
  readonly aisle: string;
  readonly rack: string;
  readonly shelf: string;
}

export function useCreateBin(
  warehouseId: string,
): UseMutationResult<WarehouseBin, Error, CreateBinBody> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<WarehouseBin>(`/api/admin/warehouses/${warehouseId}/bins`, {
        method: 'POST',
        body,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-warehouses'] });
    },
  });
}

export function useDeleteBin(warehouseId: string): UseMutationResult<void, Error, string> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (binId) => {
      await client.request<void>(`/api/admin/warehouses/${warehouseId}/bins/${binId}`, {
        method: 'DELETE',
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-warehouses'] });
    },
  });
}

export function useSetBinTracking(
  warehouseId: string,
): UseMutationResult<WarehouseSummary, Error, boolean> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (enabled) =>
      client.request<WarehouseSummary>(`/api/admin/warehouses/${warehouseId}/bin-tracking`, {
        method: 'PATCH',
        body: { enabled },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-warehouses'] });
    },
  });
}

export interface CreateWarehouseBody {
  readonly code: string;
  readonly name: string;
  readonly status?: string;
  readonly countryCode?: string;
  readonly timezone?: string;
  /**
   * Settable at CREATE deliberately. Creating an intake site as a
   * fulfilment warehouse and turning the flag off afterwards leaves a
   * window in which its stock is offered to customers.
   */
  readonly fulfilsOrders?: boolean;
}

/**
 * No `code`. It is the natural key `ops.default_warehouse_id` and every
 * manifest refer to, so the update DTO has no such field — and under
 * forbidNonWhitelisted sending it is a 400 on the whole call rather than
 * a silently ignored key.
 */
export interface UpdateWarehouseBody {
  readonly name?: string;
  readonly status?: string;
  readonly countryCode?: string;
  readonly timezone?: string;
  /** Turning this OFF is refused while the warehouse holds active
   *  reservations — those orders are committed to ship from here. */
  readonly fulfilsOrders?: boolean;
}

export function useCreateWarehouse(): UseMutationResult<
  WarehouseSummary,
  Error,
  CreateWarehouseBody
> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<WarehouseSummary>('/api/admin/warehouses', { method: 'POST', body }),
    onSuccess: () => {
      // The prefix covers the list and every per-warehouse zone/bin key —
      // a new building arrives with a MAIN zone and a FLOOR bin already
      // inside it (BIN-1), so those reads are stale too.
      void queryClient.invalidateQueries({ queryKey: ['admin-warehouses'] });
    },
  });
}

export function useUpdateWarehouse(
  warehouseId: string,
): UseMutationResult<WarehouseSummary, Error, UpdateWarehouseBody> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<WarehouseSummary>(`/api/admin/warehouses/${warehouseId}`, {
        method: 'PATCH',
        body,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-warehouses'] });
    },
  });
}

// ───────── Admin: bin operations (re-shelving) ─────────

/**
 * Both bin-ops endpoints answer with this shape. The counts come from the
 * SERVER because a whole-bin move expands contents the caller never
 * enumerated — computing them here would report a number nobody moved.
 */
export interface BinOpsResult {
  readonly warehouseId: string;
  readonly linesMoved: number;
  readonly unitsMoved: number;
}

/**
 * Mirrors `BulkTransferLineDto` exactly. `qty` is `@IsInt`, so it must be
 * a number rather than the form input's string.
 *
 * `batchId` is carried UNCHANGED through the move: a transfer answers
 * where stock is, never what it is.
 */
export interface BulkTransferLineBody {
  readonly sellerId: string;
  readonly variantId: string;
  readonly batchId: string;
  readonly qty: number;
  readonly sourceBinId: string;
  readonly destBinId: string;
}

export function useMoveWholeBin(
  warehouseId: string,
): UseMutationResult<BinOpsResult, Error, { sourceBinId: string; destBinId: string }> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sourceBinId, destBinId }) =>
      client.request<BinOpsResult>(
        `/api/admin/warehouses/${warehouseId}/bin-ops/move-bin/${sourceBinId}`,
        { method: 'POST', body: { destBinId } },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-warehouses'] });
      // The move lands as paired TRANSFER_OUT/TRANSFER_IN movements
      // (BIN-4), so the ledger a reader would check next is stale.
      void queryClient.invalidateQueries({ queryKey: ['admin-movements'] });
    },
  });
}

export function useBulkBinTransfer(
  warehouseId: string,
): UseMutationResult<BinOpsResult, Error, ReadonlyArray<BulkTransferLineBody>> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (lines) =>
      client.request<BinOpsResult>(`/api/admin/warehouses/${warehouseId}/bin-ops/bulk-transfer`, {
        method: 'POST',
        body: { lines },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-warehouses'] });
      void queryClient.invalidateQueries({ queryKey: ['admin-movements'] });
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

export function useReportSummary(
  query?: {
    from?: string;
    to?: string;
  },
  opts?: { readonly enabled?: boolean },
): UseQueryResult<ReportSummary> {
  const client = useApiClient();
  return useQuery({
    enabled: opts?.enabled ?? true,
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

/** Takes a role ROW id, so a role somebody invented can be assigned. */
export function useUpdateStaffRole(): UseMutationResult<
  { id: string; roleId: string; roleName: string },
  Error,
  { id: string; roleId: string }
> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, roleId }) =>
      client.request<{ id: string; roleId: string; roleName: string }>(
        `/api/admin/staff/users/${id}/role`,
        { method: 'PATCH', body: { roleId } },
      ),
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

// ───────── System capacity (live monitor) ─────────

export type CapacityStatus = 'OK' | 'WATCH' | 'WARNING' | 'CRITICAL';

export interface CapacityMetric {
  key: string;
  label: string;
  current: number;
  ceiling: number | null;
  unit: string;
  percent: number | null;
  status: CapacityStatus;
  ceilingSource: 'MEASURED' | 'CONFIGURED' | 'UNKNOWN';
  consequence: string;
  remedy: string;
  detail?: string;
}

export interface CapacityReport {
  generatedAt: string;
  worstStatus: CapacityStatus;
  metrics: CapacityMetric[];
  growth: {
    ordersLast30Days: number;
    ordersPrev30Days: number;
    monthlyGrowthPercent: number | null;
    storageMonthsRemaining: number | null;
  };
  topology: {
    workersEnabledHere: boolean;
    apiInstancesAssumed: number;
    note: string;
  };
}

/**
 * Live capacity. Polled rather than pushed: the numbers move on the
 * scale of minutes, and a websocket for four gauges would be more
 * moving parts than the thing it watches.
 */
export function useCapacityReport(refetchMs: number): UseQueryResult<CapacityReport> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-capacity'],
    queryFn: () => client.request<CapacityReport>('/api/admin/system/capacity'),
    refetchInterval: refetchMs,
    // Keep polling while the tab is backgrounded: this is the page
    // someone leaves open on a second monitor during an incident.
    refetchIntervalInBackground: true,
    staleTime: 0,
  });
}

// ───────── Invite leads (marketing) ─────────

export type InviteLeadStatus =
  | 'NEW'
  | 'CONTACTED'
  | 'QUALIFIED'
  | 'CONVERTED'
  | 'DECLINED'
  | 'SPAM';

export interface InviteLead {
  id: string;
  fullName: string;
  companyName: string;
  email: string;
  phone: string;
  altPhone: string | null;
  shippingDirection: 'BD_TO_IN' | 'IN_TO_BD' | 'BOTH' | null;
  productTypes: string | null;
  monthlyOrders: string | null;
  message: string | null;
  status: InviteLeadStatus;
  notes: string | null;
  submissionCount: number;
  contactedAt: string | null;
  convertedSellerId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InviteLeadPage {
  items: InviteLead[];
  total: number;
  page: number;
  pageSize: number;
  counts: Partial<Record<InviteLeadStatus, number>>;
}

export function useInviteLeads(params: {
  status?: InviteLeadStatus;
  search?: string;
  page?: number;
}): UseQueryResult<InviteLeadPage> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-invite-leads', params],
    queryFn: () => {
      const sp = new URLSearchParams();
      if (params.status) sp.set('status', params.status);
      if (params.search) sp.set('search', params.search);
      if (params.page) sp.set('page', String(params.page));
      const qs = sp.toString();
      return client.request<InviteLeadPage>(`/api/admin/invite-leads${qs ? `?${qs}` : ''}`);
    },
  });
}

export function useUpdateInviteLead(): UseMutationResult<
  InviteLead,
  Error,
  { id: string; status?: InviteLeadStatus; notes?: string }
> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }) =>
      client.request<InviteLead>(`/api/admin/invite-leads/${id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-invite-leads'] });
    },
  });
}

// ───────── Two-leg consignments (docs/consignment-two-leg.md) ─────────

/**
 * The consignment journey — announced, counted at up to two stops,
 * labelled at ONE of them, landed in India.
 *
 * These sit beside the goods-receipt hooks above on purpose: a leg IS a
 * goods receipt, and the counting screens are the same ones. What the
 * consignment adds is everything the receiving station has no opinion
 * about — the route, the labelling station, the dispatch, the cancel.
 *
 * Invalidation is deliberately wide. A dispatch writes stock and creates
 * a receipt; a cancel removes stock and closes a receipt. Invalidating
 * only `admin-consignments` would leave the receive queue and the stock
 * ledger showing a world that no longer exists.
 */
export function useConsignmentsList(
  query: {
    sellerId?: string;
    route?: ConsignmentRoute;
    status?: ConsignmentStatus;
    page?: number;
    pageSize?: number;
  },
  /**
   * Off for a caller whose page does not carry `inventory.view` — the
   * finance side's freight screen borrows this list, and a request nobody
   * may make should never be SENT rather than sent and hidden.
   */
  opts: { readonly enabled?: boolean } = {},
): UseQueryResult<ConsignmentListResult> {
  const client = useApiClient();
  return useQuery({
    enabled: opts.enabled ?? true,
    queryKey: ['admin-consignments', 'list', query],
    queryFn: () => {
      const sp = new URLSearchParams();
      if (query.sellerId) sp.set('sellerId', query.sellerId);
      if (query.route) sp.set('route', query.route);
      if (query.status) sp.set('status', query.status);
      if (query.page) sp.set('page', String(query.page));
      if (query.pageSize) sp.set('pageSize', String(query.pageSize));
      const qs = sp.toString();
      return client.request<ConsignmentListResult>(`/api/admin/consignments${qs ? `?${qs}` : ''}`);
    },
  });
}

export function useConsignmentDetail(id: string): UseQueryResult<ConsignmentView> {
  const client = useApiClient();
  return useQuery({
    enabled: id !== '',
    queryKey: ['admin-consignments', 'detail', id],
    queryFn: () => client.request<ConsignmentView>(`/api/admin/consignments/${id}`),
  });
}

/** The FULL timeline — admin sees events the seller never does. */
export function useConsignmentEvents(id: string): UseQueryResult<readonly ConsignmentEventView[]> {
  const client = useApiClient();
  return useQuery({
    enabled: id !== '',
    queryKey: ['admin-consignments', 'events', id],
    queryFn: () =>
      client.request<readonly ConsignmentEventView[]>(`/api/admin/consignments/${id}/events`),
  });
}

/**
 * What is waiting to be labelled, WITHOUT printing anything.
 *
 * Separate from the print call because printing locks the station
 * permanently — an operator has to be able to see whether there is
 * anything to print before committing to where it happens.
 */
export function useConsignmentLabelPreview(id: string): UseQueryResult<LabelPreview> {
  const client = useApiClient();
  return useQuery({
    enabled: id !== '',
    queryKey: ['admin-consignments', 'label-preview', id],
    queryFn: () => client.request<LabelPreview>(`/api/admin/consignments/${id}/labels`),
  });
}

export function useSetLabellingSite(): UseMutationResult<
  ConsignmentView,
  Error,
  { id: string; site: LabellingSite }
> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, site }) =>
      client.request<ConsignmentView>(`/api/admin/consignments/${id}/labelling-site`, {
        method: 'PATCH',
        body: { site },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-consignments'] });
    },
  });
}

/** Prints AND locks the station. There is no un-print. */
export function usePrintConsignmentLabels(): UseMutationResult<LabelSheet, Error, { id: string }> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id }) =>
      client.request<LabelSheet>(`/api/admin/consignments/${id}/labels/print`, {
        method: 'POST',
        body: {},
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-consignments'] });
    },
  });
}

export function useDispatchConsignment(): UseMutationResult<
  DispatchResult,
  Error,
  { id: string; body: DispatchToIndiaBody }
> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }) =>
      client.request<DispatchResult>(`/api/admin/consignments/${id}/dispatch`, {
        method: 'POST',
        body,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-consignments'] });
      // A dispatch is a stock TRANSFER plus a new India leg — both of
      // those live behind other query keys.
      void queryClient.invalidateQueries({ queryKey: ['admin-goods-receipts'] });
      void queryClient.invalidateQueries({ queryKey: ['admin-inventory'] });
    },
  });
}

export function useCancelConsignment(): UseMutationResult<
  CancelConsignmentResult,
  Error,
  { id: string; reason: string }
> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }) =>
      client.request<CancelConsignmentResult>(`/api/admin/consignments/${id}/cancel`, {
        method: 'POST',
        body: { reason },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-consignments'] });
      void queryClient.invalidateQueries({ queryKey: ['admin-goods-receipts'] });
      // Cancelling REMOVES stock already booked in.
      void queryClient.invalidateQueries({ queryKey: ['admin-inventory'] });
    },
  });
}
