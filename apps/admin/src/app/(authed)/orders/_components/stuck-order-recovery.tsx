'use client';

import { useState, type ReactElement } from 'react';
import { PackageSearch, RotateCcw } from 'lucide-react';
import { Button } from '@skydrop/ui/app/button';
import { ConfirmDialog } from '@skydrop/ui/app/dialog';
import { useToast } from '@skydrop/ui/app/toast';
import { Notice, OoCard } from './order-ops-parts';
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
  orderNumber,
}: {
  readonly orderId: string;
  readonly orderStatus: string;
  /** For the confirm's restatement; the id stands in when it is not passed. */
  readonly orderNumber?: string | undefined;
}): ReactElement | null {
  const toast = useToast();
  // Cosmetic (FE-2). /orders is gated on orders.view; these two write.
  const mayAct = usePermission('orders.cancel');
  const retry = useRetryStock(orderId);
  const returnToPick = useReturnToPick(orderId);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<'retry' | 'return' | null>(null);

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
      throw err;
    }
  }

  async function onReturn(): Promise<void> {
    setError(null);
    try {
      const r = await returnToPick.mutateAsync();
      toast.success(`Back on the pick floor — order is now ${r.status}.`);
    } catch (err) {
      setError(serverVerdict(err));
      throw err;
    }
  }

  const entity = orderNumber ?? orderId;

  return (
    <OoCard tone="warn">
      <Notice
        tone="warn"
        icon={isOutOfStock ? <PackageSearch size={16} /> : <RotateCcw size={16} />}
        title={isOutOfStock ? 'Waiting on stock' : 'Stuck at manual placement'}
      >
        <p>
          {isOutOfStock
            ? 'The call was confirmed but there was nothing to reserve. Retry once the stock has landed — if there is still none, the order simply stays here.'
            : 'If this order was never picked, manual placement will refuse it. Send it back to the pick floor and it can be picked normally.'}
        </p>
      </Notice>

      {error !== null && confirming === null && (
        <p className="oo-error" role="alert">
          {error}
        </p>
      )}

      <div className="oo-row">
        {isOutOfStock && (
          <Button
            variant="primary"
            size="md"
            loading={retry.isPending}
            onClick={() => {
              setError(null);
              setConfirming('retry');
            }}
          >
            Retry — stock has arrived
          </Button>
        )}
        {isManualPlacement && (
          <Button
            variant="secondary"
            size="md"
            loading={returnToPick.isPending}
            onClick={() => {
              setError(null);
              setConfirming('return');
            }}
          >
            Send back to the pick floor
          </Button>
        )}
      </div>

      <ConfirmDialog
        open={confirming === 'retry'}
        onOpenChange={(o) => {
          if (!o) setConfirming(null);
        }}
        title="Retry the stock reservation?"
        entity={entity}
        entityIsIdentifier
        consequence="The order is sent back to confirmed and stock is reserved for it if any has landed; if there is still none, it stays out of stock."
        confirmLabel="Retry — stock has arrived"
        onConfirm={onRetry}
        error={confirming === 'retry' ? error : null}
      />
      <ConfirmDialog
        open={confirming === 'return'}
        onOpenChange={(o) => {
          if (!o) setConfirming(null);
        }}
        title="Send this order back to the pick floor?"
        entity={entity}
        entityIsIdentifier
        consequence="The order leaves manual placement and goes back to pending pick, so the warehouse picks it again."
        confirmLabel="Send back to the pick floor"
        onConfirm={onReturn}
        error={confirming === 'return' ? error : null}
      />
    </OoCard>
  );
}
