import type { ReactElement } from 'react';
import { NewOrderForm } from './_components/new-order-form';

/**
 * Manual order entry. The form posts to /seller/orders. "Save as draft"
 * leaves the order in DRAFT (visible in the list, editable); "Submit for
 * confirmation" additionally calls /:id/submit so it joins the call queue.
 *
 * The page header lives INSIDE the form rather than here, because its
 * action slot carries the same three buttons as the sticky bar and both
 * need the form's busy state.
 */
export default function NewOrderPage(): ReactElement {
  return <NewOrderForm />;
}
