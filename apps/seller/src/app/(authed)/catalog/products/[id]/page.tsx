import type { ReactElement } from 'react';
import { ProductDetailView } from './_components/product-detail';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ProductDetailPage({ params }: PageProps): Promise<ReactElement> {
  const { id } = await params;
  return <ProductDetailView productId={id} />;
}
