'use client';

import { useState, type ReactElement } from 'react';
import { AlertTriangle, PhoneCall } from 'lucide-react';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  FormField,
  Modal,
  ModalFooter,
  Select,
  StatusBadge,
  Textarea,
} from '@skydrop/ui/components';
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
    hint: 'The parcel returns to our warehouse. This ends the sale and a return fee applies.',
  },
];

export function DeliveryTroublePanel({
  orderId,
  orderStatus,
}: {
  readonly orderId: string;
  readonly orderStatus: string;
}): ReactElement | null {
  const inTrouble = orderStatus === 'DELIVERY_FAILED' || orderStatus === 'OUT_FOR_DELIVERY';
  const actions = useDeliveryActions(orderId);
  const calls = useCallHistory(orderId);
  const request = useRequestDeliveryAction();

  const [open, setOpen] = useState(false);
  const [action, setAction] = useState<DeliveryActionKind>('REATTEMPT');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

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
    <Card>
      <CardHeader
        title={orderStatus === 'DELIVERY_FAILED' ? 'Delivery did not succeed' : 'Out for delivery'}
        action={
          actions.data?.canRequest === true ? (
            <Button size="sm" onClick={() => setOpen(true)}>
              Ask us to act
            </Button>
          ) : undefined
        }
      />
      <CardBody>
        <div className="space-y-4">
          {orderStatus === 'DELIVERY_FAILED' && (
            <div className="text-warning flex gap-2 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <p>
                The courier could not hand this over. We have queued a call to your customer to find
                out why — you can also tell us what to do below.
              </p>
            </div>
          )}

          {/* What we said to their customer. The reason this panel is
              worth reading: "no answer, twice" and "they moved house"
              lead to opposite decisions. */}
          {(calls.data?.items.length ?? 0) > 0 && (
            <div>
              <h3 className="text-text-bright mb-2 text-sm font-medium">
                What we discussed with your customer
              </h3>
              <ul className="space-y-2">
                {calls.data?.items.map((c) => (
                  <li key={c.id} className="border-border rounded-md border p-2.5 text-sm">
                    <div className="flex items-center gap-2">
                      <PhoneCall className="text-text-muted h-3.5 w-3.5 shrink-0" aria-hidden />
                      <span className="font-medium">{humanOutcome(c.outcome)}</span>
                      <span className="text-text-faint ml-auto text-xs">
                        {new Date(c.calledAt).toLocaleString()}
                      </span>
                    </div>
                    {c.notes !== null && c.notes !== '' && (
                      <p className="text-text-muted mt-1.5">{c.notes}</p>
                    )}
                    {c.customerSaidAddress !== null && (
                      <p className="text-text-muted mt-1 text-xs">
                        Customer gave a different address: {c.customerSaidAddress}
                      </p>
                    )}
                    {c.rescheduledFor !== null && (
                      <p className="text-text-muted mt-1 text-xs">
                        Asked us to call back {new Date(c.rescheduledFor).toLocaleString()}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(actions.data?.items.length ?? 0) > 0 && (
            <div>
              <h3 className="text-text-bright mb-2 text-sm font-medium">What you asked for</h3>
              <ul className="space-y-2">
                {actions.data?.items.map((a) => (
                  <li key={a.id} className="border-border rounded-md border p-2.5 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">
                        {ACTIONS.find((x) => x.value === a.action)?.label ?? a.action}
                      </span>
                      <span className="ml-auto">
                        <StatusBadge kind={statusKind(a.status)} label={a.status.toLowerCase()} />
                      </span>
                    </div>
                    <p className="text-text-muted mt-1.5">{a.reason}</p>
                    {a.decisionNote !== null && (
                      <p className="text-text-muted mt-1 text-xs">Our reply: {a.decisionNote}</p>
                    )}
                    {a.executionError !== null && (
                      <p className="text-danger mt-1 text-xs">
                        Could not be carried out: {a.executionError}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </CardBody>

      <Modal
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setError(null);
        }}
        title="What should we do?"
        description="An operator reads this and acts on it — nothing reaches the courier automatically."
      >
        <div className="space-y-3">
          <FormField
            label="What would you like"
            required
            hint={ACTIONS.find((a) => a.value === action)?.hint}
          >
            <Select
              value={action}
              onChange={(e) => setAction(e.target.value as DeliveryActionKind)}
            >
              {ACTIONS.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField
            label="What do you know"
            required
            hint="Anything that helps — the customer called you, they'll be home Saturday, the address was wrong."
          >
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={2000}
            />
          </FormField>
        </div>
        {error !== null && <p className="text-danger mt-2 text-sm">{error}</p>}
        <ModalFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={request.isPending}>
            {request.isPending ? 'Sending…' : 'Send request'}
          </Button>
        </ModalFooter>
      </Modal>
    </Card>
  );
}
