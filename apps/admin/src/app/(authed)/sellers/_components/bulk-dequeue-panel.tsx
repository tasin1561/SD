'use client';

import { useState, type ReactElement } from 'react';
import { PhoneOff } from 'lucide-react';
// The legacy toast on purpose: the component test mounts this panel
// under the legacy <Toaster> only, and the shell mounts both.
import { useToast } from '@skydrop/ui/components';
import { Button } from '@skydrop/ui/app/button';
import { ConfirmDialog } from '@skydrop/ui/app/dialog';
import { TextArea } from '@skydrop/ui/app/text-field';
import { AcCard } from '../../settings/_components/ac-parts';
import { useBulkDequeue } from '@/lib/callcenter-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { usePermission } from '@/lib/use-permission';

/**
 * Close every OPEN call-queue entry for one seller.
 *
 * Sits beside the account hold because the two are reached for together:
 * a seller who has stopped trading, or whose orders should not be phoned
 * for a while, keeps agents dialling customers until somebody clears
 * the queue. It closes the ENTRIES only — the orders stay where they are
 * (no attempt is recorded, CC-1), and confirmed orders are untouched.
 * Any later move into PENDING_CONFIRMATION re-queues an order (CC-6).
 *
 * Gated on `callcenter.queue.manage`, the permission the endpoint
 * demands; cosmetic only (FE-2). The reason's length rule is the
 * server's and its refusal is shown verbatim.
 */
export function BulkDequeuePanel({
  sellerId,
  sellerName,
}: {
  readonly sellerId: string;
  readonly sellerName: string;
}): ReactElement | null {
  const canManage = usePermission('callcenter.queue.manage');
  const dequeue = useBulkDequeue();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canManage) return null;

  async function submit(): Promise<void> {
    setError(null);
    try {
      const res = await dequeue.mutateAsync({ sellerId, reason: reason.trim() });
      toast.success(
        res.dequeuedOrders === 0
          ? 'Nothing to close: this seller had no open call-queue entries.'
          : `Closed ${res.dequeuedOrders} open call-queue ${res.dequeuedOrders === 1 ? 'entry' : 'entries'}.`,
      );
      setConfirming(false);
      setReason('');
    } catch (err) {
      setError(serverVerdict(err));
      // Rethrown so the confirm step stays open with the verdict on it.
      throw err;
    }
  }

  return (
    <AcCard
      title="Call queue"
      note="Stop agents calling this seller's customers. Closes every open queue entry; the orders themselves do not move, and confirmed orders are untouched."
    >
      <div className="ac-form">
        <TextArea
          label="Reason (recorded in the audit log)"
          id="bulk-dequeue-reason"
          requiredMark
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Seller paused trading until their stock arrives"
        />
        <div className="ac-buttons" data-align="start">
          <Button
            variant="secondary"
            size="sm"
            icon={<PhoneOff size={14} />}
            disabled={reason.trim() === ''}
            onClick={() => {
              setError(null);
              setConfirming(true);
            }}
          >
            Close all open queue entries
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Close ${sellerName}'s call queue?`}
        entity={sellerName}
        consequence="Every open call-queue entry for this seller is closed now. Agents stop being handed these orders; the orders stay in their current status until something else moves them."
        confirmLabel="Close entries"
        destructive
        error={error}
        closeOnSuccess={false}
        onConfirm={submit}
      >
        <p className="ac-muted">Reason: {reason.trim()}</p>
      </ConfirmDialog>
    </AcCard>
  );
}
