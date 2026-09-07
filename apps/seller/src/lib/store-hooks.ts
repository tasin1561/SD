'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useApiClient } from '@skydrop/auth/client';

/** One of your shopfronts. */
export interface StoreView {
  readonly id: string;
  readonly name: string;
  readonly note: string | null;
  readonly isDefault: boolean;
  readonly isActive: boolean;
  /** Why closing one is a decision rather than a tidy-up. */
  readonly orderCount: number;
  readonly createdAt: string;
}

const KEY = ['seller-stores'] as const;

export function useStores(enabled = true): UseQueryResult<readonly StoreView[]> {
  const client = useApiClient();
  return useQuery({
    queryKey: KEY,
    queryFn: () => client.request<readonly StoreView[]>('/api/seller/stores'),
    enabled,
  });
}

export function useCreateStore(): UseMutationResult<
  StoreView,
  Error,
  { name: string; note?: string }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => client.request<StoreView>('/api/seller/stores', { method: 'POST', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: KEY });
      // The order form's selector reads the same list.
      void qc.invalidateQueries({ queryKey: ['seller-orders'] });
    },
  });
}

export function useUpdateStore(): UseMutationResult<
  StoreView,
  Error,
  { storeId: string; name?: string; note?: string }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ storeId, ...body }) =>
      client.request<StoreView>(`/api/seller/stores/${storeId}`, { method: 'PATCH', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useMakeStoreDefault(): UseMutationResult<StoreView, Error, { storeId: string }> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ storeId }) =>
      client.request<StoreView>(`/api/seller/stores/${storeId}/make-default`, { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useSetStoreActive(): UseMutationResult<
  StoreView,
  Error,
  { storeId: string; isActive: boolean }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ storeId, isActive }) =>
      client.request<StoreView>(`/api/seller/stores/${storeId}/active`, {
        method: 'PATCH',
        body: { isActive },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
}
