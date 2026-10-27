'use client';

import { useState, type ReactElement } from 'react';
import { ReceiptIndianRupee } from 'lucide-react';
import { Money } from '@skydrop/ui/components';
import { Button } from '@skydrop/ui/app/button';
import { ConfirmDialog, Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { TextField } from '@skydrop/ui/app/text-field';
import { useRecordShipmentCost } from '@/lib/ops-hooks';
import { usePermission } from '@/lib/use-permission';
import { serverVerdict } from '@/lib/server-verdict';
import './order-shipping.css';
import { useT } from '@/i18n/client';

/**
 * What this parcel actually cost us.
 *
 * The lane-margin report fills the forward figure from Delhivery's
 * invoice API, but that is sampled and rate-limited, and the RETURN leg
 * has no equivalent at all. This is the manual path — somebody with an
 * invoice in front of them.
 *
 * Two separate figures on purpose. Delhivery refunds the delivery
 * deduction when a parcel comes back and bills an RTO fee instead, so a
 * return's cost is the RTO number and NOT that plus the forward one.
 * Entering it in one box would make the P&L charge the same carriage
 * twice.
 *
 * Saving now passes through a confirm that restates the parcel and the
 * figures typed: this writes our cost of carriage, which the P&L reads,
 * so it is checked before it is sent. The request itself is unchanged.
 */
export function ShipmentCostPanel({
  shipmentId,
  shipmentNumber,
  awbNumber,
  wasReturned,
}: {
  readonly shipmentId: string;
  /** For the confirm's restatement only. */
  readonly shipmentNumber?: string | undefined;
  readonly awbNumber?: string | null | undefined;
  readonly wasReturned: boolean;
}): ReactElement | null {
  const t = useT();
  const canWrite = usePermission('money.treasury.manage');
  const record = useRecordShipmentCost();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [forward, setForward] = useState('');
  const [rto, setRto] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!canWrite) return null;

  function review(): void {
    setError(null);
    if (forward.trim() === '' && rto.trim() === '') {
      setError(t('ordersShipmentCostPanel.enterAtLeastOneFigure'));
      return;
    }
    setConfirming(true);
  }

  async function save(): Promise<void> {
    setError(null);
    try {
      await record.mutateAsync({
        shipmentId,
        ...(forward.trim() === '' ? {} : { forwardCostInr: Number(forward).toFixed(2) }),
        ...(rto.trim() === '' ? {} : { rtoCostInr: Number(rto).toFixed(2) }),
      });
      setForward('');
      setRto('');
      setOpen(false);
    } catch (err) {
      setError(serverVerdict(err));
      // Keeps the confirm open with the verdict on it, to read and retry.
      throw err;
    }
  }

  const entity = awbNumber ?? shipmentNumber ?? t('ordersShipmentCostPanel.thisParcel');

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        icon={<ReceiptIndianRupee size={14} />}
        onClick={() => setOpen(true)}
      >
        {t('ordersShipmentCostPanel.recordCourierCost')}
      </Button>

      <Dialog
        open={open && !confirming}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setError(null);
        }}
        icon={<ReceiptIndianRupee size={18} />}
        title={t('ordersShipmentCostPanel.whatDidThisParcelCost')}
        description={t('ordersShipmentCostPanel.fromTheCourierSInvoice')}
        footer={
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {t('ordersShipmentCostPanel.cancel')}
            </Button>
            <Button variant="primary" onClick={review} disabled={record.isPending}>
              {t('ordersShipmentCostPanel.save')}
            </Button>
          </DialogFooter>
        }
      >
        <div className="os-fields">
          <TextField
            label={t('ordersShipmentCostPanel.deliveryCostInr')}
            hint={t('ordersShipmentCostPanel.whatTheyChargedToTake')}
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={forward}
            onChange={(e) => setForward(e.target.value)}
            placeholder="0.00"
          />
          <TextField
            label={t('ordersShipmentCostPanel.returnCostInr')}
            hint={
              wasReturned
                ? t('ordersShipmentCostPanel.whatTheyChargedToBring')
                : t('ordersShipmentCostPanel.onlyIfItCameBack')
            }
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={rto}
            onChange={(e) => setRto(e.target.value)}
            placeholder="0.00"
          />
          {error !== null && !confirming && (
            <p className="oo-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </Dialog>

      <ConfirmDialog
        open={confirming}
        onOpenChange={(next) => {
          setConfirming(next);
          if (!next) setError(null);
        }}
        title={t('ordersShipmentCostPanel.recordThisCourierCost')}
        entity={entity}
        entityIsIdentifier={awbNumber !== null && awbNumber !== undefined}
        amount={
          <span className="oo-stack oo-stack--tight">
            {forward.trim() !== '' && (
              <span>
                {t('ordersShipmentCostPanel.delivery')}{' '}
                <Money amount={Number(forward).toFixed(2)} />
              </span>
            )}
            {rto.trim() !== '' && (
              <span>
                {t('ordersShipmentCostPanel.return')} <Money amount={Number(rto).toFixed(2)} />
              </span>
            )}
          </span>
        }
        consequence={t('ordersShipmentCostPanel.thePLReadsThis')}
        confirmLabel={t('ordersShipmentCostPanel.saveTheCost')}
        onConfirm={save}
        error={confirming ? (error ?? undefined) : undefined}
      />
    </>
  );
}
