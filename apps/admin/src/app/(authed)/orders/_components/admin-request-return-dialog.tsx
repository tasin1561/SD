'use client';

import { useState, type ReactElement } from 'react';
import { Undo2 } from 'lucide-react';
import { Button } from '@skydrop/ui/app/button';
import { Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { TextArea } from '@skydrop/ui/app/text-field';
import { useToast } from '@skydrop/ui/app/toast';
import './order-ops.css';
import { useAdminRequestReturn } from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { useT } from '@/i18n/client';

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
  const t = useT();
  const request = useAdminRequestReturn(orderId);
  const toast = useToast();
  const [reason, setReason] = useState('');

  function submit(): void {
    request.mutate(
      { reason },
      {
        onSuccess: (r) => {
          // The request succeeding and the COLLECTION being booked are
          // two different facts, and only one of them puts a van on the
          // road. Reporting the first as if it were both would leave
          // goods with a customer nobody is coming for, and the order
          // saying they are on their way back.
          if (r.collectionBookingFailed !== null) {
            toast.error(
              `${orderNumber} is marked as returning, but the courier did NOT take the collection: ${r.collectionBookingFailed} — arrange it by hand.`,
            );
          } else {
            toast.success(
              r.alreadyRequested
                ? t('ordersAdminRequestReturnDialog.wasAlreadyComingBack', { orderNumber })
                : `Return booked for ${orderNumber}${r.reverseAwbNumber === null ? '' : ` · pickup ${r.reverseAwbNumber}`}.`,
            );
          }
          setReason('');
          onClose();
        },
        onError: (err) => toast.error(serverVerdict(err)),
      },
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      icon={<Undo2 size={18} />}
      title={
        <>
          Bring <span className="sk-ident">{orderNumber}</span> back?
        </>
      }
      footer={
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            {t('ordersAdminRequestReturnDialog.cancel')}
          </Button>
          <Button
            variant="primary"
            onClick={submit}
            loading={request.isPending}
            disabled={request.isPending || reason.trim().length < 5}
          >
            {t('ordersAdminRequestReturnDialog.requestReturn')}
          </Button>
        </DialogFooter>
      }
    >
      <div className="oo-stack oo-stack--tight">
        <p className="oo-p">
          The courier collects it from the customer and returns it to the warehouse. It travels the
          same distance again, so{' '}
          <span className="oo-strong">
            {t('ordersAdminRequestReturnDialog.theClientIsCharged200')}
          </span>{' '}
          — a second delivery, on top of the one they already paid. Charged when the parcel arrives,
          not now.
        </p>

        <TextArea
          label={t('ordersAdminRequestReturnDialog.whyIsItComingBack')}
          hint={t('ordersAdminRequestReturnDialog.theWarehouseReadsThisOn')}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          rows={3}
        />

        {request.isError && (
          <p className="oo-error" role="alert">
            {serverVerdict(request.error)}
          </p>
        )}
      </div>
    </Dialog>
  );
}
