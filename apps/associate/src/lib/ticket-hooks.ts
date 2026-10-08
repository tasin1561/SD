'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import type { ActorType, TicketStatus } from '@skydrop/db';
import { useApiClient } from '@skydrop/auth/client';

/**
 * ASSOC-1 capability 5 — "request to create support ticket".
 *
 * `POST /store/tickets` raises it against one of this person's own
 * orders; `GET /store/tickets` lists what has been raised, narrowed by
 * the same order scope. Skydrop and the store read the thread and reply
 * on it.
 *
 * ── WHAT IS NOT SENT, AND WHY ───────────────────────────────────────
 * The store's own ticket form can additionally raise a FIGURE
 * CORRECTION — a claim for an amount, payable by the store or by the
 * seller, which settles by moving money between their two wallets. An
 * associate has no wallet and no business naming a figure in somebody
 * else's settlement, so this app sends `{ orderId, subject, description }`
 * and nothing else, and the server's own default decides the kind.
 *
 * The `resolutionAmountInr` an admin may later put on a ticket is for
 * the same reason absent from the view below: it is money between the
 * store and its seller.
 */

export interface MyTicket {
  readonly id: string;
  readonly ticketNumber: string;
  readonly openedBy: 'STAFF' | 'SELLER' | 'SYSTEM' | 'STORE';
  readonly status: TicketStatus;
  readonly orderId: string | null;
  readonly orderNumber: string | null;
  readonly subject: string;
  readonly description: string | null;
  readonly resolutionNotes: string | null;
  readonly resolvedAt: string | null;
  readonly createdAt: string;
}

export interface MyTicketEvent {
  readonly id: string;
  readonly note: string | null;
  readonly toStatus: TicketStatus;
  readonly actorType: ActorType;
  readonly at: string;
}

export type TicketStage = 'OPEN' | 'REVIEWING' | 'CLOSED';

export interface MyTicketPage {
  readonly items: readonly MyTicket[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

const TICKETS = ['my-tickets'] as const;

export function useMyTickets(query: {
  readonly stage?: TicketStage;
  readonly page?: number;
}): UseQueryResult<MyTicketPage> {
  const client = useApiClient();
  const sp = new URLSearchParams();
  if (query.stage !== undefined) sp.set('stage', query.stage);
  sp.set('page', String(query.page ?? 1));
  return useQuery({
    queryKey: [...TICKETS, 'list', query],
    queryFn: () => client.request<MyTicketPage>(`/api/store/tickets?${sp.toString()}`),
  });
}

export function useMyTicket(id: string): UseQueryResult<MyTicket> {
  const client = useApiClient();
  return useQuery({
    queryKey: [...TICKETS, 'detail', id],
    queryFn: () => client.request<MyTicket>(`/api/store/tickets/${id}`),
    enabled: id !== '',
  });
}

export function useMyTicketEvents(id: string): UseQueryResult<readonly MyTicketEvent[]> {
  const client = useApiClient();
  return useQuery({
    queryKey: [...TICKETS, 'events', id],
    queryFn: () => client.request<readonly MyTicketEvent[]>(`/api/store/tickets/${id}/events`),
    enabled: id !== '',
  });
}

export function useRaiseTicket(): UseMutationResult<
  MyTicket,
  Error,
  { readonly orderId: string; readonly subject: string; readonly description?: string }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => client.request<MyTicket>('/api/store/tickets', { method: 'POST', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: TICKETS }),
  });
}

export function useReplyToTicket(
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
