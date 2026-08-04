import type { ReactElement } from 'react';
import { PageHeader } from '@skydrop/ui/components';
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
    <div>
      <PageHeader
        title="Edit order"
        subtitle="DRAFT orders are fully editable. PENDING_CONFIRMATION orders allow recipient + notes corrections only."
      />
      <EditOrderForm orderId={id} />
    </div>
  );
}
