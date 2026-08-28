'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useApiClient } from '@skydrop/auth/client';

/**
 * The accounts we tell sellers to send money to.
 *
 * These had a controller and no screen, which meant an account could
 * only arrive by a direct INSERT — and, more to the point, could not be
 * corrected or withdrawn once sellers were already paying into it. A
 * bank account is exactly the record you need to change under time
 * pressure: the branch code was wrong, or the account is closing, and
 * every hour it stays on the transfer page is another payment sent
 * somewhere it cannot be matched.
 *
 * Its own file rather than api-hooks.ts — money surfaces are not
 * warehouse surfaces, and that file is already 1400 lines.
 */

export interface PlatformBankAccountView {
  readonly id: string;
  readonly label: string;
  readonly bankName: string;
  readonly accountName: string;
  readonly accountNumber: string;
  readonly branchCode: string | null;
  readonly branchName: string | null;
  readonly district: string | null;
  readonly routingNumber: string | null;
  readonly currency: string;
  readonly instructions: string | null;
  readonly isActive: boolean;
  readonly displayOrder: number;
}

/**
 * Mirrors `UpsertPlatformBankAccountDto` exactly — the same body serves
 * create and update, which is why there is one type and not two.
 */
export interface UpsertBankAccountBody {
  readonly label: string;
  readonly bankName: string;
  readonly accountName: string;
  readonly accountNumber: string;
  readonly branchCode?: string;
  readonly branchName?: string;
  readonly district?: string;
  readonly routingNumber?: string;
  readonly currency: string;
  readonly instructions?: string;
  readonly isActive?: boolean;
  readonly displayOrder?: number;
}

export function usePlatformBankAccounts(
  enabled = true,
): UseQueryResult<ReadonlyArray<PlatformBankAccountView>> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-bank-accounts'],
    queryFn: () =>
      client.request<ReadonlyArray<PlatformBankAccountView>>('/api/admin/platform-bank-accounts'),
    // Gateable, because this list is needed by pages whose own gate is
    // narrower than `money.view`. A request nobody may make should never
    // be sent — a 403 on load is a page that looks broken to someone who
    // did nothing wrong.
    enabled,
  });
}

export function useCreateBankAccount(): UseMutationResult<
  PlatformBankAccountView,
  Error,
  UpsertBankAccountBody
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<PlatformBankAccountView>('/api/admin/platform-bank-accounts', {
        method: 'POST',
        body,
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-bank-accounts'] }),
  });
}

export function useUpdateBankAccount(): UseMutationResult<
  PlatformBankAccountView,
  Error,
  { id: string; body: UpsertBankAccountBody }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }) =>
      client.request<PlatformBankAccountView>(`/api/admin/platform-bank-accounts/${id}`, {
        method: 'PATCH',
        body,
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-bank-accounts'] }),
  });
}

/**
 * Soft delete. A past top-up names the account it went to and that
 * record has to keep resolving long after we stop offering it, so the
 * row survives — this only takes it off the seller's transfer page.
 */
export function useRetireBankAccount(): UseMutationResult<void, Error, { id: string }> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }) =>
      client.request<void>(`/api/admin/platform-bank-accounts/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-bank-accounts'] }),
  });
}
