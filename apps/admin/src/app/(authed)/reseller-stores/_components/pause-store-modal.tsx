'use client';

import { useState, type ReactElement } from 'react';
import { Button, FormField, Input, Modal, ModalFooter, useToast } from '@skydrop/ui/components';
import { usePauseResellerStore } from '@/lib/reseller-analysis-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { usePermission } from '@/lib/use-permission';

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
    <Modal
      open
      tone="critical"
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={`Pause “${storeName}”?`}
      description="It stops placing new orders now. Orders already placed carry on, and only its seller can resume it. The seller and the store read your reason."
    >
      <div className="space-y-4">
        <FormField label="Why" htmlFor="pause-reason" required>
          <Input id="pause-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        </FormField>
        {mayPause ? null : (
          <p className="text-text-muted text-sm">
            Pausing a store needs the “reseller.stores.pause” permission. Its seller can pause it
            themselves.
          </p>
        )}
        {error !== null ? (
          <p role="alert" className="text-critical text-sm">
            {error}
          </p>
        ) : null}
        <ModalFooter>
          <Button type="button" variant="secondary" size="md" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="md"
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
          >
            {pause.isPending ? 'Pausing…' : 'Pause'}
          </Button>
        </ModalFooter>
      </div>
    </Modal>
  );
}
