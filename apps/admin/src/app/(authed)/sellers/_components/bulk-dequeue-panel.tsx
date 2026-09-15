'use client';

import { useState, type ReactElement } from 'react';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  ErrorNote,
  FormField,
  Modal,
  ModalFooter,
  Textarea,
  useToast,
} from '@skydrop/ui/components';
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
    }
  }

  return (
    <Card>
      <CardHeader
        title="Call queue"
        subtitle="Stop agents calling this seller's customers. Closes every open queue entry; the orders themselves do not move, and confirmed orders are untouched."
      />
      <CardBody>
        <div className="space-y-3">
          <FormField
            label="Reason (recorded in the audit log)"
            htmlFor="bulk-dequeue-reason"
            required
          >
            <Textarea
              id="bulk-dequeue-reason"
              className="max-w-none"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Seller paused trading until their stock arrives"
            />
          </FormField>
          <Button
            variant="secondary"
            size="sm"
            disabled={reason.trim() === ''}
            onClick={() => {
              setError(null);
              setConfirming(true);
            }}
          >
            Close all open queue entries
          </Button>
        </div>
      </CardBody>

      <Modal
        open={confirming}
        onOpenChange={setConfirming}
        title={`Close ${sellerName}'s call queue?`}
      >
        <p className="text-text-body text-sm">
          Every open call-queue entry for <strong>{sellerName}</strong> is closed now. Agents stop
          being handed these orders; the orders stay in their current status until something else
          moves them.
        </p>
        <p className="text-text-muted mt-2 text-xs">Reason: {reason.trim()}</p>
        {error !== null && (
          <div className="mt-3">
            <ErrorNote message={error} />
          </div>
        )}
        <ModalFooter>
          <Button variant="ghost" size="md" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="md"
            disabled={dequeue.isPending}
            onClick={() => void submit()}
          >
            {dequeue.isPending ? 'Closing…' : 'Close entries'}
          </Button>
        </ModalFooter>
      </Modal>
    </Card>
  );
}
