'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '@skydrop/auth/client';
import type { TicketView } from './ops-hooks';

/**
 * One ticket, read through `GET /seller/tickets/:ticketId`.
 *
 * The response is the same `TicketView` the list returns — the server
 * builds both from one `toView()` — so the type is imported rather than
 * restated. A second copy of a fifteen-field shape is a second thing to
 * forget when a field is added.
 *
 * The key sits under the `['seller-tickets']` prefix the list and the
 * raise mutation already invalidate, so a newly raised ticket and its
 * detail can never show two different statuses.
 *
 * A ticket belonging to another seller is a 404 from the server, not a
 * 403 — `getForSeller` scopes the lookup by sellerId — so the caller
 * gets the same "not found" treatment for a wrong id and a foreign one.
 */
export function useSellerTicket(ticketId: string): UseQueryResult<TicketView> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['seller-tickets', 'detail', ticketId],
    queryFn: () => client.request<TicketView>(`/api/seller/tickets/${ticketId}`),
  });
}
