import type { ReactElement } from 'react';
import { OrdersIndex } from './_components/orders-index';

/**
 * Orders — CP2.A pattern-setter (read-heavy: list + detail + lifecycle
 * timeline + tracking deep-link embed). The list page is URL-driven
 * (status, search, page) so deep-linked filters are shareable.
 *
 * The detail page (CP2.A.4) renders the recipient snapshot, payment +
 * physical, items, lifecycle timeline (via /seller/orders/:id/events),
 * and tracking deep-link.
 */
export default function OrdersPage(): ReactElement {
  return <OrdersIndex />;
}
