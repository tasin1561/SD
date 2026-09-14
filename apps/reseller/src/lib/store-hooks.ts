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
 * The reseller portal's API hooks (RS-2). Every path is the store's OWN
 * surface — `/api/store/*`, scoped server-side by the token — so there is
 * no store id in any URL here, by construction.
 */

export type StoreRoleKey = 'owner' | 'admin' | 'ops' | 'finance' | 'viewer';

export interface StoreProfileView {
  readonly name: string;
  readonly displayName: string | null;
  readonly status: ResellerStoreStatusValue | null;
  readonly contactEmail: string | null;
  readonly contactPhone: string | null;
  readonly logoUrl: string | null;
  readonly sellerCompanyName: string;
}

export interface StoreMemberView {
  readonly id: string;
  readonly email: string;
  readonly fullName: string;
  readonly roleKey: string;
  readonly roleName: string;
  readonly isOwner: boolean;
  readonly lastLoginAt: string | null;
  readonly createdAt: string;
}

export interface StoreInvitationView {
  readonly id: string;
  readonly email: string;
  readonly fullName: string;
  readonly roleKey: string;
  readonly roleName: string;
  readonly expiresAt: string;
  readonly createdAt: string;
}

export interface StoreTeamView {
  readonly members: readonly StoreMemberView[];
  readonly invitations: readonly StoreInvitationView[];
  readonly roles: ReadonlyArray<{
    readonly key: string;
    readonly name: string;
    readonly description: string | null;
  }>;
}

interface LogoPresign {
  readonly storageKey: string;
  readonly uploadUrl: string;
  readonly maxSizeBytes: number;
}

const PROFILE = ['store-profile'] as const;
const TEAM = ['store-team'] as const;

export function useStoreProfile(): UseQueryResult<StoreProfileView> {
  const client = useApiClient();
  return useQuery({
    queryKey: PROFILE,
    queryFn: () => client.request<StoreProfileView>('/api/store/profile'),
  });
}

export function useUpdateStoreProfile(): UseMutationResult<
  StoreProfileView,
  Error,
  { displayName?: string; contactEmail?: string; contactPhone?: string }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<StoreProfileView>('/api/store/profile', { method: 'PATCH', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: PROFILE }),
  });
}

/**
 * Presign → PUT straight to Spaces → register. The PUT is a raw fetch to
 * the presigned URL (storage, not our API), which is why the CSP allows
 * Spaces in connect-src; the register goes back through the proxy.
 */
export function useUploadStoreLogo(): UseMutationResult<StoreProfileView, Error, File> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file) => {
      const presign = await client.request<LogoPresign>('/api/store/profile/logo/presign', {
        method: 'POST',
        body: { mimeType: file.type },
      });
      if (file.size > presign.maxSizeBytes) {
        throw new Error('That file is larger than 1 MB. Choose a smaller logo.');
      }
      const put = await fetch(presign.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      if (!put.ok) throw new Error(`The upload failed (${put.status}). Try again.`);
      return client.request<StoreProfileView>('/api/store/profile/logo/register', {
        method: 'POST',
        body: { storageKey: presign.storageKey, mimeType: file.type },
      });
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: PROFILE }),
  });
}

export function useRemoveStoreLogo(): UseMutationResult<StoreProfileView, Error, void> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      client.request<StoreProfileView>('/api/store/profile/logo', { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: PROFILE }),
  });
}

export function useStoreTeam(enabled = true): UseQueryResult<StoreTeamView> {
  const client = useApiClient();
  return useQuery({
    queryKey: TEAM,
    queryFn: () => client.request<StoreTeamView>('/api/store/team'),
    enabled,
  });
}

export function useInviteStoreMember(): UseMutationResult<
  StoreInvitationView,
  Error,
  { email: string; fullName: string; roleKey: StoreRoleKey }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<StoreInvitationView>('/api/store/team/invitations', { method: 'POST', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: TEAM }),
  });
}

export function useRevokeStoreInvitation(): UseMutationResult<
  void,
  Error,
  { invitationId: string }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ invitationId }) =>
      client.request<void>(`/api/store/team/invitations/${invitationId}/revoke`, {
        method: 'POST',
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: TEAM }),
  });
}

export function useChangeStoreMemberRole(): UseMutationResult<
  StoreMemberView,
  Error,
  { memberId: string; roleKey: StoreRoleKey }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ memberId, roleKey }) =>
      client.request<StoreMemberView>(`/api/store/team/members/${memberId}/role`, {
        method: 'PATCH',
        body: { roleKey },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: TEAM }),
  });
}

export function useRemoveStoreMember(): UseMutationResult<void, Error, { memberId: string }> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ memberId }) =>
      client.request<void>(`/api/store/team/members/${memberId}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: TEAM }),
  });
}

export function useRequestEmailVerification(): UseMutationResult<{ ok: true }, Error, void> {
  const client = useApiClient();
  return useMutation({
    mutationFn: () =>
      client.request<{ ok: true }>('/api/auth/store/email-verification/request', {
        method: 'POST',
      }),
  });
}

export function useSignOutEverywhere(): UseMutationResult<{ revokedCount: number }, Error, void> {
  const client = useApiClient();
  return useMutation({
    mutationFn: () =>
      client.request<{ revokedCount: number }>('/api/auth/store/logout-all', { method: 'POST' }),
  });
}
