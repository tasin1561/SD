'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useApiClient } from '@skydrop/auth/client';
import type { AttributeValueType } from '@skydrop/db';

/**
 * Category attribute definitions.
 *
 * These are what a variant under a category is required to specify —
 * "colour must be one of these five", "voltage is a number". They
 * INHERIT down the category tree, child overriding parent on the same
 * key, which is the part a UI has to make visible: a definition you did
 * not write can still be governing your variants.
 */

export interface AttributeDefinition {
  id: string;
  categoryId: string;
  attributeKey: string;
  displayLabel: string;
  valueType: AttributeValueType;
  allowedValues: readonly string[];
  isRequired: boolean;
  displayOrder: number;
}

/** The resolved set, after walking the ancestor chain. */
export interface EffectiveAttribute {
  attributeKey: string;
  displayLabel: string;
  valueType: AttributeValueType;
  allowedValues: readonly string[];
  isRequired: boolean;
  displayOrder: number;
  /** The deepest category that supplied this — may not be the one you are viewing. */
  sourceCategoryId: string;
}

export interface AttributeInput {
  attributeKey: string;
  displayLabel: string;
  valueType: AttributeValueType;
  allowedValues?: string[];
  isRequired?: boolean;
  displayOrder?: number;
}

export function useCategoryAttributes(
  categoryId: string | null,
): UseQueryResult<readonly AttributeDefinition[]> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-attributes', 'own', categoryId],
    enabled: categoryId !== null,
    queryFn: () =>
      client.request<readonly AttributeDefinition[]>(
        `/api/admin/categories/${categoryId ?? ''}/attributes`,
      ),
  });
}

export function useEffectiveAttributes(
  categoryId: string | null,
): UseQueryResult<readonly EffectiveAttribute[]> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-attributes', 'effective', categoryId],
    enabled: categoryId !== null,
    queryFn: () =>
      client.request<readonly EffectiveAttribute[]>(
        `/api/admin/categories/${categoryId ?? ''}/attributes/effective`,
      ),
  });
}

export function useCreateAttribute(): UseMutationResult<
  AttributeDefinition,
  Error,
  { categoryId: string; body: AttributeInput }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ categoryId, body }) =>
      client.request<AttributeDefinition>(`/api/admin/categories/${categoryId}/attributes`, {
        method: 'POST',
        body,
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-attributes'] }),
  });
}

export function useUpdateAttribute(): UseMutationResult<
  AttributeDefinition,
  Error,
  { categoryId: string; attributeId: string; body: Partial<Omit<AttributeInput, 'attributeKey'>> }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ categoryId, attributeId, body }) =>
      client.request<AttributeDefinition>(
        `/api/admin/categories/${categoryId}/attributes/${attributeId}`,
        { method: 'PATCH', body },
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-attributes'] }),
  });
}

export function useDeleteAttribute(): UseMutationResult<
  unknown,
  Error,
  { categoryId: string; attributeId: string }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ categoryId, attributeId }) =>
      client.request<unknown>(`/api/admin/categories/${categoryId}/attributes/${attributeId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-attributes'] }),
  });
}
