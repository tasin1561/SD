'use client';

import { useState, type ReactElement } from 'react';
import { Button, ErrorNote, FormField, Input, Modal, useToast } from '@skydrop/ui/components';
import { useCancelOrder } from '@/lib/api-hooks';
import { serverVerdict } from '@/lib/server-verdict';

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
function consequenceFor(status: string): string | null {
  switch (status) {
    case 'DRAFT':
      return null;
    case 'PENDING_CONFIRMATION':
    case 'CALL_NO_RESPONSE':
    case 'CALL_RESCHEDULED':
    case 'AWAITING_SELLER_DECISION':
      return 'It leaves the call queue — nobody will phone this customer about it.';
    case 'CONFIRMED':
    case 'OUT_OF_STOCK':
      return 'The stock held for this order goes back to available straight away.';
    case 'PENDING_PICK':
      return 'It comes out of the pick queue and the stock held for it is released.';
    case 'PICKED':
    case 'PACK_FAILED':
      return 'The goods have already been picked, so someone has to put them back on the shelf. Cancel only if you are sure.';
    case 'PENDING_MANUAL_PLACEMENT':
      return 'It comes out of the manual-placement queue and the stock held for it is released.';
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
  const toast = useToast();
  const cancel = useCancelOrder(orderId);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const consequence = consequenceFor(status);
  const heavy = status === 'PICKED' || status === 'PACK_FAILED';

  async function submit(): Promise<void> {
    setError(null);
    try {
      await cancel.mutateAsync(note.trim().length > 0 ? { note: note.trim() } : {});
      toast.success(`${orderNumber} cancelled`);
      onOpenChange(false);
      setNote('');
    } catch (err) {
      // Verbatim. "Someone is packing this order right now" is the
      // whole answer, and softening it into "could not cancel" would
      // send the seller to support for something that resolves itself.
      setError(serverVerdict(err));
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setError(null);
          setNote('');
        }
        onOpenChange(next);
      }}
      title={`Cancel ${orderNumber}?`}
      tone={heavy ? 'critical' : 'default'}
    >
      <div className="space-y-4">
        <p className="text-text-muted text-sm">
          This cannot be undone. To ship to this customer afterwards you would place a new order.
        </p>

        {consequence !== null && (
          <div
            className="border-border rounded-[5px] border-l-2 py-1 pl-3 text-sm"
            style={heavy ? { borderLeftColor: 'var(--status-rto-fg)' } : undefined}
          >
            <span className={heavy ? 'text-critical' : 'text-text-body'}>{consequence}</span>
          </div>
        )}

        {chargedInr != null && Number(chargedInr) > 0 && (
          <div className="text-text-body text-sm">
            The delivery fee of{' '}
            <span className="font-medium tabular-nums">₹{Number(chargedInr).toFixed(2)}</span>{' '}
            already charged for this order goes back to your wallet.
          </div>
        )}

        {error !== null && <ErrorNote message={error} />}

        <FormField
          label="Reason (optional)"
          hint="Kept on the order's history — useful when you look back at why."
        >
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Customer changed their mind"
          />
        </FormField>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="destructive"
            size="md"
            disabled={cancel.isPending}
            onClick={() => void submit()}
          >
            {cancel.isPending ? 'Cancelling…' : 'Cancel this order'}
          </Button>
          <Button variant="ghost" size="md" onClick={() => onOpenChange(false)}>
            Keep it
          </Button>
        </div>
      </div>
    </Modal>
  );
}
