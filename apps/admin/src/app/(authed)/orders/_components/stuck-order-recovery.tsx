'use client';

import { useState, type ReactElement } from 'react';
import { Button, Card, CardBody, ErrorNote, useToast } from '@skydrop/ui/components';
import { serverVerdict } from '@/lib/server-verdict';
import { usePermission } from '@/lib/use-permission';
import { useRetryStock, useReturnToPick } from '@/lib/api-hooks';

/**
 * The way out of the two states an order could enter and never leave.
 *
 * ── OUT_OF_STOCK ─────────────────────────────────────────────────────
 * A call agent confirms, the reserve fails, the order lands here — and
 * on the way out of PENDING_CONFIRMATION it is dequeued from the call
 * queue. The matrix has carried OUT_OF_STOCK → CONFIRMED since M6 and
 * the schema comment promises "Module 7 retries", but nothing drove it.
 * However much stock arrived afterwards, the only exits were cancel and
 * god-mode.
 *
 * Retrying is always safe: RESERVE_STOCK is the check, and its failure
 * route is OUT_OF_STOCK, which is where the order already is. So the
 * worst outcome of pressing this is that nothing changes.
 *
 * ── PENDING_MANUAL_PLACEMENT after a pick shortfall ──────────────────
 * Manual placement refuses to dispatch an order that was never picked
 * (MANUAL_PLACEMENT_NOT_ALLOCATED) and tells the operator to "route it
 * back to PENDING_PICK and re-pick". Nothing implemented that: the pick
 * queue selects only CONFIRMED and PENDING_PICK, so the parcel could not
 * even be re-pulled. The instruction and its implementation now both
 * exist.
 *
 * Shown for both states, because from the outside the two shapes of
 * PENDING_MANUAL_PLACEMENT are indistinguishable — an AWB-rejected order
 * is fully picked and should be placed manually, a shortfall one must go
 * back. Rather than guess, both actions are offered and the SERVER
 * decides: placing refuses the shortfall case, and this refuses nothing
 * because returning a picked order to the floor is merely wasteful, not
 * unsafe.
 */
export function StuckOrderRecovery({
  orderId,
  orderStatus,
}: {
  readonly orderId: string;
  readonly orderStatus: string;
}): ReactElement | null {
  const toast = useToast();
  // Cosmetic (FE-2). /orders is gated on orders.view; these two write.
  const mayAct = usePermission('orders.cancel');
  const retry = useRetryStock(orderId);
  const returnToPick = useReturnToPick(orderId);
  const [error, setError] = useState<string | null>(null);

  const isOutOfStock = orderStatus === 'OUT_OF_STOCK';
  const isManualPlacement = orderStatus === 'PENDING_MANUAL_PLACEMENT';

  if (!mayAct) return null;
  if (!isOutOfStock && !isManualPlacement) return null;

  async function onRetry(): Promise<void> {
    setError(null);
    try {
      const r = await retry.mutateAsync();
      // The landing state comes from the server: the reserve saga decides
      // whether this became CONFIRMED or bounced straight back.
      toast.success(
        r.status === 'OUT_OF_STOCK'
          ? 'Still nothing to reserve — the order stays out of stock.'
          : `Stock reserved. Order is now ${r.status}.`,
      );
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  async function onReturn(): Promise<void> {
    setError(null);
    try {
      const r = await returnToPick.mutateAsync();
      toast.success(`Back on the pick floor — order is now ${r.status}.`);
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  return (
    <Card className="mb-4">
      <CardBody>
        <h2 className="text-text-bright mb-1 text-sm font-medium">
          {isOutOfStock ? 'Waiting on stock' : 'Stuck at manual placement'}
        </h2>
        <p className="text-text-muted mb-3 text-sm">
          {isOutOfStock
            ? 'The call was confirmed but there was nothing to reserve. Retry once the stock has landed — if there is still none, the order simply stays here.'
            : 'If this order was never picked, manual placement will refuse it. Send it back to the pick floor and it can be picked normally.'}
        </p>

        {error !== null && <ErrorNote message={error} />}

        <div className="flex flex-wrap gap-2">
          {isOutOfStock && (
            <Button
              variant="primary"
              size="md"
              disabled={retry.isPending}
              onClick={() => void onRetry()}
            >
              {retry.isPending ? 'Retrying…' : 'Retry — stock has arrived'}
            </Button>
          )}
          {isManualPlacement && (
            <Button
              variant="secondary"
              size="md"
              disabled={returnToPick.isPending}
              onClick={() => void onReturn()}
            >
              {returnToPick.isPending ? 'Returning…' : 'Send back to the pick floor'}
            </Button>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
