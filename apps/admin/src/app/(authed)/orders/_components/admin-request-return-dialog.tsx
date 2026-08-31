'use client';

import { useState, type ReactElement } from 'react';
import { Button, ErrorNote, FormField, Modal, Textarea, useToast } from '@skydrop/ui/components';
import { useAdminRequestReturn } from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';

/**
 * Raise a customer return on a seller's behalf.
 *
 * The copy is blunter than the seller's because the person clicking is
 * not the person paying: an agent has to be able to see, before they
 * commit it, that this puts a charge on somebody else's account.
 */
export function AdminRequestReturnDialog({
  orderId,
  orderNumber,
  open,
  onClose,
}: {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly open: boolean;
  readonly onClose: () => void;
}): ReactElement {
  const request = useAdminRequestReturn(orderId);
  const toast = useToast();
  const [reason, setReason] = useState('');

  function submit(): void {
    request.mutate(
      { reason },
      {
        onSuccess: (r) => {
          toast.success(
            r.alreadyRequested
              ? `${orderNumber} was already coming back.`
              : `Return requested for ${orderNumber}.`,
          );
          setReason('');
          onClose();
        },
        onError: (err) => toast.error(serverVerdict(err)),
      },
    );
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={`Bring ${orderNumber} back?`}
    >
      <div className="flex flex-col gap-3">
        <p className="text-text-muted text-sm leading-relaxed">
          The courier collects it from the customer and returns it to the warehouse. It travels the
          same distance again, so{' '}
          <span className="text-text-bright font-medium">the seller is charged ₹200</span> — a
          second delivery, on top of the one they already paid. Charged when the parcel arrives, not
          now.
        </p>

        <FormField
          label="Why is it coming back?"
          hint="The warehouse reads this on arrival; it decides whether the stock can be resold."
        >
          <Textarea
            className="min-h-20"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
          />
        </FormField>

        {request.isError && <ErrorNote message={serverVerdict(request.error)} />}

        <div className="mt-1 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={submit}
            disabled={request.isPending || reason.trim().length < 5}
          >
            {request.isPending ? 'Requesting…' : 'Request return'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
