'use client';

import { useState, type ReactElement } from 'react';
import { PauseCircle } from 'lucide-react';
import { useToast } from '@skydrop/ui/app/toast';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { TextField } from '@skydrop/ui/app/text-field';
import { usePauseResellerStore } from '@/lib/reseller-analysis-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { usePermission } from '@/lib/use-permission';
import { AcAlert } from '../../settings/_components/ac-parts';

/**
 * RS-9 — staff pause a reseller store (`reseller.stores.pause`). Shared by
 * the fraud-flag rows on /reseller-stores/analysis and the store's own
 * page. The gate here is COSMETIC and lives beside the call itself, so
 * every screen that opens this modal inherits it rather than each
 * remembering; the server owns every rule (the permission, reason length,
 * a store already paused…) and its verdict is shown verbatim (FE-2).
 */
export function PauseStoreModal({
  storeId,
  storeName,
  onClose,
}: {
  readonly storeId: string;
  readonly storeName: string;
  readonly onClose: () => void;
}): ReactElement {
  const toast = useToast();
  const mayPause = usePermission('reseller.stores.pause');
  const pause = usePauseResellerStore();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog
      open
      tone="critical"
      icon={<PauseCircle size={18} />}
      size="sm"
      locked={pause.isPending}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={`Pause “${storeName}”?`}
      description="It stops placing new orders now. Orders already placed carry on, and only its seller can resume it. The seller and the store read your reason."
      footer={
        <DialogFooter>
          <Button type="button" variant="secondary" size="md" onClick={onClose}>
            Cancel
          </Button>
          <AsyncButton
            type="button"
            variant="destructive"
            size="md"
            icon={<PauseCircle size={15} />}
            state={pause.isPending ? 'busy' : error !== null ? 'error' : 'idle'}
            labels={{ idle: 'Pause', busy: 'Pausing…', error: 'Not paused' }}
            disabled={pause.isPending || !mayPause}
            onClick={() => {
              setError(null);
              pause.mutate(
                { storeId, reason },
                {
                  onSuccess: () => {
                    toast.success('Paused.');
                    onClose();
                  },
                  onError: (err) => setError(serverVerdict(err)),
                },
              );
            }}
          />
        </DialogFooter>
      }
    >
      <div className="ac-form">
        <TextField
          label="Why"
          id="pause-reason"
          requiredMark
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        {mayPause ? null : (
          <p className="ac-muted">
            Pausing a store needs the “reseller.stores.pause” permission. Its seller can pause it
            themselves.
          </p>
        )}
        {error !== null ? <AcAlert message={error} /> : null}
      </div>
    </Dialog>
  );
}
