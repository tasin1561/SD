'use client';

import { useState, type ReactElement } from 'react';
import { Button, Modal, FormField, ErrorNote, useToast } from '@skydrop/ui/components';
import { useRequestReturn } from '@/lib/api-hooks';
import { serverVerdict } from '@/lib/server-verdict';

/**
 * Ask for a delivered parcel back.
 *
 * ── WHAT THE COPY HAS TO SAY, AND WHY ────────────────────────────────
 * This is not a cancel and not an RTO — the customer HAS the goods and
 * they are coming back on purpose, which means the parcel travels the
 * whole distance a second time and the seller pays for it. Saying that
 * plainly, with the number, before the button is the difference between
 * a decision and a surprise on the next wallet statement.
 *
 * The reason is required and is not a formality: the warehouse reads it
 * when the parcel lands, and "damaged" versus "changed their mind"
 * decides whether the stock goes back on the shelf.
 */
export function RequestReturnDialog({
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
  const request = useRequestReturn(orderId);
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
      },
    );
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="Bring this parcel back?"
    >
      <div className="flex flex-col gap-3">
        <p className="text-text-muted text-sm leading-relaxed">
          The courier collects it from your customer and brings it to our warehouse. It travels the
          same distance again, so it is charged as a second delivery —{' '}
          <span className="text-text-bright font-medium">₹200</span> on top of the delivery you
          already paid. Nothing is charged until the parcel actually arrives.
        </p>
        <p className="text-text-faint text-xs">
          Stock goes back on the shelf once the warehouse has checked it. If it comes back damaged
          it is written off instead, and you will see that on the order.
        </p>

        <FormField
          label="Why is it coming back?"
          hint="The warehouse reads this when it arrives — it decides whether the stock can be resold."
        >
          <textarea
            className="sd-field min-h-20"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Damaged product / quality not as expected / customer changed their mind…"
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
