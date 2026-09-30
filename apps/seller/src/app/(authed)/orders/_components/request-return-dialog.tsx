'use client';

import { useState, type ReactElement } from 'react';
import { OctagonX, Undo2 } from 'lucide-react';
import { Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { TextArea } from '@skydrop/ui/app/text-field';
import { useToast } from '@skydrop/ui/app/toast';
import { Notice } from './orders-parts';
import { useRequestReturn, useSellerFees } from '@/lib/api-hooks';
import { feeOfKind } from '@/lib/fee-figure';
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
 *
 * THE FIGURE IS READ, NOT TYPED. It used to be the literal `₹200` in
 * this paragraph — right for the seeded default of
 * `pricing.customer_return_fee`, wrong for any seller who negotiated one
 * and wrong for everybody the day the default moves (which is exactly
 * what happened to the delivery fee on 2026-09-20: ₹200 became ৳200 and
 * nothing on any screen changed). It now comes from the engine that will
 * take the money, priced at the moment this opens. When it cannot be
 * priced the sentence falls back to prose rather than printing a zero.
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
  // Only while the dialog is up: a fee nobody is about to spend is not
  // worth a request on every order page.
  const fees = useSellerFees(open);
  const fee = feeOfKind(fees.data?.items, 'customerReturn');
  const toast = useToast();
  const [reason, setReason] = useState('');

  function submit(): void {
    request.mutate(
      { reason },
      {
        onSuccess: (r) => {
          // Two different facts, and only one of them puts a van on the
          // road. A seller told "requested" when nothing was booked
          // would wait for a collection nobody arranged.
          if (r.collectionBookingFailed !== null) {
            toast.error(
              `${orderNumber} is marked as returning, but we could not book the collection yet: ${r.collectionBookingFailed} We are on it — you do not need to do anything.`,
            );
          } else {
            toast.success(
              r.alreadyRequested
                ? `${orderNumber} was already coming back.`
                : `Collection booked for ${orderNumber}${r.reverseAwbNumber === null ? '' : ` · ${r.reverseAwbNumber}`}.`,
            );
          }
          setReason('');
          onClose();
        },
      },
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="Bring this parcel back?"
      icon={<Undo2 size={18} />}
      locked={request.isPending}
      footer={
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={request.isPending}>
            Cancel
          </Button>
          <AsyncButton
            variant="primary"
            state={request.isPending ? 'busy' : undefined}
            labels={{ idle: 'Request return', busy: 'Requesting…' }}
            onClick={submit}
            disabled={request.isPending || reason.trim().length < 5}
          />
        </DialogFooter>
      }
    >
      <div className="ord-stack ord-stack--tight">
        {/* The order it is about, restated: a return books a real
            collection and a second delivery charge. */}
        <div className="sk-confirm__subject">
          <span className="sk-confirm__entity sk-ident">{orderNumber}</span>
        </div>
        <p className="ord-p">
          The courier collects it from your customer and brings it to our warehouse. It travels the
          same distance again, so it is charged as a second delivery
          {fee === null ? (
            <> on top of the delivery you already paid</>
          ) : (
            <>
              {' — '}
              <span className="ord-strong">{fee.primary}</span>
              {fee.agreed === null ? null : <> (agreed as {fee.agreed})</>} on top of the delivery
              you already paid
            </>
          )}
          . Nothing is charged until the parcel actually arrives.
        </p>
        {fee !== null && !fee.priced && (
          <p className="ord-faint">
            That is the figure we agreed with you. What leaves your wallet is its value in rupees on
            the day the parcel arrives.
          </p>
        )}
        <p className="ord-faint">
          Stock goes back on the shelf once the warehouse has checked it. If it comes back damaged
          it is written off instead, and you will see that on the order.
        </p>

        <TextArea
          label="Why is it coming back?"
          hint="The warehouse reads this when it arrives — it decides whether the stock can be resold."
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Damaged product / quality not as expected / customer changed their mind…"
          maxLength={500}
          rows={3}
        />

        {request.isError && (
          <Notice tone="bad" role="alert" icon={<OctagonX size={16} />}>
            <span>{serverVerdict(request.error)}</span>
          </Notice>
        )}
      </div>
    </Dialog>
  );
}
