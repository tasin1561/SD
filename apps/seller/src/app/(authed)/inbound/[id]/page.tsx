import type { ReactElement } from 'react';
import { ConsignmentDetailView } from './_components/consignment-detail';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function SellerConsignmentPage({ params }: PageProps): Promise<ReactElement> {
  const { id } = await params;
  return <ConsignmentDetailView id={id} />;
}
