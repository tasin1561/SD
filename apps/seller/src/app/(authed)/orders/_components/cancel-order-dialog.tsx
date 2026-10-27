'use client';

import { useState, type ReactElement } from 'react';
import { OctagonX, TriangleAlert, XCircle } from 'lucide-react';
import { Money } from '@skydrop/ui/components';
import { Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { TextField } from '@skydrop/ui/app/text-field';
import { useToast } from '@skydrop/ui/app/toast';
import { Notice } from './orders-parts';
import { useCancelOrder } from '@/lib/api-hooks';
import { verdict } from '@/i18n/verdict';
import { useT } from '@/i18n/client';
import { richMessage } from '@/i18n/rich';
import type { Translate } from '@skydrop/ui/app/i18n';
import type { MessageKey } from '@/i18n/catalog';

/**
 * Calling off an order.
 *
 * The dialog's job is to tell the seller what cancelling actually does
 * at THIS point in the order's life, because that changes: an order
 * nobody has touched is just filed away, a confirmed one gives its
 * stock back, and a picked one means someone has to walk the goods back
 * to the shelf. Presenting all three as one undifferentiated "are you
 * sure?" is how a seller cancels a picked order casually and only
 * learns the cost from a warehouse complaint.
 *
 * The money line is stated only when it is true (`chargedInr`), and it
 * is the reason this is not a plain confirm: the seller is owed
 * something back and should see the number before agreeing, not
 * discover it in the ledger afterwards.
 *
 * FE-2: every refusal below is the SERVER's. The button is offered on
 * the states the server accepts, but the server re-decides — including
 * the race this UI cannot see, where a packer opened the box while the
 * dialog was on screen.
 */

/** What cancelling costs the warehouse, by where the order has got to. */
function consequenceFor(t: Translate<MessageKey>, status: string): string | null {
  switch (status) {
    case 'DRAFT':
      return null;
    case 'PENDING_CONFIRMATION':
    case 'CALL_NO_RESPONSE':
    case 'CALL_RESCHEDULED':
    case 'AWAITING_SELLER_DECISION':
      return t('orderDialogs.itLeavesTheCall');
    case 'AWAITING_COURIER':
      return t('orderDialogs.noCourierHasBeen');
    case 'CONFIRMED':
    case 'OUT_OF_STOCK':
      return t('orderDialogs.theStockHeldFor');
    case 'PENDING_PICK':
      return t('orderDialogs.itComesOutOf');
    case 'PICKED':
    case 'PACK_FAILED':
      return t('orderDialogs.theGoodsHaveAlready');
    case 'PENDING_MANUAL_PLACEMENT':
      return t('orderDialogs.itComesOutOf2');
    default:
      return null;
  }
}

export function CancelOrderDialog({
  open,
  orderId,
  orderNumber,
  status,
  chargedInr,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly orderId: string;
  readonly orderNumber: string;
  readonly status: string;
  /** Delivery fee already taken for this order, if any. */
  readonly chargedInr?: string | null;
  readonly onOpenChange: (next: boolean) => void;
}): ReactElement {
  const t = useT();
  const toast = useToast();
  const cancel = useCancelOrder(orderId);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const consequence = consequenceFor(t, status);
  const heavy = status === 'PICKED' || status === 'PACK_FAILED';

  async function submit(): Promise<void> {
    setError(null);
    try {
      await cancel.mutateAsync(note.trim().length > 0 ? { note: note.trim() } : {});
      toast.success(t('orderDialogs.cancelled', { orderNumber }));
      onOpenChange(false);
      setNote('');
    } catch (err) {
      // Verbatim. "Someone is packing this order right now" is the
      // whole answer, and softening it into "could not cancel" would
      // send the seller to support for something that resolves itself.
      setError(verdict(err, t));
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setError(null);
          setNote('');
        }
        onOpenChange(next);
      }}
      title={t('orderDialogs.cancel', { orderNumber })}
      icon={heavy ? <TriangleAlert size={18} /> : <XCircle size={18} />}
      tone={heavy ? 'critical' : 'default'}
      size="sm"
      locked={cancel.isPending}
      footer={
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={cancel.isPending}>
            {t('orderDialogs.keepIt')}
          </Button>
          <AsyncButton
            variant="destructive"
            state={cancel.isPending ? 'busy' : undefined}
            labels={{ idle: t('orderDialogs.cancelThisOrder'), busy: t('orderDialogs.cancelling') }}
            onClick={() => void submit()}
          />
        </DialogFooter>
      }
    >
      <div className="ord-stack ord-stack--tight">
        <p className="ord-p">{t('orderDialogs.thisCannotBeUndone')}</p>

        {consequence !== null && (
          <Notice tone={heavy ? 'bad' : 'neutral'} icon={<TriangleAlert size={16} />}>
            <span>{consequence}</span>
          </Notice>
        )}

        {chargedInr != null && Number(chargedInr) > 0 && (
          <p className="ord-p">
            {richMessage(t('orderDialogs.theDeliveryFeeOf'), {
              span: (
                <span className="ord-strong">
                  <Money amount={chargedInr} />
                </span>
              ),
            })}
          </p>
        )}

        {error !== null && (
          <Notice tone="bad" role="alert" icon={<OctagonX size={16} />}>
            <span>{error}</span>
          </Notice>
        )}

        <TextField
          label={t('orderDialogs.reasonOptional')}
          hint={t('orderDialogs.keptOnTheOrder')}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t('orderDialogs.customerChangedTheirMind')}
        />
      </div>
    </Dialog>
  );
}
