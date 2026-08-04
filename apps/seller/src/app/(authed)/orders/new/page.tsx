import type { ReactElement } from 'react';
import { NewOrderForm } from './_components/new-order-form';
import { PageHeader } from '@skydrop/ui/components';

/**
 * Manual order entry — one line per order (Phase 1A constraint;
 * multi-line is a deferred enhancement per ORD-9). The form posts
 * to /seller/orders. "Save as draft" leaves the order in DRAFT
 * (visible in the list, editable); "Submit for confirmation"
 * additionally calls /:id/submit so it joins the call queue.
 */
export default function NewOrderPage(): ReactElement {
  return (
    <div>
      <PageHeader
        title="New order"
        subtitle="Enter recipient + line details. Stock is reserved when the call centre confirms the order."
      />
      <NewOrderForm />
    </div>
  );
}
