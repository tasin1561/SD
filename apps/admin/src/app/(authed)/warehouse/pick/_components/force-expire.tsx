'use client';

import { useState, type ReactElement } from 'react';
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '@skydrop/auth/client';
import {
  Button,
  ErrorNote,
  FormField,
  Input,
  Modal,
  ModalFooter,
  Section,
} from '@skydrop/ui/components';
import { serverVerdict } from '@/lib/server-verdict';

/**
 * Release a stuck pick claim (WMS-5 supervisor override).
 *
 * A picker who claims a shipment and then walks away holds it until the
 * expiry timer fires. Usually that is fine — the timer is short. When it
 * is not (a device died mid-pick, the claim outlived the shift), this is
 * the way to hand the work back without waiting.
 *
 * It runs the same time-based CAS as the automatic path, so it is
 * idempotent and cannot steal a claim someone has since re-pulled: if
 * the shipment was picked up again after the timestamp the job was
 * scheduled for, this no-ops rather than yanking it from whoever is
 * holding it now. That property is why it is safe to expose at all.
 */

interface PickExpireResult {
  expired: boolean;
  reason?: string | null;
}

function useForceExpirePick(): UseMutationResult<PickExpireResult, Error, { shipmentId: string }> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ shipmentId }) =>
      client.request<PickExpireResult>(`/api/admin/warehouse/picks/${shipmentId}/expire`, {
        method: 'POST',
        body: {},
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-picks'] }),
  });
}

export function ForceExpirePick(): ReactElement {
  const [open, setOpen] = useState(false);
  const [shipmentId, setShipmentId] = useState('');
  const [result, setResult] = useState<PickExpireResult | null>(null);
  const expire = useForceExpirePick();

  function close(): void {
    setOpen(false);
    setShipmentId('');
    setResult(null);
    expire.reset();
  }

  return (
    <Section title="Stuck pick" subtitle="Release a claim a picker is holding but not working.">
      <Button variant="ghost" size="md" onClick={() => setOpen(true)}>
        Release a stuck pick
      </Button>

      <Modal
        open={open}
        onOpenChange={(next) => {
          if (!next) close();
        }}
        title="Release a stuck pick claim"
        description="Hands the shipment back to the queue so another picker can take it."
      >
        <FormField
          label="Shipment id"
          htmlFor="fe-shipment"
          hint="From the order's shipments section."
        >
          <Input
            id="fe-shipment"
            value={shipmentId}
            onChange={(e) => {
              setShipmentId(e.target.value);
              setResult(null);
            }}
          />
        </FormField>

        <p className="text-text-faint text-xs">
          Safe to run twice, and it will not take a shipment away from a picker who has since
          claimed it — it checks the claim is still the one it expected before releasing.
        </p>

        {expire.error !== null && <ErrorNote message={serverVerdict(expire.error)} />}
        {result !== null && (
          <p className="text-sm">
            {result.expired ? (
              <span className="text-[var(--color-good)]">
                Released — the shipment is back in the pick queue.
              </span>
            ) : (
              <span className="text-text-muted">
                Nothing to release. Either it was never claimed, it is already finished, or someone
                has claimed it since.
              </span>
            )}
          </p>
        )}

        <ModalFooter>
          <Button variant="ghost" size="md" onClick={close}>
            {result === null ? 'Cancel' : 'Done'}
          </Button>
          {result === null && (
            <Button
              size="md"
              disabled={shipmentId.trim() === '' || expire.isPending}
              onClick={() =>
                expire.mutate({ shipmentId: shipmentId.trim() }, { onSuccess: (r) => setResult(r) })
              }
            >
              {expire.isPending ? 'Releasing…' : 'Release'}
            </Button>
          )}
        </ModalFooter>
      </Modal>
    </Section>
  );
}
