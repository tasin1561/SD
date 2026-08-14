import type { ReactElement } from 'react';
import { OrderImportDetail } from '../_components/order-import-detail';

interface PageProps {
  params: Promise<{ id: string }>;
}

/**
 * One import run, at its own URL.
 *
 * Sits under `/orders/import`, so the `orders.import` entry in
 * PAGE_PERMISSIONS covers it by prefix — the same permission the
 * server's `@RequireSellerPermissions('orders.import')` on
 * `seller/order-imports` enforces on the fetch behind it (FE-2:
 * this only decides what is offered; the guard decides what happens).
 */
export default async function OrderImportDetailPage({ params }: PageProps): Promise<ReactElement> {
  const { id } = await params;
  return <OrderImportDetail importId={id} />;
}
