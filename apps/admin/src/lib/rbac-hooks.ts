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
 * Roles and permissions.
 *
 * The catalogue is served rather than bundled: it is defined in the API
 * (`common/auth/permissions.ts`) because that is where the endpoints
 * declaring each key live, and a second copy in the frontend would be a
 * list of checkboxes that slowly stops matching what the server
 * enforces.
 */

export interface RoleView {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly description: string | null;
  readonly isSystem: boolean;
  readonly isSuperAdmin: boolean;
  readonly permissions: readonly string[];
  readonly staffCount: number;
}

export interface CatalogueEntry {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly group: string;
  readonly dangerous: boolean;
}

export interface Catalogue {
  readonly groups: readonly string[];
  readonly permissions: readonly CatalogueEntry[];
}

const ROOT = '/api/admin/staff-roles';
const KEY = ['admin-staff-roles'];

export function usePermissionCatalogue(): UseQueryResult<Catalogue> {
  const client = useApiClient();
  return useQuery({
    queryKey: [...KEY, 'catalogue'],
    // The catalogue only changes with a deploy.
    staleTime: 5 * 60 * 1000,
    queryFn: () => client.request<Catalogue>(`${ROOT}/catalogue`),
  });
}

export function useRoles(): UseQueryResult<readonly RoleView[]> {
  const client = useApiClient();
  return useQuery({
    queryKey: [...KEY, 'list'],
    queryFn: () => client.request<readonly RoleView[]>(ROOT),
  });
}

export function useCreateRole(): UseMutationResult<
  RoleView,
  Error,
  { name: string; description?: string; permissions: readonly string[] }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => client.request<RoleView>(ROOT, { method: 'POST', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useUpdateRole(): UseMutationResult<
  RoleView,
  Error,
  { id: string; name?: string; description?: string; permissions?: readonly string[] }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }) =>
      client.request<RoleView>(`${ROOT}/${id}`, { method: 'PATCH', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteRole(): UseMutationResult<{ deleted: true }, Error, { id: string }> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }) =>
      client.request<{ deleted: true }>(`${ROOT}/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
}
