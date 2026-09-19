'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import type { ActorType, TicketStatus, TicketType } from '@skydrop/db';
import { useApiClient } from '@skydrop/auth/client';
import { STORE_ORDERS_KEY, type StoreOrderRequestView } from './order-hooks';

/**
 * RS-7 — the store's disputes with its seller, refereed by Skydrop. Every
 * path is the store's own (`/api/store/tickets*`), scoped by the token.
 */

/** RS-7 — the money as both sides saw it when a correction was raised. */
export interface DisputedFiguresSnapshot {
  readonly capturedAt: string;
  readonly orderNumber: string;
  readonly paymentMode: string;
  readonly codInr: string | null;
  readonly transferTotalInr: string;
  readonly retailTotalInr: string;
  readonly parties: ReadonlyArray<{
    readonly party: 'STORE' | 'SELLER';
    readonly status: string;
    readonly grossInr: string;
    readonly transferInr: string;
    readonly taxShareInr: string;
    readonly codFeeShareInr: string;
    readonly instantFeeShareInr: string;
    readonly netInr: string;
  }>;
  readonly fees: ReadonlyArray<{
    readonly fee: string;
    readonly storeInr: string;
    readonly sellerInr: string;
    readonly totalInr: string;
  }>;
}

export interface StoreTicketView {
  readonly id: string;
  readonly ticketNumber: string;
  readonly openedBy: 'STAFF' | 'SELLER' | 'SYSTEM' | 'STORE';
  readonly ticketType: TicketType;
  readonly status: TicketStatus;
  readonly orderId: string | null;
  readonly orderNumber: string | null;
  readonly subject: string;
  readonly description: string | null;
  readonly resolutionAmountInr: string | null;
  readonly disputePayer: 'STORE' | 'SELLER' | null;
  readonly resolutionNotes: string | null;
  readonly resolvedAt: string | null;
  readonly createdAt: string;
  /** RS-7 (2026-09-19) — the correction case. */
  readonly disputeKind: 'GENERAL' | 'FIGURE_CORRECTION' | null;
  readonly disputeClaimAmountInr: string | null;
  readonly disputeClaimPayer: 'STORE' | 'SELLER' | null;
  readonly disputedFigures: DisputedFiguresSnapshot | null;
}

export interface StoreTicketEvent {
  readonly id: string;
  readonly note: string | null;
  readonly toStatus: TicketStatus;
  readonly actorType: ActorType;
  readonly at: string;
}

export type TicketStage = 'OPEN' | 'REVIEWING' | 'CLOSED';

export interface StoreTicketPage {
  readonly items: readonly StoreTicketView[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

const TICKETS = ['store-tickets'] as const;

export function useStoreTickets(query: {
  readonly stage?: TicketStage;
  readonly page?: number;
}): UseQueryResult<StoreTicketPage> {
  const client = useApiClient();
  const sp = new URLSearchParams();
  if (query.stage !== undefined) sp.set('stage', query.stage);
  sp.set('page', String(query.page ?? 1));
  return useQuery({
    queryKey: [...TICKETS, 'list', query],
    queryFn: () => client.request<StoreTicketPage>(`/api/store/tickets?${sp.toString()}`),
  });
}

export function useStoreTicket(id: string): UseQueryResult<StoreTicketView> {
  const client = useApiClient();
  return useQuery({
    queryKey: [...TICKETS, 'detail', id],
    queryFn: () => client.request<StoreTicketView>(`/api/store/tickets/${id}`),
    enabled: id !== '',
  });
}

export function useStoreTicketEvents(id: string): UseQueryResult<readonly StoreTicketEvent[]> {
  const client = useApiClient();
  return useQuery({
    queryKey: [...TICKETS, 'events', id],
    queryFn: () => client.request<readonly StoreTicketEvent[]>(`/api/store/tickets/${id}/events`),
    enabled: id !== '',
  });
}

/**
 * RS-7 — raise a dispute with the seller. A FIGURE_CORRECTION additionally
 * says what is owed and by whom; the server refuses one without it, and
 * refuses a claim on a GENERAL dispute (FE-2 — we do not pre-empt it).
 */
export interface RaiseStoreDisputeInput {
  readonly orderId: string;
  readonly subject: string;
  readonly description?: string;
  readonly disputeKind?: 'GENERAL' | 'FIGURE_CORRECTION';
  readonly claimAmountInr?: string;
  readonly claimPayer?: 'STORE' | 'SELLER';
}

export function useRaiseStoreDispute(): UseMutationResult<
  StoreTicketView,
  Error,
  RaiseStoreDisputeInput
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<StoreTicketView>('/api/store/tickets', { method: 'POST', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: TICKETS }),
  });
}

/**
 * 2026-09-16 — raising something with SKYDROP about one of this store's
 * orders: damaged in our hands, lost, or sitting in our warehouse.
 *
 * Its own endpoint and its own mutation rather than a flag on the
 * dispute above, because the two are different acts and only one of them
 * involves the seller. It lands in the same list, which is why the list
 * says which kind each thread is (`storeTicketKind`).
 */
/**
 * What came of raising it (2026-09-17): the ticket, or a request waiting
 * on Seller staff because the seller approves this store's issues first.
 */
export type StoreIssueOutcome =
  | { readonly applied: true; readonly ticket: StoreTicketView; readonly request: null }
  | { readonly applied: false; readonly ticket: null; readonly request: StoreOrderRequestView };

export function useRaiseStoreSkydropIssue(): UseMutationResult<
  StoreIssueOutcome,
  Error,
  { readonly orderId: string; readonly subject: string; readonly description?: string }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<StoreIssueOutcome>('/api/store/issues', { method: 'POST', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: TICKETS });
      void qc.invalidateQueries({ queryKey: STORE_ORDERS_KEY });
    },
  });
}

export function useReplyStoreTicket(
  id: string,
): UseMutationResult<{ ticketId: string; at: string }, Error, { readonly note: string }> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<{ ticketId: string; at: string }>(`/api/store/tickets/${id}/notes`, {
        method: 'POST',
        body,
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: TICKETS }),
  });
}
