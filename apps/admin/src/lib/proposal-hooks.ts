'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useApiClient } from '@skydrop/auth/client';
import type { CategoryProposalStatus, PackageType } from '@skydrop/db';

/**
 * Seller category proposals, admin side.
 *
 * This was a dead-end workflow: sellers could propose a category
 * through their API and nothing anywhere could approve one. Proposals
 * accumulated in PENDING with no reader.
 */

interface Paginated<T> {
  items: readonly T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CategoryProposalView {
  id: string;
  sellerId: string;
  proposedName: string;
  proposedSlug: string;
  proposedParentId: string | null;
  rationale: string;
  status: CategoryProposalStatus;
  reviewedByStaffId: string | null;
  reviewedAt: string | null;
  decisionNote: string | null;
  resultingCategoryId: string | null;
  createdAt: string;
}

export interface ApproveProposalBody {
  decisionNote?: string;
  sortOrder?: number;
  defaultPackageType?: PackageType;
  requiresFragile?: boolean;
  requiresColdChain?: boolean;
  defaultHsCode?: string;
  defaultGstRate?: number;
}

function qs(query: Record<string, string | number | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== '') p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

export function useProposalsList(query: {
  status?: string;
  sellerId?: string;
  page?: number;
  pageSize?: number;
}): UseQueryResult<Paginated<CategoryProposalView>> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-proposals', 'list', query],
    queryFn: () =>
      client.request<Paginated<CategoryProposalView>>(`/admin/category-proposals${qs(query)}`),
  });
}

export function useApproveProposal(): UseMutationResult<
  CategoryProposalView,
  Error,
  { id: string; body: ApproveProposalBody }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }) =>
      client.request<CategoryProposalView>(`/admin/category-proposals/${id}/approve`, {
        method: 'POST',
        body,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-proposals'] });
      // Approval CREATES the category, so any category list is stale.
      void qc.invalidateQueries({ queryKey: ['admin-categories'] });
    },
  });
}

export function useRejectProposal(): UseMutationResult<
  CategoryProposalView,
  Error,
  { id: string; decisionNote: string }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, decisionNote }) =>
      client.request<CategoryProposalView>(`/admin/category-proposals/${id}/reject`, {
        method: 'POST',
        body: { decisionNote },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-proposals'] }),
  });
}
