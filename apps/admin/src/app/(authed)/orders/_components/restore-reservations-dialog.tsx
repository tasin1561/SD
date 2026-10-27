'use client';

import { useState, type ReactElement } from 'react';
import { type RestoreReservationsResult } from '@skydrop/api-client';
import { useRestoreReservations } from '@/lib/api-hooks';
import { ConfirmDialog } from '@skydrop/ui/app/dialog';
import { TextArea } from '@skydrop/ui/app/text-field';
import { serverVerdict } from '@/lib/server-verdict';
import { useT } from '@/i18n/client';

/**
 * The mirror of the release beside it: giving a committed order back a
 * stock claim it lost.
 *
 * Until 2026-09-08 the reservation TTL sweep expired ANY reservation
 * past its date without looking at the order, so an order already at
 * CONFIRMED or beyond lost its claim while staying in the queue —
 * SD-2026-26-000003 reached a pick batch that way and printed a sheet
 * with one parcel and no lines. The sweep is fixed; the orders it
 * already happened to stay unpickable until somebody gives the stock
 * back.
 *
 * NOT idempotent, unlike the release, and deliberately so: the server
 * refuses an order that already holds a claim rather than adding a
 * second one for the same goods.
 */
export function RestoreReservationsDialog({
  open,
  onOpenChange,
  orderId,
  orderNumber,
  onSuccess,
}: {
  readonly open: boolean;
  readonly onOpenChange: (o: boolean) => void;
  readonly orderId: string;
  /** Restated in the confirm; the id stands in when it is not passed. */
  readonly orderNumber?: string | undefined;
  readonly onSuccess: (result: RestoreReservationsResult) => void;
}): ReactElement {
  const t = useT();
  const [reason, setReason] = useState('');
  const [serverError, setServerError] = useState<string | null>(null);
  const restore = useRestoreReservations(orderId);

  function close(): void {
    setReason('');
    setServerError(null);
    onOpenChange(false);
  }

  async function confirm(): Promise<void> {
    setServerError(null);
    try {
      const result = await restore.mutateAsync({
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      onSuccess(result);
      setReason('');
    } catch (err) {
      setServerError(
        serverVerdict(err, t('ordersRestoreReservationsDialog.failedToRestoreReservations')),
      );
      throw err;
    }
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) close();
      }}
      title={t('ordersRestoreReservationsDialog.restoreThisOrderSStock')}
      entity={orderNumber ?? orderId}
      entityIsIdentifier
      consequence={t('ordersRestoreReservationsDialog.stockIsReReservedFor')}
      confirmLabel={t('ordersRestoreReservationsDialog.restoreStockClaim')}
      destructive={false}
      onConfirm={confirm}
      error={serverError}
    >
      <TextArea
        id="restore-reason"
        label={t('ordersRestoreReservationsDialog.reasonOptional')}
        hint={t('ordersRestoreReservationsDialog.recordedInTheAuditLog')}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={t('ordersRestoreReservationsDialog.eGReservationExpiredBy')}
        disabled={restore.isPending}
      />
    </ConfirmDialog>
  );
}
