import type { ReactElement } from 'react';
import { AdminTicketDetail } from '../_components/admin-ticket-detail';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function AdminTicketDetailPage({ params }: PageProps): Promise<ReactElement> {
  const { id } = await params;
  return <AdminTicketDetail ticketId={id} />;
}
