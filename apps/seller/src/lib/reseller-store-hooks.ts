'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useApiClient } from '@skydrop/auth/client';
import type { OrderStatus } from '@skydrop/db';
import type { ResellerStoreStatusValue } from '@skydrop/api-client';

/**
 * A seller's reseller stores (RS-1). Every endpoint here needs
 * `stores.manage` — reads included — and carries the seller id from the
 * token server-side, so no seller id appears in any path.
 */

export type WalletManager = 'SELLER' | 'SKYDROP';
export type StoreRoleKey = 'owner' | 'admin' | 'ops' | 'finance' | 'viewer';

export interface ResellerStoreView {
  readonly id: string;
  readonly sellerId: string;
  readonly sellerCompanyName: string;
  readonly name: string;
  readonly displayName: string | null;
  readonly status: ResellerStoreStatusValue;
  readonly origin: 'SELLER' | 'ADMIN';
  readonly walletManagedBy: WalletManager;
  readonly contactEmail: string | null;
  readonly contactPhone: string | null;
  readonly note: string | null;
  readonly memberCount: number;
  readonly createdAt: string;
  readonly statusChangedAt: string | null;
}

export interface ResellerStoreEventView {
  readonly id: string;
  readonly kind: string;
  readonly fromStatus: ResellerStoreStatusValue | null;
  readonly toStatus: ResellerStoreStatusValue | null;
  readonly actorType: 'STAFF' | 'SELLER' | 'SYSTEM' | 'API' | 'STORE';
  readonly note: string | null;
  readonly createdAt: string;
}

export interface ResellerTeamView {
  readonly members: ReadonlyArray<{
    readonly id: string;
    readonly email: string;
    readonly fullName: string;
    readonly roleName: string;
    readonly lastLoginAt: string | null;
  }>;
  readonly invitations: ReadonlyArray<{
    readonly id: string;
    readonly email: string;
    readonly fullName: string;
    readonly roleName: string;
    readonly expiresAt: string;
  }>;
  readonly roles: ReadonlyArray<{
    readonly key: string;
    readonly name: string;
    readonly description: string | null;
  }>;
}

export interface ResellerStoreDetail extends ResellerStoreView {
  readonly logoUrl: string | null;
  readonly events: readonly ResellerStoreEventView[];
  readonly team: ResellerTeamView;
}

export interface InviteInput {
  readonly email: string;
  readonly fullName: string;
  readonly roleKey: StoreRoleKey;
}

export interface CreateResellerStoreInput {
  readonly name: string;
  readonly displayName?: string | undefined;
  // Required since 2026-09-16 (owner): a store we cannot reach, or that
  // nobody can sign in to, is not onboarded. The server refuses without
  // them; typing them as required means a caller finds out here instead.
  readonly contactEmail: string;
  readonly contactPhone: string;
  readonly walletManagedBy?: WalletManager | undefined;
  readonly note?: string | undefined;
  readonly invite: InviteInput;
}

/**
 * 2026-09-16 — what a store may do on its own, per capability, and the
 * asks that are waiting on this seller because their policy said so.
 */
export type StoreActionMode = 'OFF' | 'ASK_SELLER' | 'DIRECT';

export const ACTION_CAPABILITIES = [
  'recall',
  'addressFix',
  'cancel',
  'callCapDecision',
  'chaseSkydrop',
  'reattempt',
  'sendBack',
] as const;

export type ActionCapability = (typeof ACTION_CAPABILITIES)[number];

export type StoreActionPolicy = Readonly<Record<ActionCapability, StoreActionMode>> & {
  readonly storeId: string;
  /** False when the store is still running on the defaults. */
  readonly set: boolean;
  readonly updatedAt: string | null;
};

export interface StoreActionRequestRow {
  readonly id: string;
  readonly action: 'RECALL' | 'REATTEMPT' | 'RTO';
  readonly reason: string;
  readonly createdAt: string;
  readonly order: { readonly orderNumber: string; readonly recipientName: string } | null;
  readonly resellerStore: { readonly id: string; readonly name: string } | null;
}

const KEY = ['seller-reseller-stores'] as const;
const ACTION_KEY = ['seller-store-action-requests'] as const;
const ADDRESS_KEY = ['seller-store-address-changes'] as const;

export function useStoreActionPolicy(storeId: string): UseQueryResult<StoreActionPolicy> {
  const client = useApiClient();
  return useQuery({
    queryKey: [...KEY, storeId, 'action-policy'],
    queryFn: () =>
      client.request<StoreActionPolicy>(`/api/seller/reseller-stores/${storeId}/action-policy`),
    enabled: storeId !== '',
  });
}

export function useSetStoreActionPolicy(): UseMutationResult<
  StoreActionPolicy,
  Error,
  { readonly storeId: string; readonly policy: Record<ActionCapability, StoreActionMode> }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ storeId, policy }) =>
      client.request<StoreActionPolicy>(`/api/seller/reseller-stores/${storeId}/action-policy`, {
        method: 'PUT',
        body: policy,
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
}

/**
 * What the seller's stores are waiting on. Empty when nothing is.
 *
 * `enabled` exists for the nav count: the shell renders on EVERY page,
 * and this endpoint needs `stores.manage`. Asked unconditionally, every
 * seller without that permission would fire a 403 on every page they
 * open — a red herring in the logs and a request nobody wanted.
 */
export function useStoreActionRequests(
  options: { readonly enabled?: boolean } = {},
): UseQueryResult<readonly StoreActionRequestRow[]> {
  const client = useApiClient();
  return useQuery({
    queryKey: ACTION_KEY,
    queryFn: () =>
      client.request<readonly StoreActionRequestRow[]>('/api/seller/store-action-requests'),
    enabled: options.enabled ?? true,
  });
}

export function useDecideStoreAction(): UseMutationResult<
  unknown,
  Error,
  { readonly requestId: string; readonly approve: boolean; readonly note?: string }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ requestId, approve, note }) =>
      client.request(
        `/api/seller/store-action-requests/${requestId}/${approve ? 'approve' : 'reject'}`,
        { method: 'POST', body: note === undefined || note === '' ? {} : { note } },
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ACTION_KEY }),
  });
}

/**
 * 2026-09-16 — corrections to where a store's parcel is going, waiting
 * on this seller because their `addressFix` policy said “ask me first”.
 *
 * A separate queue from the delivery asks above because it is a
 * different question: those are about doing something to a parcel, this
 * is about what is printed on it. Both are answered on the one page.
 */
export type AddressField =
  | 'recipientName'
  | 'recipientPhoneE164'
  | 'recipientAltPhoneE164'
  | 'recipientEmail'
  | 'recipientAddressLine1'
  | 'recipientAddressLine2'
  | 'recipientLandmark'
  | 'recipientCity'
  | 'recipientStateProvince'
  | 'recipientPostalCode';

export interface StoreAddressChangeRow {
  readonly id: string;
  readonly reason: string;
  /** Only the fields this correction proposes. */
  readonly fields: Partial<Record<AddressField, string>>;
  readonly createdAt: string;
  /** The order as it reads NOW — what the proposal is compared against. */
  readonly order: {
    readonly orderNumber: string;
    readonly status: OrderStatus;
    readonly recipientName: string;
    readonly recipientPhoneE164: string;
    readonly recipientAddressLine1: string;
    readonly recipientAddressLine2: string;
    readonly recipientCity: string;
    readonly recipientStateProvince: string;
    readonly recipientPostalCode: string;
  } | null;
  readonly store: {
    readonly id: string;
    readonly name: string;
    readonly displayName: string | null;
  } | null;
}

/**
 * The address corrections waiting on this seller. Empty when none are.
 *
 * `enabled` for the same reason as `useStoreActionRequests`: this needs
 * `stores.manage`, and anything asked from the shell runs on EVERY page,
 * so an unconditional call would fire a 403 on every page view for every
 * seller who does not run reseller stores.
 */
export function useStoreAddressChanges(
  options: { readonly enabled?: boolean } = {},
): UseQueryResult<readonly StoreAddressChangeRow[]> {
  const client = useApiClient();
  return useQuery({
    queryKey: ADDRESS_KEY,
    queryFn: () =>
      client.request<readonly StoreAddressChangeRow[]>('/api/seller/store-address-changes'),
    enabled: options.enabled ?? true,
  });
}

/**
 * What a decision came back as.
 *
 * Typed, unlike `useDecideStoreAction`'s reply, because APPROVED is not
 * the end of it: writing the new details onto the order can still be
 * refused — it was confirmed, cancelled, or went into a call while
 * somebody was deciding — and “you agreed but it did not happen” is
 * exactly what the person who just clicked has to be told.
 */
export interface DecidedAddressChange {
  readonly id: string;
  readonly status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'APPLIED' | 'FAILED';
  /** The server's own words for why an approval could not be applied. */
  readonly failureReason: string | null;
}

export function useDecideStoreAddressChange(): UseMutationResult<
  DecidedAddressChange,
  Error,
  { readonly requestId: string; readonly approve: boolean; readonly note?: string }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ requestId, approve, note }) =>
      client.request<DecidedAddressChange>(
        `/api/seller/store-address-changes/${requestId}/${approve ? 'approve' : 'reject'}`,
        { method: 'POST', body: note === undefined || note === '' ? {} : { note } },
      ),
    // Approving WRITES the new details onto the order, so the seller's
    // own view of that order is stale the moment this returns.
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ADDRESS_KEY });
      void qc.invalidateQueries({ queryKey: ['seller-orders'] });
    },
  });
}

export function useResellerStores(enabled = true): UseQueryResult<readonly ResellerStoreView[]> {
  const client = useApiClient();
  return useQuery({
    enabled,
    queryKey: KEY,
    queryFn: () => client.request<readonly ResellerStoreView[]>('/api/seller/reseller-stores'),
  });
}

export function useResellerStore(storeId: string): UseQueryResult<ResellerStoreDetail> {
  const client = useApiClient();
  return useQuery({
    queryKey: [...KEY, storeId],
    queryFn: () => client.request<ResellerStoreDetail>(`/api/seller/reseller-stores/${storeId}`),
  });
}

export function useCreateResellerStore(): UseMutationResult<
  ResellerStoreDetail,
  Error,
  CreateResellerStoreInput
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<ResellerStoreDetail>('/api/seller/reseller-stores', { method: 'POST', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
}

function useStoreAction<TBody>(
  path: (storeId: string) => string,
  method: 'POST' | 'PATCH' = 'POST',
): UseMutationResult<ResellerStoreDetail, Error, { storeId: string; body?: TBody }> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ storeId, body }) =>
      client.request<ResellerStoreDetail>(path(storeId), {
        method,
        ...(body === undefined ? {} : { body }),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useApproveResellerStore(): UseMutationResult<
  ResellerStoreDetail,
  Error,
  // Approving is what OPENS an admin-created store, so its first user is
  // invited here and the invitation is required (2026-09-16). The outer
  // `body` stays optional because the shared `useStoreAction` types every
  // action that way; what this pins is that a body which IS sent carries
  // the invitation. The server refuses an approval without one.
  { storeId: string; body?: { invite: InviteInput } }
> {
  return useStoreAction((id) => `/api/seller/reseller-stores/${id}/approve`);
}

export function useRejectResellerStore(): UseMutationResult<
  ResellerStoreDetail,
  Error,
  { storeId: string; body?: { reason: string } }
> {
  return useStoreAction((id) => `/api/seller/reseller-stores/${id}/reject`);
}

export function usePauseResellerStore(): UseMutationResult<
  ResellerStoreDetail,
  Error,
  { storeId: string; body?: { reason?: string } }
> {
  return useStoreAction((id) => `/api/seller/reseller-stores/${id}/pause`);
}

export function useResumeResellerStore(): UseMutationResult<
  ResellerStoreDetail,
  Error,
  { storeId: string; body?: undefined }
> {
  return useStoreAction((id) => `/api/seller/reseller-stores/${id}/resume`);
}

export function useCloseResellerStore(): UseMutationResult<
  ResellerStoreDetail,
  Error,
  { storeId: string; body?: { reason: string } }
> {
  return useStoreAction((id) => `/api/seller/reseller-stores/${id}/close`);
}

export function useSetWalletManager(): UseMutationResult<
  ResellerStoreDetail,
  Error,
  { storeId: string; body?: { walletManagedBy: WalletManager } }
> {
  return useStoreAction((id) => `/api/seller/reseller-stores/${id}/wallet-manager`, 'PATCH');
}

export function useInviteToResellerStore(): UseMutationResult<
  unknown,
  Error,
  { storeId: string; body: InviteInput }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ storeId, body }) =>
      client.request(`/api/seller/reseller-stores/${storeId}/invitations`, {
        method: 'POST',
        body,
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useRevokeResellerInvitation(): UseMutationResult<
  void,
  Error,
  { storeId: string; invitationId: string }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ storeId, invitationId }) =>
      client.request<void>(
        `/api/seller/reseller-stores/${storeId}/invitations/${invitationId}/revoke`,
        { method: 'POST' },
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
}
