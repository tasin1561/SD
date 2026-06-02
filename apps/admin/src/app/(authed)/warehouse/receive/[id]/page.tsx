import type { ReactElement } from 'react';
import { ReceiveDetailView } from '../_components/receive-detail-view';

export default async function ReceiveDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactElement> {
  const { id } = await params;
  return <ReceiveDetailView id={id} />;
}
