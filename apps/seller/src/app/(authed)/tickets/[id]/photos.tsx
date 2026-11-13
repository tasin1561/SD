'use client';

import type { ReactElement } from 'react';
import { useApiClient } from '@skydrop/auth/client';
import { TicketPhotos } from '@skydrop/ui/app/assistant';

/**
 * The photos a person sent the assistant before it raised this ticket. The
 * list is the assistant module's, behind the same `tickets.view` permission
 * and the same own-company scoping as the ticket itself; with none (or a
 * refusal) it renders nothing.
 */
export function SellerTicketPhotos({ ticketId }: { ticketId: string }): ReactElement {
  const client = useApiClient();
  return (
    <TicketPhotos
      ticketId={ticketId}
      fetcher={(id) => client.request(`/api/seller/assistant/tickets/${id}/photos`)}
    />
  );
}
