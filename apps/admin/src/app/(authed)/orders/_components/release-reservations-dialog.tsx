'use client';

import { useState, type ReactElement } from 'react';
import { type ReleaseReservationsResult } from '@skydrop/api-client';
import { useReleaseReservations } from '@/lib/api-hooks';
import { ConfirmDialog } from '@skydrop/ui/app/dialog';
import { TextArea } from '@skydrop/ui/app/text-field';
import { serverVerdict } from '@/lib/server-verdict';

/**
 * God-mode cleanup companion. When forceMutate() moves an order
 * AWAY from CONFIRMED, any active reservations are deliberately left
 * intact (god mode opts out of compensation). This action is the
 * sanctioned cleanup path; the API is idempotent — running it
 * multiple times releases nothing extra.
 *
 * Audited HIGH (one level below the force-mutate CRITICAL).
 */
export function ReleaseReservationsDialog({
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
  readonly onSuccess: (result: ReleaseReservationsResult) => void;
}): ReactElement {
  const [reason, setReason] = useState('');
  const [serverError, setServerError] = useState<string | null>(null);
  const release = useReleaseReservations(orderId);

  function close(): void {
    setReason('');
    setServerError(null);
    onOpenChange(false);
  }

  async function confirm(): Promise<void> {
    setServerError(null);
    try {
      const result = await release.mutateAsync({
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      onSuccess(result);
      setReason('');
    } catch (err) {
      setServerError(serverVerdict(err, 'Failed to release reservations.'));
      throw err;
    }
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) close();
      }}
      title="Release order reservations"
      entity={orderNumber ?? orderId}
      entityIsIdentifier
      consequence="God-mode cleanup: every ACTIVE reservation tied to this order is released. Idempotent — safe to retry."
      confirmLabel="Release reservations"
      destructive={true}
      onConfirm={confirm}
      error={serverError}
    >
      <TextArea
        id="release-reason"
        label="Reason (optional)"
        hint="Recorded in the audit log + order event. Audited HIGH."
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="e.g., Cleanup after force-mutation away from CONFIRMED."
        disabled={release.isPending}
      />
    </ConfirmDialog>
  );
}
