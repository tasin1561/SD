'use client';

import { useState, type ReactElement } from 'react';
import { AlertTriangle, OctagonX, PhoneCall, Truck } from 'lucide-react';
import { Dialog, DialogFooter, ConfirmDialog } from '@skydrop/ui/app/dialog';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { Select } from '@skydrop/ui/app/select';
import { TextArea } from '@skydrop/ui/app/text-field';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { Notice, OrdSection } from '../../_components/orders-parts';
import {
  useCallHistory,
  useDeliveryActions,
  useRequestDeliveryAction,
  type DeliveryActionKind,
  type DeliveryActionStatus,
} from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';

/**
 * What happened to a parcel that could not be delivered, and what the
 * seller can do about it.
 *
 * Rendered only while the parcel is actually in trouble. A panel about
 * failed deliveries on an order that arrived fine is noise, and noise on
 * every order is how people stop reading the one that matters.
 */
function statusKind(s: DeliveryActionStatus): 'pending' | 'confirmed' | 'failed' | 'cancelled' {
  switch (s) {
    case 'PENDING':
    case 'APPROVED':
      return 'pending';
    case 'EXECUTED':
      return 'confirmed';
    case 'FAILED':
      return 'failed';
    case 'REJECTED':
    case 'EXPIRED':
      return 'cancelled';
  }
}

/** The ledger's own words, in the seller's. */
function humanOutcome(outcome: string): string {
  return outcome
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/^./, (c) => c.toUpperCase());
}

const ACTIONS: ReadonlyArray<{ value: DeliveryActionKind; label: string; hint: string }> = [
  {
    value: 'REATTEMPT',
    label: 'Try delivering again',
    hint: 'We ask the courier for another attempt. Best when you know the customer will be there.',
  },
  {
    value: 'RECALL',
    label: 'Call the customer for me',
    hint: 'One of our agents phones them and reports back. Nothing moves until you know more.',
  },
  {
    value: 'RTO',
    label: 'Send it back',
    hint:
      'Your call, so this goes to the courier straight away — there is no operator step and it ' +
      'cannot be undone. The parcel returns to our warehouse, the sale ends, and a return fee applies.',
  },
];

export function DeliveryTroublePanel({
  orderId,
  orderNumber,
  orderStatus,
  open,
  onOpenChange,
}: {
  readonly orderId: string;
  /** Restated when a send-back is confirmed. */
  readonly orderNumber?: string | undefined;
  readonly orderStatus: string;
  /**
   * The ask dialog, driven from the page header.
   *
   * The button that opens it now sits beside the order number, where a
   * seller looks for something to DO, rather than on this card — which
   * moved below the invoice and is read after the fact. Lifted rather
   * than duplicated: two buttons for one action is how the ticket page
   * came to have two message boxes.
   */
  readonly open: boolean;
  readonly onOpenChange: (next: boolean) => void;
}): ReactElement | null {
  const inTrouble = orderStatus === 'DELIVERY_FAILED' || orderStatus === 'OUT_FOR_DELIVERY';
  const actions = useDeliveryActions(orderId);
  const calls = useCallHistory(orderId);
  const request = useRequestDeliveryAction();

  const setOpen = onOpenChange;
  const [action, setAction] = useState<DeliveryActionKind>('REATTEMPT');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  // A send-back reaches the courier on the click and cannot be undone,
  // so it is confirmed once more, naming the order, before it is sent.
  const [confirmRto, setConfirmRto] = useState(false);

  const hasHistory = (actions.data?.items.length ?? 0) > 0 || (calls.data?.items.length ?? 0) > 0;
  // Shown while the parcel is in trouble, and afterwards only if
  // something actually happened worth reading back.
  if (!inTrouble && !hasHistory) return null;

  async function submit(): Promise<void> {
    setError(null);
    if (reason.trim().length < 10) {
      setError('Tell us what you know — an operator reads this before deciding');
      return;
    }
    try {
      await request.mutateAsync({ orderId, action, reason: reason.trim() });
      setReason('');
      setOpen(false);
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  return (
    <OrdSection
      title={orderStatus === 'DELIVERY_FAILED' ? 'Delivery did not succeed' : 'Out for delivery'}
    >
      <div className="ord-stack">
        {orderStatus === 'DELIVERY_FAILED' && (
          <Notice tone="warn" icon={<AlertTriangle size={16} />}>
            <span>
              The courier could not hand this over. We have queued a call to your customer to find
              out why — you can also tell us what to do below.
            </span>
          </Notice>
        )}

        {/* What we said to their customer. The reason this panel is
            worth reading: "no answer, twice" and "they moved house"
            lead to opposite decisions. */}
        {(calls.data?.items.length ?? 0) > 0 && (
          <div>
            <h3 className="ord-h3">What we discussed with your customer</h3>
            <ul className="ord-cards">
              {calls.data?.items.map((c) => (
                <li key={c.id} className="ord-callcard" data-tone="accent">
                  <div className="ord-callcard__head">
                    <PhoneCall size={14} aria-hidden />
                    <span className="ord-callcard__title">{humanOutcome(c.outcome)}</span>
                    <span className="ord-callcard__time sk-figure">
                      {new Date(c.calledAt).toLocaleString()}
                    </span>
                  </div>
                  {/*
                    What the customer actually said. This is the answer
                    to whatever the seller asked for, so it is the
                    strongest line in the card.
                  */}
                  {c.notes !== null && c.notes !== '' && (
                    <p className="ord-callcard__said">{c.notes}</p>
                  )}
                  {c.customerSaidAddress !== null && (
                    <span className="ord-faint">
                      Customer gave a different address: {c.customerSaidAddress}
                    </span>
                  )}
                  {c.rescheduledFor !== null && (
                    <span className="ord-faint">
                      Asked us to call back {new Date(c.rescheduledFor).toLocaleString()}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {(actions.data?.items.length ?? 0) > 0 && (
          <div>
            <h3 className="ord-h3">What you asked for</h3>
            <ul className="ord-cards">
              {actions.data?.items.map((a) => (
                <li key={a.id} className="ord-callcard">
                  <div className="ord-callcard__head">
                    <span className="ord-callcard__title">
                      {ACTIONS.find((x) => x.value === a.action)?.label ?? a.action}
                    </span>
                    <span className="ord-callcard__time">
                      <StatusChip
                        kind={statusKind(a.status)}
                        label={humanOutcome(a.status)}
                        size="sm"
                      />
                    </span>
                  </div>
                  <p className="ord-p">{a.reason}</p>
                  {a.decisionNote !== null && (
                    <span className="ord-faint">Our reply: {a.decisionNote}</span>
                  )}
                  {a.executionError !== null && (
                    <span className="ord-error">Could not be carried out: {a.executionError}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setError(null);
        }}
        title="What should we do?"
        icon={<Truck size={18} />}
        description={
          action === 'RTO'
            ? 'Returning your own parcel is your decision, so this reaches the courier immediately.'
            : 'An operator reads this and acts on it — nothing reaches the courier automatically.'
        }
        locked={request.isPending}
        footer={
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={request.isPending}>
              Cancel
            </Button>
            <AsyncButton
              variant={action === 'RTO' ? 'destructive' : 'primary'}
              state={request.isPending ? 'busy' : undefined}
              labels={{
                idle: action === 'RTO' ? 'Send it back now' : 'Send request',
                busy: 'Sending…',
              }}
              disabled={request.isPending}
              onClick={() => {
                // A send-back is confirmed first; submit() still owns the
                // "tell us what you know" check, so a short reason is
                // refused by it exactly as before.
                if (action === 'RTO' && reason.trim().length >= 10) setConfirmRto(true);
                else void submit();
              }}
            />
          </DialogFooter>
        }
      >
        <div className="ord-stack ord-stack--tight">
          <Select
            label="What would you like"
            required
            hint={ACTIONS.find((a) => a.value === action)?.hint}
            value={action}
            onChange={(e) => setAction(e.target.value as DeliveryActionKind)}
          >
            {ACTIONS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </Select>
          <TextArea
            label="What do you know"
            required
            hint="Anything that helps — the customer called you, they'll be home Saturday, the address was wrong."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={2000}
          />
          {error !== null && (
            <Notice tone="bad" role="alert" icon={<OctagonX size={16} />}>
              <span>{error}</span>
            </Notice>
          )}
        </div>
      </Dialog>

      <ConfirmDialog
        open={confirmRto}
        onOpenChange={setConfirmRto}
        title="Send this parcel back now?"
        entity={orderNumber ?? 'This order'}
        entityIsIdentifier={orderNumber !== undefined}
        consequence="The courier is told straight away and it cannot be undone. The parcel returns to our warehouse, the sale ends, and a return fee applies."
        confirmLabel="Send it back now"
        destructive
        onConfirm={() => submit()}
      />
    </OrdSection>
  );
}
