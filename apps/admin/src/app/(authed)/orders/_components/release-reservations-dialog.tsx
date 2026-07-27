'use client';

import { useState, type ReactElement } from 'react';
import { ApiError, type ReleaseReservationsResult } from '@skydrop/api-client';
import { useReleaseReservations } from '@/lib/api-hooks';
import { Button, FormField, Textarea, Modal, ModalFooter } from '@skydrop/ui/components';

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
  onSuccess,
}: {
  readonly open: boolean;
  readonly onOpenChange: (o: boolean) => void;
  readonly orderId: string;
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
        setServerError('Failed to release reservations.');
      }
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && close()}
      title="Release order reservations"
      description="God-mode cleanup. Releases every ACTIVE reservation tied to this order. Idempotent — safe to retry."
    >
      <div className="space-y-3">
        <FormField
          label="Reason (optional)"
          htmlFor="release-reason"
          hint="Recorded in the audit log + order event. Audited HIGH."
        >
          <Textarea
            id="release-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g., Cleanup after force-mutation away from CONFIRMED."
            disabled={release.isPending}
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
        <Button variant="ghost" size="md" onClick={close} disabled={release.isPending}>
          Cancel
        </Button>
        <Button
          variant="destructive"
          size="md"
          onClick={() => {
            void confirm();
          }}
          disabled={release.isPending}
        >
          {release.isPending ? 'Releasing…' : 'Release reservations'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
