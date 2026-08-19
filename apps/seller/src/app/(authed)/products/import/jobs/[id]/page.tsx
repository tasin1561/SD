import type { ReactElement } from 'react';
import { ImportDetail } from '../../_components/import-detail';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function CatalogImportJobPage({ params }: PageProps): Promise<ReactElement> {
  const { id } = await params;
  return <ImportDetail importId={id} />;
}
