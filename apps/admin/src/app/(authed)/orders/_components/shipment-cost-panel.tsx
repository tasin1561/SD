'use client';

import { useState, type ReactElement } from 'react';
import { Button, FormField, Input, Modal, ModalFooter } from '@skydrop/ui/components';
import { useRecordShipmentCost } from '@/lib/ops-hooks';
import { usePermission } from '@/lib/use-permission';
import { serverVerdict } from '@/lib/server-verdict';

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
 */
export function ShipmentCostPanel({
  shipmentId,
  wasReturned,
}: {
  readonly shipmentId: string;
  readonly wasReturned: boolean;
}): ReactElement | null {
  const canWrite = usePermission('money.treasury.manage');
  const record = useRecordShipmentCost();
  const [open, setOpen] = useState(false);
  const [forward, setForward] = useState('');
  const [rto, setRto] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!canWrite) return null;

  async function save(): Promise<void> {
    setError(null);
    if (forward.trim() === '' && rto.trim() === '') {
      setError('Enter at least one figure');
      return;
    }
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
    }
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Record courier cost
      </Button>

      <Modal
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setError(null);
        }}
        title="What did this parcel cost us?"
        description="From the courier's invoice. Feeds the delivery and returns margins; changes nothing the seller was billed."
      >
        <div className="space-y-3">
          <FormField label="Delivery cost (INR)" hint="What they charged to take it out">
            <Input
              type="number"
              step="0.01"
              min="0"
              value={forward}
              onChange={(e) => setForward(e.target.value)}
              placeholder="0.00"
            />
          </FormField>
          <FormField
            label="Return cost (INR)"
            hint={
              wasReturned
                ? 'What they charged to bring it back. The delivery deduction is refunded on a return, so this is the whole cost of the parcel.'
                : 'Only if it came back. Leave blank otherwise.'
            }
          >
            <Input
              type="number"
              step="0.01"
              min="0"
              value={rto}
              onChange={(e) => setRto(e.target.value)}
              placeholder="0.00"
            />
          </FormField>
        </div>
        {error !== null && <p className="text-danger mt-2 text-sm">{error}</p>}
        <ModalFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={record.isPending}>
            {record.isPending ? 'Saving…' : 'Save'}
          </Button>
        </ModalFooter>
      </Modal>
    </>
  );
}
