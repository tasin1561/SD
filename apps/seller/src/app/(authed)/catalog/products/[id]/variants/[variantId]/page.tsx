import type { ReactElement } from 'react';
import { VariantDetailView } from './_components/variant-detail';

interface PageProps {
  params: Promise<{ id: string; variantId: string }>;
}

export default async function VariantDetailPage({
  params,
}: PageProps): Promise<ReactElement> {
  const { id, variantId } = await params;
  return <VariantDetailView productId={id} variantId={variantId} />;
}
