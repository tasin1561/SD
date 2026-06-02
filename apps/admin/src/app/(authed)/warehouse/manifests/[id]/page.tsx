import type { ReactElement } from 'react';
import { ManifestDetailView } from '../_components/manifest-detail-view';

export default async function ManifestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactElement> {
  const { id } = await params;
  return <ManifestDetailView id={id} />;
}
