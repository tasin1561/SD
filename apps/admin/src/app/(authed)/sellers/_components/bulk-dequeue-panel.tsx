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
import { useT } from '@/i18n/client';

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
  const t = useT();
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
          ? t('sellersBulkDequeuePanel.nothingToCloseThisClient')
          : t('sellersBulkDequeuePanel.closedOpenCallQueue', {
              dequeuedOrders: res.dequeuedOrders,
              value:
                res.dequeuedOrders === 1
                  ? t('sellersBulkDequeuePanel.entry')
                  : t('sellersBulkDequeuePanel.entries'),
            }),
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
      title={t('sellersBulkDequeuePanel.callQueue')}
      note={t('sellersBulkDequeuePanel.stopAgentsCallingThisClient')}
    >
      <div className="ac-form">
        <TextArea
          label={t('sellersBulkDequeuePanel.reasonRecordedInTheAudit')}
          id="bulk-dequeue-reason"
          requiredMark
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t('sellersBulkDequeuePanel.eGClientPausedTrading')}
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
            {t('sellersBulkDequeuePanel.closeAllOpenQueueEntries')}
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('sellersBulkDequeuePanel.closeSCallQueue', { sellerName })}
        entity={sellerName}
        consequence={t('sellersBulkDequeuePanel.everyOpenCallQueueEntry')}
        confirmLabel={t('sellersBulkDequeuePanel.closeEntries')}
        destructive
        error={error}
        closeOnSuccess={false}
        onConfirm={submit}
      >
        <p className="ac-muted">{t('sellersBulkDequeuePanel.reason', { value: reason.trim() })}</p>
      </ConfirmDialog>
    </AcCard>
  );
}
