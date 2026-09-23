'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState, type ReactElement } from 'react';
import {
  ArrowLeft,
  Flag,
  OctagonX,
  PhoneMissed,
  Route,
  TriangleAlert,
  Truck,
  XCircle,
} from 'lucide-react';
import { OrderStatus, type ShipmentStatus } from '@skydrop/db';
import { useStoreIdentity } from '@skydrop/auth/client';
// The layout mounts the legacy <Toaster>; the app `useToast` would throw
// outside its own provider, so this keeps the legacy hook (same API).
import { Money, ProductThumb, useToast } from '@skydrop/ui/components';
import {
  orderStatusKind,
  shipmentStatusKind,
  statusLabel,
  storeOrderRequestStatusKind,
  storeOrderRequestStatusLabel,
  type StatusKind,
} from '@skydrop/ui/status';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { TextArea } from '@skydrop/ui/app/text-field';
import { Table, TBody, THead, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import { chipWords, StatusChip } from '@skydrop/ui/app/status-chip';
import { Timeline, type TimelineStep, type TimelineTone } from '@skydrop/ui/app/timeline';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { can } from '@/lib/page-access';
import { serverVerdict } from '@/lib/server-verdict';
import {
  useCancelStoreOrder,
  useStoreOrder,
  useStoreOrderEvents,
  useStoreActionPolicy,
  useStoreOrderRequests,
  type StoreActionMode,
  type StoreOrderEvent,
  type StoreOrderView,
} from '@/lib/order-hooks';
import { useStoreCallReviews } from '@/lib/review-hooks';
import { CallReviewDecision } from '@/components/call-review-decision';
import { OrderMoney } from './_components/order-money';
import { StoreConsigneePanel } from './_components/store-consignee-panel';
import { OrderActions } from './_components/order-actions';
import { AddressCorrection } from './_components/address-correction';
import { BackLink, ConfirmSubject, Facts, Notice, RoSection } from '../_components/orders-parts';

function when(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * RS-5 — one of this store's orders: who it is going to, what is in it,
 * what the store sold it for and what it pays the seller, the waybill
 * once there is one, and the timeline. Cancelling is offered until the
 * order is finished; the server decides whether it is still possible
 * (until it is packed) and says so in its own words (FE-2).
 */
export default function StoreOrderPage(): ReactElement {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const order = useStoreOrder(id);

  return (
    <div className="ro-page">
      <BackLink href="/orders" icon={<ArrowLeft size={14} aria-hidden />}>
        Orders
      </BackLink>
      {order.isPending ? (
        <SkeletonRows rows={6} cols={3} label="Loading the order" />
      ) : order.isError ? (
        <ErrorState message={serverVerdict(order.error)} retry={() => void order.refetch()} />
      ) : (
        <OrderBody order={order.data} />
      )}
    </div>
  );
}

function OrderBody({ order: o }: { order: StoreOrderView }): ReactElement {
  const me = useStoreIdentity();
  const toast = useToast();
  const cancel = useCancelStoreOrder();
  // What the seller lets this store do, and how. Cosmetic (FE-2): each
  // action is still refused by name on the server.
  const policy = useStoreActionPolicy();
  const cancelMode: StoreActionMode | undefined = policy.data?.cancel;
  const cancelNeedsSeller = cancelMode === 'ASK_SELLER';
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function doCancel(): Promise<void> {
    setError(null);
    try {
      const out = await cancel.mutateAsync({ id: o.id, note: note.trim() });
      // The REPLY says which happened, never the policy read on load.
      toast.success(
        out.applied
          ? 'Order cancelled.'
          : 'Sent to Seller staff to approve. The order is not cancelled until they say yes.',
      );
      setConfirming(false);
    } catch (err) {
      setError(serverVerdict(err));
      setConfirming(false);
    }
  }

  const cancelLabel = cancelNeedsSeller ? 'Send to your seller' : 'Cancel the order';
  const parcels = o.shipments.filter((s) => s.awbNumber !== null);

  return (
    <>
      <PageHeader
        title={<span className="sk-ident">{o.orderNumber}</span>}
        subtitle={
          o.sellerOrderRef === null ? (
            `Placed ${when(o.placedAt)}`
          ) : (
            <span>
              Your reference <span className="sk-ident">{o.sellerOrderRef}</span> · placed{' '}
              {when(o.placedAt)}
            </span>
          )
        }
        meta={<StatusChip kind={orderStatusKind(o.status)} label={statusLabel(o.status)} />}
        action={
          // Only while the order's stage still allows a cancel (until it is
          // packed) — past that the button could only ever be refused.
          !o.terminal && o.stages.cancel && can(me, 'orders.cancel') && cancelMode !== 'OFF' ? (
            <Button
              variant="ghost"
              icon={<XCircle size={15} />}
              onClick={() => setConfirming(true)}
            >
              {cancelNeedsSeller ? 'Ask the seller to cancel' : 'Cancel order'}
            </Button>
          ) : undefined
        }
      />
      {error !== null ? (
        <Notice tone="bad" role="alert" icon={<OctagonX size={16} />}>
          <span>{error}</span>
        </Notice>
      ) : null}

      <div className="ro-split">
        <RoSection title="Customer">
          <Facts
            items={[
              { label: 'Name', value: o.recipient.name },
              {
                label: 'Phone',
                value: (
                  <span className="sk-figure">
                    {o.recipient.phoneE164}
                    {o.recipient.altPhoneE164 !== null ? ` / ${o.recipient.altPhoneE164}` : ''}
                  </span>
                ),
              },
              ...(o.recipient.email !== null
                ? [{ label: 'Email', value: <span>{o.recipient.email}</span> }]
                : []),
              {
                label: 'Address',
                value: (
                  <>
                    <div>{o.recipient.addressLine1}</div>
                    {o.recipient.addressLine2 !== null ? (
                      <div>{o.recipient.addressLine2}</div>
                    ) : null}
                    <div>
                      {[o.recipient.city, o.recipient.stateProvince].filter(Boolean).join(', ')}{' '}
                      <span className="sk-figure">{o.recipient.postalCode}</span>
                    </div>
                  </>
                ),
              },
            ]}
          />
        </RoSection>

        <RoSection title="Money">
          <div className="ro-stack ro-stack--tight">
            <Facts
              items={[
                {
                  label: 'Payment',
                  value: o.paymentMode === 'COD' ? 'Cash on delivery' : 'Prepaid',
                },
                {
                  label: 'To collect',
                  value:
                    o.codAmountInr === null ? (
                      '—'
                    ) : (
                      <Money amount={o.codAmountInr} convert={false} />
                    ),
                },
                {
                  label: 'You sold it for',
                  value: <Money amount={o.totals.retailInr} convert={false} />,
                },
                {
                  label: 'You pay the seller',
                  value: <Money amount={o.totals.transferInr} convert={false} />,
                },
                {
                  label: 'Terms',
                  value: o.termsVersion === null ? '—' : `Version ${o.termsVersion}`,
                },
              ]}
            />
            <p className="ro-faint">
              Prices and terms are fixed as they were when the order was placed.
            </p>
          </div>
        </RoSection>
      </div>

      <RoSection title="Products" flush>
        <Table caption="Products">
          <THead>
            <Tr>
              <Th>Product</Th>
              <Th align="right">Qty</Th>
              <Th align="right">Sold at</Th>
              <Th align="right">You pay</Th>
            </Tr>
          </THead>
          <TBody>
            {o.lines.map((l) => (
              <Tr key={l.id}>
                <Td>
                  <div className="ro-thumb-cell">
                    <ProductThumb src={l.imageUrl} size={40} alt={l.productName} />
                    <div>
                      <div>{l.productName}</div>
                      <span className="ro-sub">
                        <span className="sk-ident">{l.skuCode}</span>
                        {l.variantLabel !== null ? ` · ${l.variantLabel}` : ''}
                      </span>
                    </div>
                  </div>
                </Td>
                <Td align="right">
                  <span className="sk-figure">{l.quantity}</span>
                </Td>
                <Td align="right">
                  {l.retailUnitInr === null ? (
                    '—'
                  ) : (
                    <Money amount={l.retailUnitInr} convert={false} />
                  )}
                </Td>
                <Td align="right">
                  {l.transferPriceInr === null ? (
                    '—'
                  ) : (
                    <Money amount={l.transferPriceInr} convert={false} />
                  )}
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </RoSection>

      {parcels.length > 0 ? (
        <RoSection title="Parcel">
          <ul className="ro-offers">
            {parcels.map((s) => (
              <li key={s.awbNumber ?? s.courierCode} className="ro-offer">
                <Truck size={15} aria-hidden />
                <span>
                  Waybill <span className="sk-ident">{s.awbNumber}</span> · {s.courierCode}
                </span>
                <StatusChip
                  kind={shipmentStatusKind(s.status as ShipmentStatus)}
                  label={statusLabel(s.status as ShipmentStatus)}
                  size="sm"
                />
              </li>
            ))}
          </ul>
        </RoSection>
      ) : null}

      {/* Only while the parcel is still live, and only for somebody who
          may ask. The server decides whether each one is actually
          possible and says so in its own words (FE-2). Both sections are
          governed by the seller's policy for this store, which each one
          reads from the server rather than assuming. */}
      {!o.terminal && can(me, 'orders.actions') ? (
        <>
          {/* The one thing that STOPS this order until somebody answers.
              Offered here as well as on its queue because a store
              arrives both ways — from the list of what is waiting, and
              from the order itself after a customer chases them. */}
          {o.status === OrderStatus.AWAITING_SELLER_DECISION ? (
            <CallCapPanel
              orderId={o.id}
              orderNumber={o.orderNumber}
              mode={policy.data?.callCapDecision}
            />
          ) : null}
          {/* Each offered only at the stages where it can work (2026-09-17):
              delivery tasks while the parcel is out for delivery or has just
              failed, a correction before the call confirms the order. At
              other stages the history still shows, with a plain sentence
              saying when the task opens — cosmetic, the server still refuses
              by name (FE-2). */}
          <OrderActions
            orderId={o.id}
            orderNumber={o.orderNumber}
            stageOpen={o.stages.deliveryActions}
          />
          <AddressCorrection
            orderId={o.id}
            orderNumber={o.orderNumber}
            recipient={o.recipient}
            stageOpen={o.stages.addressCorrection}
          />
          {/* Past that stage the COURIER holds the address, and only
              they can change it (owner, 2026-09-18). This renders
              nothing until a parcel exists, and greys itself out once
              the courier's own window has closed. */}
          {!o.stages.addressCorrection ? (
            <StoreConsigneePanel orderId={o.id} orderNumber={o.orderNumber} />
          ) : null}
        </>
      ) : null}

      <HeldRequests orderId={o.id} />

      <OrderMoney orderId={o.id} />

      {can(me, 'tickets.manage') ? (
        <RaiseTicketLinks orderId={o.id} chase={policy.data?.chaseSkydrop} />
      ) : null}

      <OrderTimeline orderId={o.id} orderNumber={o.orderNumber} status={o.status} />

      <Dialog
        open={confirming}
        onOpenChange={setConfirming}
        title={
          cancelNeedsSeller
            ? `Ask the seller to cancel ${o.orderNumber}?`
            : `Cancel ${o.orderNumber}?`
        }
        tone="critical"
        icon={<TriangleAlert size={18} />}
        size="sm"
        locked={cancel.isPending}
        footer={
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => setConfirming(false)}
              disabled={cancel.isPending}
            >
              Keep it
            </Button>
            <AsyncButton
              variant="destructive"
              state={cancel.isPending ? 'busy' : undefined}
              labels={{ idle: cancelLabel, busy: 'Sending…' }}
              disabled={cancel.isPending || (cancelNeedsSeller && note.trim() === '')}
              onClick={() => void doCancel()}
            />
          </DialogFooter>
        }
      >
        <ConfirmSubject
          entity={o.orderNumber}
          entityIsIdentifier
          amount={
            o.codAmountInr === null ? undefined : (
              <>
                <Money amount={o.codAmountInr} convert={false} /> to collect
              </>
            )
          }
          consequence={`${
            cancelNeedsSeller
              ? 'Your seller approves cancels for this store. Seller staff read your reason and decide; the order is cancelled only if they say yes, and only until it is packed.'
              : 'An order can be cancelled until it is packed.'
          } The customer is not told by us — let them know yourself.`}
        >
          <TextArea
            label={cancelNeedsSeller ? 'Why (required)' : 'Why (optional)'}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            showCount
          />
        </ConfirmSubject>
      </Dialog>
    </>
  );
}

/**
 * "We could not reach your customer" — on the order it is about.
 *
 * The question itself, its stock cost and the two answers all live in
 * `CallReviewDecision`; this is the context around it. It renders only
 * for an order actually parked in `AWAITING_SELLER_DECISION`, so it can
 * say plainly that nothing at all happens until somebody answers.
 *
 * A refusal is shown rather than hidden: `STORE_ACTION_NOT_ALLOWED`
 * means the SELLER answers this one, and a store staring at a stuck
 * order needs to know who to chase. Verbatim (FE-2).
 */
function CallCapPanel({
  orderId,
  orderNumber,
  mode,
}: {
  orderId: string;
  orderNumber: string;
  mode: StoreActionMode | undefined;
}): ReactElement {
  // The same query the nav count and the queue page use, so this is
  // served from cache on a store that has either of them open.
  const reviews = useStoreCallReviews({ enabled: mode !== 'OFF' });
  const review = (reviews.data ?? []).find((r) => r.orderId === orderId);

  if (mode === 'OFF') {
    return (
      <RoSection
        title="We could not reach your customer"
        note="Nothing happens on this order until it is answered. The stock stays held in the meantime."
      >
        <p className="ro-p">
          Seller staff answer this question for your store. Ask your seller whether to keep trying.
        </p>
      </RoSection>
    );
  }

  return (
    <RoSection
      title="We could not reach your customer"
      note="Nothing happens on this order until you answer. The stock stays held in the meantime."
      bare
    >
      {reviews.isPending ? (
        <SkeletonRows rows={1} cols={2} label="Loading the question" />
      ) : reviews.isError ? (
        <ErrorState message={serverVerdict(reviews.error)} retry={() => void reviews.refetch()} />
      ) : review === undefined ? (
        <Notice tone="warn" icon={<PhoneMissed size={16} />}>
          <span>
            This order is waiting on an answer about further call attempts.{' '}
            <Link href="/orders/call-reviews" className="ro-link">
              See everything waiting on you
            </Link>
          </span>
        </Notice>
      ) : (
        <Notice tone="warn" icon={<PhoneMissed size={16} />}>
          <div className="ro-row ro-row--between">
            <span>
              We have rung them {review.attemptCount} time
              {review.attemptCount === 1 ? '' : 's'} without an answer, and {review.heldQty} unit
              {review.heldQty === 1 ? '' : 's'} of your seller’s stock{' '}
              {review.heldQty === 1 ? 'is' : 'are'} held for this order.
            </span>
            <CallReviewDecision
              review={review}
              orderNumber={orderNumber}
              triggerLabel={mode === 'ASK_SELLER' ? 'Propose an answer' : 'Answer this'}
              triggerVariant="primary"
              mode={mode}
            />
          </div>
        </Notice>
      )}
    </RoSection>
  );
}

/**
 * The two different problems a store can raise about this order, named
 * apart rather than behind one word.
 *
 * A DISPUTE is with the seller — the goods, the price, what was sent —
 * and Skydrop referees it between their two wallets. An ISSUE is with
 * US: we damaged it, lost it, or are sitting on it.
 *
 * Whether, and how, the second is theirs to raise is the seller's
 * `chaseSkydrop` policy (2026-09-17): hidden when OFF; when the seller
 * approves it first the link says so, because the issue then reaches
 * Skydrop only once Seller staff say yes. With the policy unknown the link
 * is offered and the server answers in its own words (FE-2).
 */
function RaiseTicketLinks({
  orderId,
  chase,
}: {
  orderId: string;
  chase: StoreActionMode | undefined;
}): ReactElement {
  return (
    <Notice tone="neutral" icon={<Flag size={16} />}>
      <p className="ro-body">
        Something wrong with this order that the seller should put right?{' '}
        <Link href={`/tickets/new?orderId=${orderId}&with=seller`} className="ro-link">
          Raise it with your seller
        </Link>
      </p>
      {chase === 'OFF' ? null : (
        <p className="ro-body">
          Damaged, lost or stuck with Skydrop?{' '}
          <Link href={`/tickets/new?orderId=${orderId}&with=skydrop`} className="ro-link">
            Raise it with Skydrop
          </Link>
          <span className="ro-faint">
            {chase === 'ASK_SELLER'
              ? ' — Seller staff approve it first; it reaches Skydrop once they say yes.'
              : ' — your seller is not told.'}
          </span>
        </p>
      )}
    </Notice>
  );
}

/**
 * What this store sent Seller staff to approve on this order — a cancel,
 * an answer to "keep trying?", an issue for Skydrop — and where each got
 * to: waiting, done, declined with their reason, could not be done, or
 * not answered in time (then it is closed and you should follow up).
 */
function HeldRequests({ orderId }: { orderId: string }): ReactElement {
  const requests = useStoreOrderRequests(orderId);
  if (requests.isPending) {
    return <SkeletonRows rows={1} cols={3} label="Loading what you asked the seller" />;
  }
  if (requests.isError) {
    return (
      <ErrorState message={serverVerdict(requests.error)} retry={() => void requests.refetch()} />
    );
  }
  if (requests.data.length === 0) return <></>;
  return (
    <RoSection
      title="Sent to your seller to approve"
      note="Nothing on these happens until Seller staff answer. A request nobody answers closes after a few days — follow up with your seller if that happens."
      flush
    >
      <Table caption="Sent to your seller to approve">
        <THead>
          <Tr>
            <Th>What you asked</Th>
            <Th>When</Th>
            <Th>Where it got to</Th>
          </Tr>
        </THead>
        <TBody>
          {requests.data.map((r) => (
            <Tr key={r.id}>
              <Td>
                <div>{r.label.charAt(0).toUpperCase() + r.label.slice(1)}</div>
                {r.note !== null ? <span className="ro-sub">{r.note}</span> : null}
              </Td>
              <Td>
                <span className="ro-muted sk-figure">{when(r.createdAt)}</span>
              </Td>
              <Td>
                <StatusChip
                  kind={storeOrderRequestStatusKind(r.status)}
                  label={storeOrderRequestStatusLabel(r.status)}
                  size="sm"
                />
                {r.decisionNote !== null ? (
                  <p className="ro-quote">They said: “{r.decisionNote}”</p>
                ) : null}
                {r.failureReason !== null ? (
                  <span className="ro-sub ro-tone-bad">Not done — {r.failureReason}</span>
                ) : null}
              </Td>
            </Tr>
          ))}
        </TBody>
      </Table>
    </RoSection>
  );
}

/** A returning or failed status colours its step (and the fill, when current). */
function toneOf(kind: StatusKind): TimelineTone {
  switch (kind) {
    case 'failed':
    case 'cancelled':
      return 'failed';
    case 'rto':
      return 'returning';
    default:
      return 'default';
  }
}

/**
 * The order's history as the u17 timeline. The events arrive oldest
 * first (the API orders them so); every one has happened, so each is a
 * completed step and the latest is the current one. Words and times are
 * exactly what the plain list printed: the status (or the event's own
 * description), the description beside a status, and `when()`.
 */
function eventSteps(events: readonly StoreOrderEvent[]): TimelineStep[] {
  return events.map((e, i): TimelineStep => {
    const current = i === events.length - 1;
    return {
      id: e.id,
      label: e.toStatus !== null ? chipWords(statusLabel(e.toStatus)) : (e.description ?? e.type),
      state: current ? 'current' : 'done',
      ...(e.toStatus !== null && e.description !== null ? { description: e.description } : {}),
      time: when(e.createdAt),
      ...(e.toStatus !== null ? { tone: toneOf(orderStatusKind(e.toStatus)) } : {}),
    };
  });
}

function OrderTimeline({
  orderId,
  orderNumber,
  status,
}: {
  orderId: string;
  orderNumber: string;
  status: OrderStatus;
}): ReactElement {
  const events = useStoreOrderEvents(orderId);
  return (
    <RoSection title="Timeline" bare>
      {events.isPending ? (
        <SkeletonRows rows={3} cols={2} label="Loading the timeline" />
      ) : events.isError ? (
        <ErrorState message={serverVerdict(events.error)} retry={() => void events.refetch()} />
      ) : events.data.length === 0 ? (
        <EmptyState
          bare
          icon={<Route size={20} />}
          title="Nothing has happened to this order yet."
        />
      ) : (
        <div className="ro-card">
          <Timeline
            label="Order timeline"
            steps={eventSteps(events.data)}
            header={{
              icon: <Route size={16} />,
              title: 'Order',
              id: orderNumber,
              status: (
                <StatusChip kind={orderStatusKind(status)} label={statusLabel(status)} size="sm" />
              ),
            }}
          />
        </div>
      )}
    </RoSection>
  );
}
