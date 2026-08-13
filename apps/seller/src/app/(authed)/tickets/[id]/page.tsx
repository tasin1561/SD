import type { ReactElement } from 'react';
import { TicketDetail } from '../_components/ticket-detail';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function SellerTicketDetailPage({ params }: PageProps): Promise<ReactElement> {
  const { id } = await params;
  return <TicketDetail ticketId={id} />;
}
