import type { ReactElement } from 'react';
import { ConsignmentPanel } from './_components/consignment-panel';

export default async function ConsignmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactElement> {
  const { id } = await params;
  return <ConsignmentPanel id={id} />;
}
