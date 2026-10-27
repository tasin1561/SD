'use client';

import { useState, type ReactElement } from 'react';
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '@skydrop/auth/client';
import { Unlock } from 'lucide-react';
import { Button } from '@skydrop/ui/app/button';
import { Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { SectionHeading } from '@skydrop/ui/app/page-header';
import { TextField } from '@skydrop/ui/app/text-field';
import '../../_components/benches.css';
import { serverVerdict } from '@/lib/server-verdict';
import { useT } from '@/i18n/client';

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
  const t = useT();
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
    <section className="wh-card wh-stack">
      <SectionHeading
        title={t('warehousePickForceExpire.stuckPick')}
        note={t('warehousePickForceExpire.releaseAClaimAPicker')}
        action={
          <Button variant="secondary" size="md" onClick={() => setOpen(true)}>
            {t('warehousePickForceExpire.releaseAStuckPick')}
          </Button>
        }
      />

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) close();
        }}
        title={t('warehousePickForceExpire.releaseAStuckPickClaim')}
        description={t('warehousePickForceExpire.handsTheShipmentBackTo')}
        icon={<Unlock size={18} />}
        footer={
          <DialogFooter>
            <Button variant="secondary" size="md" onClick={close}>
              {result === null
                ? t('warehousePickForceExpire.cancel')
                : t('warehousePickForceExpire.done')}
            </Button>
            {result === null && (
              <Button
                size="md"
                disabled={shipmentId.trim() === '' || expire.isPending}
                onClick={() =>
                  expire.mutate(
                    { shipmentId: shipmentId.trim() },
                    { onSuccess: (r) => setResult(r) },
                  )
                }
              >
                {expire.isPending
                  ? t('warehousePickForceExpire.releasing')
                  : t('warehousePickForceExpire.release')}
              </Button>
            )}
          </DialogFooter>
        }
      >
        <div className="wh-stack">
          <TextField
            id="fe-shipment"
            label={t('warehousePickForceExpire.shipmentId')}
            hint={t('warehousePickForceExpire.fromTheOrderSShipments')}
            inputClassName="sk-ident"
            value={shipmentId}
            onChange={(e) => {
              setShipmentId(e.target.value);
              setResult(null);
            }}
          />

          <p className="wh-faint">{t('warehousePickForceExpire.safeToRunTwiceAnd')}</p>

          {expire.error !== null && (
            <div role="alert" className="wh-alert">
              {serverVerdict(expire.error)}
            </div>
          )}
          {result !== null &&
            (result.expired ? (
              <p className="wh-good">{t('warehousePickForceExpire.releasedTheShipmentIsBack')}</p>
            ) : (
              <p className="wh-note">{t('warehousePickForceExpire.nothingToReleaseEitherIt')}</p>
            ))}
        </div>
      </Dialog>
    </section>
  );
}
