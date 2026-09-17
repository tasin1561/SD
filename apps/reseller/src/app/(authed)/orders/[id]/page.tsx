'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState, type ReactElement } from 'react';
import { ArrowLeft } from 'lucide-react';
import { OrderStatus, type ShipmentStatus } from '@skydrop/db';
import { useStoreIdentity } from '@skydrop/auth/client';
import {
  Button,
  Card,
  CardBody,
  ConfirmDialog,
  ErrorState,
  FormField,
  Input,
  LoadingState,
  Modal,
  ModalFooter,
  Money,
  OrderStatusBadge,
  PageHeader,
  ProductThumb,
  Section,
  DeliveryActionStatusBadge,
  ShipmentStatusBadge,
  StoreAddressChangeStatusBadge,
  StoreOrderRequestStatusBadge,
  TBody,
  THead,
  Table,
  Td,
  Textarea,
  Th,
  Tr,
  useToast,
} from '@skydrop/ui/components';
import { statusLabel } from '@skydrop/ui/status';
import { can } from '@/lib/page-access';
import { serverVerdict } from '@/lib/server-verdict';
import {
  useCancelStoreOrder,
  useEditStoreRecipient,
  useRequestStoreAction,
  useStoreAddressChanges,
  useStoreOrder,
  useStoreOrderActions,
  useStoreOrderEvents,
  useStoreActionPolicy,
  useStoreOrderRequests,
  type StoreActionMode,
  type AddressChangeFields,
  type AddressField,
  type StoreActionKind,
  type StoreOrderView,
} from '@/lib/order-hooks';
import { useStoreCallReviews } from '@/lib/review-hooks';
import { CallReviewDecision } from '@/components/call-review-decision';
import { OrderMoney } from './_components/order-money';

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
    <div className="space-y-6">
      <Link
        href="/orders"
        className="text-text-muted hover:text-text-body inline-flex items-center gap-1.5 text-xs"
      >
        <ArrowLeft size={12} /> Orders
      </Link>
      {order.isPending ? (
        <LoadingState label="Loading the order" rows={6} />
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

  return (
    <>
      <PageHeader
        title={<span className="font-mono">{o.orderNumber}</span>}
        subtitle={
          o.sellerOrderRef === null ? (
            `Placed ${when(o.placedAt)}`
          ) : (
            <span>
              Your reference <span className="font-mono">{o.sellerOrderRef}</span> · placed{' '}
              {when(o.placedAt)}
            </span>
          )
        }
        action={
          <div className="flex items-center gap-2">
            <OrderStatusBadge status={o.status} />
            {/* Only while the order's stage still allows a cancel (until it is
                packed) — past that the button could only ever be refused. */}
            {!o.terminal && o.stages.cancel && can(me, 'orders.cancel') && cancelMode !== 'OFF' ? (
              <Button variant="ghost" size="md" onClick={() => setConfirming(true)}>
                {cancelNeedsSeller ? 'Ask the seller to cancel' : 'Cancel order'}
              </Button>
            ) : null}
          </div>
        }
      />
      {error !== null ? (
        <p role="alert" className="text-critical text-sm">
          {error}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section title="Customer">
          <Card>
            <CardBody>
              <dl className="grid grid-cols-[minmax(84px,36%)_1fr] gap-x-3 gap-y-1.5 text-sm sm:grid-cols-[140px_1fr]">
                <dt className="text-text-muted">Name</dt>
                <dd>{o.recipient.name}</dd>
                <dt className="text-text-muted">Phone</dt>
                <dd className="font-mono text-xs">
                  {o.recipient.phoneE164}
                  {o.recipient.altPhoneE164 !== null ? ` / ${o.recipient.altPhoneE164}` : ''}
                </dd>
                {o.recipient.email !== null ? (
                  <>
                    <dt className="text-text-muted">Email</dt>
                    <dd className="font-mono text-xs">{o.recipient.email}</dd>
                  </>
                ) : null}
                <dt className="text-text-muted">Address</dt>
                <dd>
                  <div>{o.recipient.addressLine1}</div>
                  {o.recipient.addressLine2 !== null ? <div>{o.recipient.addressLine2}</div> : null}
                  <div className="mt-0.5">
                    {[o.recipient.city, o.recipient.stateProvince].filter(Boolean).join(', ')}{' '}
                    <span className="font-mono">{o.recipient.postalCode}</span>
                  </div>
                </dd>
              </dl>
            </CardBody>
          </Card>
        </Section>

        <Section title="Money">
          <Card>
            <CardBody>
              <dl className="grid grid-cols-[minmax(84px,40%)_1fr] gap-x-3 gap-y-1.5 text-sm">
                <dt className="text-text-muted">Payment</dt>
                <dd>{o.paymentMode === 'COD' ? 'Cash on delivery' : 'Prepaid'}</dd>
                <dt className="text-text-muted">To collect</dt>
                <dd>
                  {o.codAmountInr === null ? (
                    '—'
                  ) : (
                    <Money amount={o.codAmountInr} convert={false} />
                  )}
                </dd>
                <dt className="text-text-muted">You sold it for</dt>
                <dd>
                  <Money amount={o.totals.retailInr} convert={false} />
                </dd>
                <dt className="text-text-muted">You pay the seller</dt>
                <dd>
                  <Money amount={o.totals.transferInr} convert={false} />
                </dd>
                <dt className="text-text-muted">Terms</dt>
                <dd>{o.termsVersion === null ? '—' : `Version ${o.termsVersion}`}</dd>
              </dl>
              <p className="text-text-faint mt-3 text-xs">
                Prices and terms are fixed as they were when the order was placed.
              </p>
            </CardBody>
          </Card>
        </Section>
      </div>

      <Section title="Products">
        <Table>
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
                  <div className="flex items-start gap-3">
                    <ProductThumb src={l.imageUrl} size={40} alt={l.productName} />
                    <div>
                      <div>{l.productName}</div>
                      <div className="text-text-faint font-mono text-xs">
                        {l.skuCode}
                        {l.variantLabel !== null ? ` · ${l.variantLabel}` : ''}
                      </div>
                    </div>
                  </div>
                </Td>
                <Td align="right">{l.quantity}</Td>
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
      </Section>

      {o.shipments.some((s) => s.awbNumber !== null) ? (
        <Section title="Parcel">
          <Card>
            <CardBody>
              {o.shipments
                .filter((s) => s.awbNumber !== null)
                .map((s) => (
                  <div
                    key={s.awbNumber ?? s.courierCode}
                    className="flex flex-wrap items-center gap-2 text-sm"
                  >
                    <span>
                      Waybill <span className="font-mono">{s.awbNumber}</span> · {s.courierCode}
                    </span>
                    <ShipmentStatusBadge status={s.status as ShipmentStatus} />
                  </div>
                ))}
            </CardBody>
          </Card>
        </Section>
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
          <OrderActions orderId={o.id} stageOpen={o.stages.deliveryActions} />
          <AddressCorrection
            orderId={o.id}
            recipient={o.recipient}
            stageOpen={o.stages.addressCorrection}
          />
        </>
      ) : null}

      <HeldRequests orderId={o.id} />

      <OrderMoney orderId={o.id} />

      {can(me, 'tickets.manage') ? (
        <RaiseTicketLinks orderId={o.id} chase={policy.data?.chaseSkydrop} />
      ) : null}

      <Timeline orderId={o.id} />

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={
          cancelNeedsSeller
            ? `Ask the seller to cancel ${o.orderNumber}?`
            : `Cancel ${o.orderNumber}?`
        }
        description={
          <div className="space-y-2">
            <p>
              {cancelNeedsSeller
                ? 'Your seller approves cancels for this store. Seller staff read your reason and decide; the order is cancelled only if they say yes, and only until it is packed.'
                : 'An order can be cancelled until it is packed.'}{' '}
              The customer is not told by us — let them know yourself.
            </p>
            <Textarea
              aria-label={cancelNeedsSeller ? 'Why (required)' : 'Why (optional)'}
              placeholder={cancelNeedsSeller ? 'Why (required)' : 'Why (optional)'}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
            />
          </div>
        }
        confirmLabel={cancelNeedsSeller ? 'Send to your seller' : 'Cancel the order'}
        confirmVariant="destructive"
        disabled={cancel.isPending || (cancelNeedsSeller && note.trim() === '')}
        onConfirm={() => void doCancel()}
      />
    </>
  );
}

/**
 * The three things a store can ask for about a live parcel, and what it
 * has asked for before.
 *
 * WHICH ones are offered is the SELLER's policy for this store, read
 * from the server with the requests (`allowed`). A capability they
 * switched off is not rendered at all — an offered button that always
 * refuses teaches people to ignore refusals. One set to "ask the seller"
 * is offered and says so, because the difference matters to whoever has
 * a customer waiting on the answer.
 */
const ACTIONS: ReadonlyArray<{
  readonly kind: StoreActionKind;
  /** The policy column that governs it. */
  readonly capability: string;
  readonly label: string;
  readonly ask: string;
}> = [
  {
    kind: 'RECALL',
    capability: 'recall',
    label: 'Call the customer again',
    ask: 'Our call centre will ring them. Say what they should be asked.',
  },
  {
    kind: 'REATTEMPT',
    capability: 'reattempt',
    label: 'Try delivering again',
    ask: 'The courier is asked to attempt the delivery again. Say what changed — a corrected landmark, a time they will be in.',
  },
  {
    kind: 'RTO',
    capability: 'sendBack',
    label: 'Send it back',
    ask: 'The parcel stops going to the customer and comes back to the warehouse. Say why.',
  },
];

function actionLabel(kind: StoreActionKind): string {
  return ACTIONS.find((a) => a.kind === kind)?.label ?? kind;
}

function OrderActions({
  orderId,
  stageOpen,
}: {
  orderId: string;
  /** The order is out for delivery or has just failed — the only time these apply. */
  stageOpen: boolean;
}): ReactElement {
  const actions = useStoreOrderActions(orderId);
  const submit = useRequestStoreAction();
  const toast = useToast();
  const [asking, setAsking] = useState<(typeof ACTIONS)[number] | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function send(): Promise<void> {
    if (asking === null) return;
    setError(null);
    try {
      const out = await submit.mutateAsync({
        orderId,
        action: asking.kind,
        reason: reason.trim(),
      });
      // The REPLY says what actually happened (2026-09-17): waiting on
      // Seller staff, done, or refused — a send-back the courier turns
      // down comes back FAILED with the reason.
      if (out.request.status === 'FAILED') {
        setError(out.request.executionError ?? 'It could not be carried out.');
        return;
      }
      toast.success(
        out.awaitingSeller
          ? 'Sent to Seller staff to approve. Nothing happens until they answer.'
          : 'Done.',
      );
      setAsking(null);
      setReason('');
    } catch (err) {
      // Verbatim (FE-2): DELIVERY_ACTION_REASON_TOO_SHORT,
      // DELIVERY_ACTION_ALREADY_OPEN, STORE_ACTION_NOT_ALLOWED…
      setError(serverVerdict(err));
    }
  }

  if (actions.isPending) return <LoadingState label="Loading what you can ask for" rows={2} />;
  if (actions.isError) {
    return (
      <ErrorState message={serverVerdict(actions.error)} retry={() => void actions.refetch()} />
    );
  }

  const offered = ACTIONS.filter((a) => actions.data.allowed[a.capability] !== 'OFF');
  const history = actions.data.items;
  if (offered.length === 0 && history.length === 0) return <></>;

  return (
    <Section
      title="Something wrong with the delivery?"
      subtitle="What you can ask for is set by the seller. Some of it happens straight away; some goes to them first."
    >
      <Card>
        <CardBody>
          {offered.length === 0 ? (
            <p className="text-text-muted text-sm">
              The seller has not enabled any of these for your store.
            </p>
          ) : !stageOpen ? (
            <p className="text-text-muted text-sm">
              Calling the customer again, another delivery attempt and sending the parcel back are
              available only while the parcel is out for delivery or has just failed to deliver.
            </p>
          ) : (
            <div className="space-y-2">
              {offered.map((a) => {
                const waits = actions.data.allowed[a.capability] === 'ASK_SELLER';
                return (
                  <div key={a.kind} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <Button
                      variant="secondary"
                      size="md"
                      onClick={() => {
                        setError(null);
                        setReason('');
                        setAsking(a);
                      }}
                    >
                      {a.label}
                    </Button>
                    <span className="text-text-muted text-xs">
                      {waits
                        ? 'The seller approves this one before anything happens'
                        : 'Happens as soon as you ask'}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {history.length > 0 ? (
            <div className="mt-4">
              <Table>
                <THead>
                  <Tr>
                    <Th>What you asked</Th>
                    <Th>When</Th>
                    <Th>Where it got to</Th>
                  </Tr>
                </THead>
                <TBody>
                  {history.map((r) => (
                    <Tr key={r.id}>
                      <Td>
                        <div>{actionLabel(r.action)}</div>
                        <div className="text-text-faint text-xs">{r.reason}</div>
                      </Td>
                      <Td className="text-text-muted text-xs">{when(r.createdAt)}</Td>
                      <Td>
                        <DeliveryActionStatusBadge status={r.status} />
                        {r.decisionNote !== null ? (
                          <div className="text-text-muted mt-1 text-xs">
                            They said: “{r.decisionNote}”
                          </div>
                        ) : null}
                        {r.executionError !== null ? (
                          <div className="text-critical mt-1 text-xs">{r.executionError}</div>
                        ) : null}
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </div>
          ) : null}
        </CardBody>
      </Card>

      <Modal
        open={asking !== null}
        onOpenChange={(open) => {
          if (!open) setAsking(null);
        }}
        title={asking?.label ?? ''}
        description={
          asking === null
            ? undefined
            : actions.data.allowed[asking.capability] === 'ASK_SELLER'
              ? 'The seller sees this and decides. Nothing happens to the parcel until they answer.'
              : 'This is carried out as soon as you send it.'
        }
      >
        <div className="space-y-4">
          <FormField
            label="What happened"
            htmlFor="action-reason"
            hint="At least a sentence — a person reads this before acting on it."
            required
          >
            <Textarea
              id="action-reason"
              rows={4}
              maxLength={2000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={asking?.ask ?? ''}
            />
          </FormField>
          {error !== null ? (
            <p role="alert" className="text-critical text-sm">
              {error}
            </p>
          ) : null}
          <ModalFooter>
            <Button
              type="button"
              variant="secondary"
              size="md"
              onClick={() => setAsking(null)}
              disabled={submit.isPending}
            >
              Never mind
            </Button>
            <Button
              type="button"
              variant="primary"
              size="md"
              onClick={() => void send()}
              disabled={submit.isPending}
            >
              {submit.isPending ? 'Sending…' : 'Send it'}
            </Button>
          </ModalFooter>
        </div>
      </Modal>
    </Section>
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
      <Section
        title="We could not reach your customer"
        subtitle="Nothing happens on this order until it is answered. The stock stays held in the meantime."
      >
        <Card>
          <CardBody>
            <p className="text-text-muted text-sm">
              Seller staff answer this question for your store. Ask your seller whether to keep
              trying.
            </p>
          </CardBody>
        </Card>
      </Section>
    );
  }

  return (
    <Section
      title="We could not reach your customer"
      subtitle="Nothing happens on this order until you answer. The stock stays held in the meantime."
    >
      {reviews.isPending ? (
        <LoadingState label="Loading the question" rows={1} />
      ) : reviews.isError ? (
        <ErrorState message={serverVerdict(reviews.error)} retry={() => void reviews.refetch()} />
      ) : review === undefined ? (
        <Card>
          <CardBody>
            <p className="text-text-muted text-sm">
              This order is waiting on an answer about further call attempts.{' '}
              <Link href="/orders/call-reviews" className="text-accent hover:underline">
                See everything waiting on you
              </Link>
            </p>
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardBody>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm">
                We have rung them {review.attemptCount} time
                {review.attemptCount === 1 ? '' : 's'} without an answer, and {review.heldQty} unit
                {review.heldQty === 1 ? '' : 's'} of your seller’s stock{' '}
                {review.heldQty === 1 ? 'is' : 'are'} held for this order.
              </p>
              <CallReviewDecision
                review={review}
                orderNumber={orderNumber}
                triggerLabel={mode === 'ASK_SELLER' ? 'Propose an answer' : 'Answer this'}
                triggerVariant="primary"
                mode={mode}
              />
            </div>
          </CardBody>
        </Card>
      )}
    </Section>
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
    <div className="space-y-1 text-sm">
      <p>
        Something wrong with this order that the seller should put right?{' '}
        <Link
          href={`/tickets/new?orderId=${orderId}&with=seller`}
          className="text-accent hover:underline"
        >
          Raise it with your seller
        </Link>
      </p>
      {chase === 'OFF' ? null : (
        <p>
          Damaged, lost or stuck with Skydrop?{' '}
          <Link
            href={`/tickets/new?orderId=${orderId}&with=skydrop`}
            className="text-accent hover:underline"
          >
            Raise it with Skydrop
          </Link>
          <span className="text-text-faint">
            {chase === 'ASK_SELLER'
              ? ' — Seller staff approve it first; it reaches Skydrop once they say yes.'
              : ' — your seller is not told.'}
          </span>
        </p>
      )}
    </div>
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
  if (requests.isPending)
    return <LoadingState label="Loading what you asked the seller" rows={1} />;
  if (requests.isError) {
    return (
      <ErrorState message={serverVerdict(requests.error)} retry={() => void requests.refetch()} />
    );
  }
  if (requests.data.length === 0) return <></>;
  return (
    <Section
      title="Sent to your seller to approve"
      subtitle="Nothing on these happens until Seller staff answer. A request nobody answers closes after a few days — follow up with your seller if that happens."
    >
      <Table>
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
                {r.note !== null ? <div className="text-text-faint text-xs">{r.note}</div> : null}
              </Td>
              <Td className="text-text-muted text-xs">{when(r.createdAt)}</Td>
              <Td>
                <StoreOrderRequestStatusBadge status={r.status} />
                {r.decisionNote !== null ? (
                  <div className="text-text-muted mt-1 text-xs">They said: “{r.decisionNote}”</div>
                ) : null}
                {r.failureReason !== null ? (
                  <div className="text-critical mt-1 text-xs">Not done — {r.failureReason}</div>
                ) : null}
              </Td>
            </Tr>
          ))}
        </TBody>
      </Table>
    </Section>
  );
}

function Timeline({ orderId }: { orderId: string }): ReactElement {
  const events = useStoreOrderEvents(orderId);
  return (
    <Section title="Timeline">
      {events.isPending ? (
        <LoadingState label="Loading the timeline" rows={3} />
      ) : events.isError ? (
        <ErrorState message={serverVerdict(events.error)} retry={() => void events.refetch()} />
      ) : events.data.length === 0 ? (
        <p className="text-text-muted text-sm">Nothing has happened to this order yet.</p>
      ) : (
        <ol className="space-y-2">
          {events.data.map((e) => (
            <li key={e.id} className="text-sm">
              <span className="text-text-muted text-xs">{when(e.createdAt)}</span>{' '}
              <span className="text-text-body">
                {e.toStatus !== null ? statusLabel(e.toStatus) : (e.description ?? e.type)}
              </span>
              {e.toStatus !== null && e.description !== null ? (
                <span className="text-text-faint"> — {e.description}</span>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}

/**
 * What a person calls each delivery detail.
 *
 * All ten, not just the ones the form below offers: a correction made
 * through the API or a CSV may carry one the form does not, and the
 * history has to be able to name it.
 */
const FIELD_LABEL: Readonly<Record<AddressField, string>> = {
  recipientName: 'Name',
  recipientPhoneE164: 'Phone',
  recipientAltPhoneE164: 'Second phone',
  recipientEmail: 'Email',
  recipientAddressLine1: 'Address',
  recipientAddressLine2: 'Landmark line',
  recipientLandmark: 'Landmark (old field)',
  recipientCity: 'City',
  recipientStateProvince: 'State',
  recipientPostalCode: 'PIN code',
};

/** The same ten in reading order, for listing what a correction proposed. */
const ALL_FIELDS: readonly AddressField[] = [
  'recipientName',
  'recipientPhoneE164',
  'recipientAltPhoneE164',
  'recipientEmail',
  'recipientAddressLine1',
  'recipientAddressLine2',
  'recipientLandmark',
  'recipientCity',
  'recipientStateProvince',
  'recipientPostalCode',
];

/**
 * The nine the form offers, in the order somebody reads an address.
 *
 * `recipientLandmark` is deliberately NOT one of them: nothing sends it
 * to the courier — a landmark reaches a driver on the second address
 * line — so asking for it here would collect something that changes
 * nothing on the parcel.
 */
const FORM_FIELDS: ReadonlyArray<{
  readonly key: AddressField;
  readonly hint?: string;
  readonly current: (r: StoreOrderView['recipient']) => string;
}> = [
  { key: 'recipientName', current: (r) => r.name },
  {
    key: 'recipientPhoneE164',
    hint: 'With the country code, e.g. +919876543210',
    current: (r) => r.phoneE164,
  },
  { key: 'recipientAltPhoneE164', current: (r) => r.altPhoneE164 ?? '' },
  { key: 'recipientEmail', current: (r) => r.email ?? '' },
  { key: 'recipientAddressLine1', current: (r) => r.addressLine1 },
  {
    key: 'recipientAddressLine2',
    hint: 'The landmark goes here — it is what a driver finds a rural address by.',
    current: (r) => r.addressLine2 ?? '',
  },
  { key: 'recipientCity', current: (r) => r.city },
  { key: 'recipientStateProvince', current: (r) => r.stateProvince },
  { key: 'recipientPostalCode', current: (r) => r.postalCode },
];

/**
 * Only what actually changed.
 *
 * A box left BLANK is left alone rather than cleared — somebody emptying
 * a field they did not mean to touch should not wipe a phone number off
 * a live parcel, and there is nothing the courier needs that is better
 * absent than wrong.
 */
function proposedChanges(
  draft: Partial<Record<AddressField, string>>,
  recipient: StoreOrderView['recipient'],
): AddressChangeFields {
  const out: AddressChangeFields = {};
  for (const f of FORM_FIELDS) {
    const next = (draft[f.key] ?? '').trim();
    if (next !== '' && next !== f.current(recipient).trim()) out[f.key] = next;
  }
  return out;
}

/**
 * Correcting where this parcel is going.
 *
 * WHICH of the three things happens is the seller's `addressFix` policy
 * for this store, read from the server with the history (`mode`): OFF is
 * not offered at all — an offered button that always refuses teaches
 * people to ignore refusals, the same reasoning as `OrderActions` above;
 * DIRECT is written onto the order as you send it; ASK_SELLER is held
 * until seller staff answer, and the parcel keeps the OLD address in the
 * meantime.
 *
 * The one case where OFF still renders is a store that HAS corrected
 * this order before. Switching the capability off afterwards should not
 * erase what was already asked and answered — nothing is being offered
 * there, only remembered.
 */
function AddressCorrection({
  orderId,
  recipient,
  stageOpen,
}: {
  orderId: string;
  recipient: StoreOrderView['recipient'];
  /** Before the call confirms the order — the only time the details can change. */
  stageOpen: boolean;
}): ReactElement {
  const changes = useStoreAddressChanges(orderId);
  const submit = useEditStoreRecipient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Partial<Record<AddressField, string>>>({});
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mode = changes.data?.mode ?? 'OFF';
  const waits = mode === 'ASK_SELLER';
  const proposed = proposedChanges(draft, recipient);
  const changedCount = Object.keys(proposed).length;

  function start(): void {
    // Pre-filled with what the parcel says NOW, so the person edits the
    // address in front of them instead of retyping one from memory.
    const seeded: Partial<Record<AddressField, string>> = {};
    for (const f of FORM_FIELDS) seeded[f.key] = f.current(recipient);
    setDraft(seeded);
    setReason('');
    setError(null);
    setOpen(true);
  }

  async function send(): Promise<void> {
    setError(null);
    try {
      const out = await submit.mutateAsync({
        orderId,
        fields: proposed,
        ...(waits ? { reason: reason.trim() } : {}),
      });
      // The REPLY says which of the two happened — never the mode read
      // when the page loaded, because seller staff may have changed the
      // policy since.
      toast.success(
        out.applied
          ? 'Corrected. The parcel now goes to the new address.'
          : 'Sent to seller staff. The parcel keeps the old address until they answer.',
      );
      setOpen(false);
    } catch (err) {
      // Verbatim (FE-2): ADDRESS_CHANGE_REASON_REQUIRED,
      // ADDRESS_CHANGE_ALREADY_OPEN, STORE_ACTION_NOT_ALLOWED,
      // NOT_EDITABLE, EDIT_DURING_CALL…
      setError(serverVerdict(err));
    }
  }

  if (changes.isPending) return <LoadingState label="Loading the delivery details" rows={2} />;
  if (changes.isError) {
    return (
      <ErrorState message={serverVerdict(changes.error)} retry={() => void changes.refetch()} />
    );
  }

  const history = changes.data.items;
  // Open means PENDING or APPROVED (still being applied) — the server
  // refuses a second correction while either exists.
  const pending = history.find((r) => r.status === 'PENDING' || r.status === 'APPROVED') ?? null;
  if (mode === 'OFF' && history.length === 0) return <></>;

  return (
    <Section
      title="Wrong address?"
      subtitle={
        mode === 'OFF'
          ? 'Your seller does not allow this store to change delivery details.'
          : !stageOpen
            ? 'Delivery details can be corrected only until the customer confirms the order on our call.'
            : waits
              ? 'Seller staff read the correction and decide. Nothing on the parcel changes until they answer.'
              : 'A correction here is written onto the order straight away.'
      }
    >
      <Card>
        <CardBody>
          {mode === 'OFF' ? (
            <p className="text-text-muted text-sm">
              Ask the seller if the delivery details need to change.
            </p>
          ) : !stageOpen ? (
            <p className="text-text-muted text-sm">
              This order is past that stage, so the details on the parcel stand. If they are wrong,
              tell your seller — once the parcel is out for delivery you can also ask for another
              attempt or for it to be sent back.
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Button variant="secondary" size="md" disabled={pending !== null} onClick={start}>
                Correct the address
              </Button>
              <span className="text-text-muted text-xs">
                {pending !== null
                  ? 'A correction on this order is still open with seller staff — it has to be finished before you can send another.'
                  : waits
                    ? 'Seller staff approve this one before anything changes'
                    : 'Happens as soon as you send it'}
              </span>
            </div>
          )}

          {history.length > 0 ? (
            <div className="mt-4">
              <Table>
                <THead>
                  <Tr>
                    <Th>What you asked to change</Th>
                    <Th>Why</Th>
                    <Th>When</Th>
                    <Th>Where it got to</Th>
                  </Tr>
                </THead>
                <TBody>
                  {history.map((r) => (
                    <Tr key={r.id}>
                      <Td>
                        <ul className="space-y-0.5">
                          {ALL_FIELDS.filter((k) => r.fields[k] !== undefined).map((k) => (
                            <li key={k} className="text-xs">
                              <span className="text-text-muted">{FIELD_LABEL[k]}: </span>
                              <span className="text-text-body">{r.fields[k] ?? ''}</span>
                            </li>
                          ))}
                        </ul>
                      </Td>
                      <Td className="max-w-xs">
                        <span className="text-text-faint text-xs">{r.reason}</span>
                      </Td>
                      <Td className="text-text-muted text-xs">{when(r.createdAt)}</Td>
                      <Td>
                        <StoreAddressChangeStatusBadge status={r.status} />
                        {r.decisionNote !== null ? (
                          <div className="text-text-muted mt-1 text-xs">
                            They said: “{r.decisionNote}”
                          </div>
                        ) : null}
                        {/* Seller staff said yes and the order had already
                            moved on. Loud, because somebody here has to
                            tell a customer the address did NOT change. */}
                        {r.failureReason !== null ? (
                          <div className="text-critical mt-1 text-xs">
                            Not applied — {r.failureReason}
                          </div>
                        ) : null}
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </div>
          ) : null}
        </CardBody>
      </Card>

      <Modal
        open={open}
        onOpenChange={(next) => {
          if (!next) setOpen(false);
        }}
        title="Correct the delivery address"
        description={
          waits
            ? 'Seller staff decide this one. The parcel keeps the OLD address until they answer.'
            : 'This is written onto the order as soon as you send it.'
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {FORM_FIELDS.map((f) => (
              <FormField
                key={f.key}
                label={FIELD_LABEL[f.key]}
                htmlFor={`fix-${f.key}`}
                {...(f.hint === undefined ? {} : { hint: f.hint })}
              >
                <Input
                  id={`fix-${f.key}`}
                  value={draft[f.key] ?? ''}
                  onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                />
              </FormField>
            ))}
          </div>
          {waits ? (
            <FormField
              label="Why the details are wrong"
              htmlFor="fix-reason"
              hint="At least a sentence — seller staff read this before deciding."
              required
            >
              <Textarea
                id="fix-reason"
                rows={3}
                maxLength={2000}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </FormField>
          ) : null}
          <p className="text-text-faint text-xs">
            {changedCount === 0
              ? 'Nothing has changed yet — edit a detail above.'
              : `Sending ${changedCount} change${changedCount === 1 ? '' : 's'}. A box left as it is stays as it is.`}
          </p>
          {error !== null ? (
            <p role="alert" className="text-critical text-sm">
              {error}
            </p>
          ) : null}
          <ModalFooter>
            <Button
              type="button"
              variant="secondary"
              size="md"
              onClick={() => setOpen(false)}
              disabled={submit.isPending}
            >
              Never mind
            </Button>
            <Button
              type="button"
              variant="primary"
              size="md"
              onClick={() => void send()}
              disabled={submit.isPending || changedCount === 0}
            >
              {submit.isPending ? 'Sending…' : waits ? 'Send it to seller staff' : 'Correct it'}
            </Button>
          </ModalFooter>
        </div>
      </Modal>
    </Section>
  );
}
