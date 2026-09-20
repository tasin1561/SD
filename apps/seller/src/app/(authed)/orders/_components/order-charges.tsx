'use client';

import type { ReactElement } from 'react';
import type { OrderChargeView } from '@skydrop/api-client';
import { useOrderCharges } from '@/lib/api-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import {
  EmptyState,
  ErrorState,
  Money,
  SkeletonRows,
  TBody,
  Table,
  Td,
  Th,
  THead,
  Tr,
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
 *
 * ── CONSOLE PASS (2026-09-20) ───────────────────────────────────────
 * It renders NO `Card` of its own any more. The caller caps it with a
 * `SectionBand`, and `BandBody` IS the bordered surface — a card
 * inside that draws a second border a hair inside the first, which is
 * the mistake the profile conversion had to undo.
 *
 * The table was a hand-rolled `<thead>`/`<tbody>` inside the `Table`
 * WRAPPER, which meant it alone did not inherit the below-`md` card
 * layout every other table on the estate gets (FE-7) — two columns of
 * money on a 360px phone. It is the primitives now, so the mobile
 * stack and the stamped column labels come for free.
 */
export function OrderChargesSection({ orderId }: { orderId: string }): ReactElement {
  const charges = useOrderCharges(orderId);

  if (charges.isLoading) {
    return (
      <div className="p-3">
        <SkeletonRows rows={4} cols={2} />
      </div>
    );
  }
  if (charges.isError) {
    return (
      <div className="p-3">
        <ErrorState
          message={serverVerdict(charges.error, 'Failed to load charges.')}
          retry={() => void charges.refetch()}
        />
      </div>
    );
  }
  if (!charges.data || charges.data.length === 0) {
    return (
      <div className="p-3">
        <EmptyState
          title="No charges persisted yet"
          description="Pricing breakdowns appear here once charges are computed for the order."
        />
      </div>
    );
  }

  const total = charges.data.reduce((sum, c) => sum + Number(c.totalAmountInr), 0);

  return (
    <Table>
      <THead>
        <Tr>
          <Th>Charge</Th>
          <Th align="right">Amount</Th>
        </Tr>
      </THead>
      <TBody>
        {charges.data.map((c) => (
          <ChargeRow key={c.id} charge={c} />
        ))}
        <Tr className="bg-surface-raised">
          <Td className="text-text-bright font-medium">Total</Td>
          <Td align="right" className="text-text-bright font-medium">
            <Money amount={total} />
          </Td>
        </Tr>
      </TBody>
    </Table>
  );
}

function ChargeRow({ charge }: { charge: OrderChargeView }): ReactElement {
  return (
    <Tr>
      <Td className="text-text-body">
        <div className="text-sm">{charge.description ?? humanizeType(charge.type)}</div>
        <div className="text-text-faint mt-0.5 font-mono text-[11px] tracking-wide uppercase">
          {charge.type.toLowerCase().replace(/_/g, ' ')} · {charge.status.toLowerCase()}
        </div>
      </Td>
      <Td align="right">
        <Money amount={charge.totalAmountInr} />
      </Td>
    </Tr>
  );
}

function humanizeType(type: string): string {
  return type
    .toLowerCase()
    .split('_')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ');
}
