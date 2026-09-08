'use client';

import { useState, type ReactElement } from 'react';
import { ApiError, type RestoreReservationsResult } from '@skydrop/api-client';
import { useRestoreReservations } from '@/lib/api-hooks';
import { Button, FormField, Textarea, Modal, ModalFooter } from '@skydrop/ui/components';

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
  onSuccess,
}: {
  readonly open: boolean;
  readonly onOpenChange: (o: boolean) => void;
  readonly orderId: string;
  readonly onSuccess: (result: RestoreReservationsResult) => void;
}): ReactElement {
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
      close();
    } catch (err) {
      if (err instanceof ApiError && typeof err.body === 'object' && err.body !== null) {
        const b = err.body as { code?: unknown; message?: unknown };
        const code = typeof b.code === 'string' ? b.code : null;
        const msg = typeof b.message === 'string' ? b.message : err.message;
        setServerError(code ? `[${code}] ${msg}` : msg);
      } else if (err instanceof Error) {
        setServerError(err.message);
      } else {
        setServerError('Failed to restore reservations.');
      }
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && close()}
      title="Restore this order\u2019s stock claim"
      description="Re-reserves stock for an order that lost its claim to an expired reservation. Refused if the order already holds one, or if it is past packing. All or nothing: on a shortfall nothing is reserved."
    >
      <div className="space-y-3">
        <FormField
          label="Reason (optional)"
          htmlFor="restore-reason"
          hint="Recorded in the audit log + order event. Audited HIGH."
        >
          <Textarea
            id="restore-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g., Reservation expired by the TTL sweep before the fix; order still needs picking."
            disabled={restore.isPending}
          />
        </FormField>
        {serverError && (
          <div
            className="px-2.5 py-1.5 rounded-[5px] text-critical text-xs"
            style={{
              background: 'var(--color-critical-tint)',
              border: '1px solid var(--color-critical-ring)',
            }}
          >
            {serverError}
          </div>
        )}
      </div>
      <ModalFooter>
        <Button variant="ghost" size="md" onClick={close} disabled={restore.isPending}>
          Cancel
        </Button>
        <Button
          // `secondary`, not `destructive`: this GIVES stock back to an
          // order rather than taking it away, and dressing it in the
          // colour of a dangerous action teaches people to hesitate over
          // the wrong one.
          variant="secondary"
          size="md"
          onClick={() => {
            void confirm();
          }}
          disabled={restore.isPending}
        >
          {restore.isPending ? 'Reserving…' : 'Restore stock claim'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
