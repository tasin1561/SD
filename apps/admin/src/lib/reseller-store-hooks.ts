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
 * Reseller stores across sellers (RS-1). Reads need
 * `reseller.stores.view`; opening one for a seller needs
 * `reseller.stores.manage`. The lifecycle after that is the seller's.
 */

export interface AdminResellerStoreView {
  readonly id: string;
  readonly sellerId: string;
  readonly sellerCompanyName: string;
  readonly name: string;
  readonly displayName: string | null;
  readonly status: ResellerStoreStatusValue;
  readonly origin: 'SELLER' | 'ADMIN';
  readonly walletManagedBy: 'SELLER' | 'SKYDROP';
  readonly contactEmail: string | null;
  readonly contactPhone: string | null;
  readonly note: string | null;
  readonly memberCount: number;
  readonly createdAt: string;
  readonly statusChangedAt: string | null;
}

export interface AdminResellerStoreDetail extends AdminResellerStoreView {
  readonly logoUrl: string | null;
  readonly events: ReadonlyArray<{
    readonly id: string;
    readonly kind: string;
    readonly fromStatus: ResellerStoreStatusValue | null;
    readonly toStatus: ResellerStoreStatusValue | null;
    readonly actorType: string;
    readonly note: string | null;
    readonly createdAt: string;
  }>;
  readonly team: {
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
  };
}

export interface AdminCreateResellerStoreInput {
  readonly sellerId: string;
  readonly name: string;
  readonly displayName?: string | undefined;
  // Required since 2026-09-16 (owner) — see the seller-side twin. The
  // invitation is not here: an admin-created store has no team until the
  // seller approves it, and it is required on THAT call.
  readonly contactEmail: string;
  readonly contactPhone: string;
  readonly walletManagedBy?: 'SELLER' | 'SKYDROP' | undefined;
  readonly note?: string | undefined;
}

const KEY = ['admin-reseller-stores'] as const;

export function useAdminResellerStores(filter: {
  status?: string;
  sellerId?: string;
}): UseQueryResult<readonly AdminResellerStoreView[]> {
  const client = useApiClient();
  return useQuery({
    queryKey: [...KEY, 'list', filter],
    queryFn: () => {
      const sp = new URLSearchParams();
      if (filter.status) sp.set('status', filter.status);
      if (filter.sellerId) sp.set('sellerId', filter.sellerId);
      const qs = sp.toString();
      return client.request<readonly AdminResellerStoreView[]>(
        `/api/admin/reseller-stores${qs ? `?${qs}` : ''}`,
      );
    },
  });
}

export function useAdminResellerStore(storeId: string): UseQueryResult<AdminResellerStoreDetail> {
  const client = useApiClient();
  return useQuery({
    queryKey: [...KEY, 'detail', storeId],
    queryFn: () =>
      client.request<AdminResellerStoreDetail>(`/api/admin/reseller-stores/${storeId}`),
  });
}

export function useAdminCreateResellerStore(): UseMutationResult<
  AdminResellerStoreDetail,
  Error,
  AdminCreateResellerStoreInput
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<AdminResellerStoreDetail>('/api/admin/reseller-stores', {
        method: 'POST',
        body,
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
}
