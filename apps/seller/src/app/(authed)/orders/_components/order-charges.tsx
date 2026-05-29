'use client';

import type { ReactElement } from 'react';
import type { OrderChargeView } from '@skydrop/api-client';
import { useOrderCharges } from '@/lib/api-hooks';
import {
  Card,
  CardBody,
  EmptyState,
  ErrorState,
  LoadingState,
} from '@skydrop/ui/components';

/**
 * Seller order-charges section (Module 17). Reads from
 * /seller/orders/:id/charges (server filters to
 * `isVisibleToSeller=true`). Lines render in `displayOrder`. Total
 * is the SUM of `totalAmountInr` across visible lines.
 *
 * When no charges are persisted (Phase 1A: the M15 fast-follow has
 * not landed at the order-create hook), shows the standard empty
 * state with the explanatory copy — the admin compute action can
 * populate them retroactively.
 */
export function OrderChargesSection({ orderId }: { orderId: string }): ReactElement {
  const charges = useOrderCharges(orderId);

  if (charges.isLoading) return <LoadingState label="Loading charges…" />;
  if (charges.isError) {
    return <ErrorState message={charges.error?.message ?? 'Failed to load charges.'} />;
  }
  if (!charges.data || charges.data.length === 0) {
    return (
      <EmptyState
        title="No charges persisted yet"
        description="Pricing breakdowns appear here once charges are computed for the order."
      />
    );
  }

  const total = charges.data.reduce((sum, c) => sum + Number(c.totalAmountInr), 0);

  return (
    <Card>
      <CardBody className="p-0">
        <table className="w-full text-sm">
          <thead className="text-text-muted text-[11px] uppercase tracking-wide bg-surface-raised border-b border-border">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Charge</th>
              <th className="text-right px-4 py-2 font-medium">Amount (INR)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {charges.data.map((c) => (
              <ChargeRow key={c.id} charge={c} />
            ))}
            <tr className="bg-surface-raised">
              <td className="px-4 py-2 text-text-bright font-medium">Total</td>
              <td className="px-4 py-2 text-right text-text-bright font-mono font-medium">
                {total.toFixed(2)}
              </td>
            </tr>
          </tbody>
        </table>
      </CardBody>
    </Card>
  );
}

function ChargeRow({ charge }: { charge: OrderChargeView }): ReactElement {
  return (
    <tr>
      <td className="px-4 py-2 text-text-body">
        <div className="text-sm">
          {charge.description ?? humanizeType(charge.type)}
        </div>
        <div className="text-text-faint text-[11px] uppercase tracking-wide mt-0.5">
          {charge.type.toLowerCase().replace(/_/g, ' ')} · {charge.status.toLowerCase()}
        </div>
      </td>
      <td className="px-4 py-2 text-right text-text-body font-mono">
        {charge.totalAmountInr}
      </td>
    </tr>
  );
}

function humanizeType(type: string): string {
  return type
    .toLowerCase()
    .split('_')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ');
}
