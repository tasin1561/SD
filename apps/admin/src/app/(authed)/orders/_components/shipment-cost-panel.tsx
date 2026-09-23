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
      setError('Enter at least one figure');
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

  const entity = awbNumber ?? shipmentNumber ?? 'This parcel';

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        icon={<ReceiptIndianRupee size={14} />}
        onClick={() => setOpen(true)}
      >
        Record courier cost
      </Button>

      <Dialog
        open={open && !confirming}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setError(null);
        }}
        icon={<ReceiptIndianRupee size={18} />}
        title="What did this parcel cost us?"
        description="From the courier's invoice. Feeds the delivery and returns margins; changes nothing the seller was billed."
        footer={
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={review} disabled={record.isPending}>
              Save
            </Button>
          </DialogFooter>
        }
      >
        <div className="os-fields">
          <TextField
            label="Delivery cost (INR)"
            hint="What they charged to take it out"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={forward}
            onChange={(e) => setForward(e.target.value)}
            placeholder="0.00"
          />
          <TextField
            label="Return cost (INR)"
            hint={
              wasReturned
                ? 'What they charged to bring it back. The delivery deduction is refunded on a return, so this is the whole cost of the parcel.'
                : 'Only if it came back. Leave blank otherwise.'
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
        title="Record this courier cost?"
        entity={entity}
        entityIsIdentifier={awbNumber !== null && awbNumber !== undefined}
        amount={
          <span className="oo-stack oo-stack--tight">
            {forward.trim() !== '' && (
              <span>
                Delivery <Money amount={Number(forward).toFixed(2)} />
              </span>
            )}
            {rto.trim() !== '' && (
              <span>
                Return <Money amount={Number(rto).toFixed(2)} />
              </span>
            )}
          </span>
        }
        consequence="The P&L reads this cost as what the parcel cost us to carry; nothing the seller was billed changes."
        confirmLabel="Save the cost"
        onConfirm={save}
        error={confirming ? (error ?? undefined) : undefined}
      />
    </>
  );
}
