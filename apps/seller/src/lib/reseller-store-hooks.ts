'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useApiClient } from '@skydrop/auth/client';
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
  readonly contactEmail?: string | undefined;
  readonly contactPhone?: string | undefined;
  readonly walletManagedBy?: WalletManager | undefined;
  readonly note?: string | undefined;
  readonly invite?: InviteInput | undefined;
}

const KEY = ['seller-reseller-stores'] as const;

export function useResellerStores(): UseQueryResult<readonly ResellerStoreView[]> {
  const client = useApiClient();
  return useQuery({
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
  { storeId: string; body?: { invite?: InviteInput } }
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
