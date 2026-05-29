import type { ReactElement } from 'react';
import { PageHeader, EmptyState } from '@skydrop/ui/components';

/**
 * Orders — CP2.A pattern-setter (list with URL-driven filters + detail
 * with lifecycle timeline). The ORDER_VIEW_INCLUDE expansion landing
 * with CP2.A closes the M11 ndr_reason debt + the M12 lifecycle
 * timeline debt in the same commit.
 */
export default function OrdersPage(): ReactElement {
  return (
    <>
      <PageHeader title="Orders" subtitle="Manage incoming orders, confirm, track lifecycle." />
      <EmptyState
        title="Orders coming in CP2.A"
        description="Read-heavy pattern-setter: list with filters, detail with timeline, tracking deep-link. ORDER_VIEW_INCLUDE expansion lights this up."
      />
    </>
  );
}
