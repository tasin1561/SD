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

/**
 * RS-7 — the store's disputes with its seller, refereed by Skydrop. Every
 * path is the store's own (`/api/store/tickets*`), scoped by the token.
 */

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

export function useRaiseStoreDispute(): UseMutationResult<
  StoreTicketView,
  Error,
  { readonly orderId: string; readonly subject: string; readonly description?: string }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<StoreTicketView>('/api/store/tickets', { method: 'POST', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: TICKETS }),
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
