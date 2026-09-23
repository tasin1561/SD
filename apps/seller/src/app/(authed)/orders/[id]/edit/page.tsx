import type { ReactElement } from 'react';
import Link from 'next/link';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { EditOrderForm } from './_components/edit-order-form';

/**
 * Edit a DRAFT order. Loads the existing order on the client + shows
 * the same form as new-order but pre-filled; only PATCH semantics
 * (touch only changed fields). Server enforces what's editable per
 * order status (DRAFT = full; PENDING_CONFIRMATION = recipient +
 * notes; rest = 409).
 */
export default async function EditOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactElement> {
  const { id } = await params;
  return (
    <div className="ord-page">
      <PageHeader
        breadcrumbs={[
          { label: 'Seller console' },
          { label: 'Fulfilment' },
          { label: 'Orders', href: '/orders' },
          { label: 'Order', href: `/orders/${id}` },
          { label: 'Edit' },
        ]}
        Link={Link}
        title="Edit order"
        subtitle="A draft can be changed in full. Once it is waiting on the call centre, the recipient and the notes are still yours to correct."
      />
      <EditOrderForm orderId={id} />
    </div>
  );
}
