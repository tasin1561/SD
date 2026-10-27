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
import type { Locale } from '@skydrop/ui/app/i18n';
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
import { richMessage, useLocale, useT } from '@/i18n/client';
import { formatDateTime } from '@/i18n/format';
import { verdict } from '@/i18n/verdict';
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
  const t = useT();

  return (
    <div className="ro-page">
      <BackLink href="/orders" icon={<ArrowLeft size={14} aria-hidden />}>
        {t('ordd.back')}
      </BackLink>
      {order.isPending ? (
        <SkeletonRows rows={6} cols={3} label={t('ordd.loading')} />
      ) : order.isError ? (
        <ErrorState message={verdict(order.error, t)} retry={() => void order.refetch()} />
      ) : (
        <OrderBody order={order.data} />
      )}
    </div>
  );
}

function OrderBody({ order: o }: { order: StoreOrderView }): ReactElement {
  const t = useT();
  const locale = useLocale();
  const when = (iso: string): string => formatDateTime(iso, locale);
  const me = useStoreIdentity();
  const toast = useToast();
  const cancel = useCancelStoreOrder();
  // What the seller lets this store do, and how. Cosmetic (FE-2): each
  // action is still refused by name on the server.
  const policy = useStoreActionPolicy();
  /*
    ASSOC-1 — whether this response CARRIES the store's cost, read off
    the response itself rather than off the signed-in person's role.
    The server decided it (it is the boundary, FE-2); asking the role
    here would be a second copy of that decision, and the copy that
    drifted would be the one rendering somebody else's margin.

    Every line of one order is decided together server-side, so the
    first line answers for the table's column.
  */
  const showsCost = o.totals.cost.visible;
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
      toast.success(out.applied ? t('ordd.toast.cancelled') : t('ordd.toast.sentToSeller'));
      setConfirming(false);
    } catch (err) {
      setError(verdict(err, t));
      setConfirming(false);
    }
  }

  const cancelLabel = cancelNeedsSeller ? t('ordd.cancelBtn.send') : t('ordd.cancelBtn.cancel');
  const parcels = o.shipments.filter((s) => s.awbNumber !== null);

  return (
    <>
      <PageHeader
        title={<span className="sk-ident">{o.orderNumber}</span>}
        subtitle={
          o.sellerOrderRef === null ? (
            t('ordd.placed', { when: when(o.placedAt) })
          ) : (
            <span>
              {richMessage(t('ordd.placedRef', { when: when(o.placedAt) }), {
                ref: <span className="sk-ident">{o.sellerOrderRef}</span>,
              })}
            </span>
          )
        }
        meta={<StatusChip kind={orderStatusKind(o.status)} label={statusLabel(o.status, locale)} />}
        action={
          // Only while the order's stage still allows a cancel (until it is
          // packed) — past that the button could only ever be refused.
          !o.terminal && o.stages.cancel && can(me, 'orders.cancel') && cancelMode !== 'OFF' ? (
            <Button
              variant="ghost"
              icon={<XCircle size={15} />}
              onClick={() => setConfirming(true)}
            >
              {cancelNeedsSeller ? t('ordd.askCancel') : t('ordd.cancelOrder')}
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
        <RoSection title={t('ordd.customer')}>
          <Facts
            items={[
              { label: t('ordd.name'), value: o.recipient.name },
              {
                label: t('ordd.phone'),
                value: (
                  <span className="sk-figure">
                    {o.recipient.phoneE164}
                    {o.recipient.altPhoneE164 !== null ? ` / ${o.recipient.altPhoneE164}` : ''}
                  </span>
                ),
              },
              ...(o.recipient.email !== null
                ? [{ label: t('ordd.email'), value: <span>{o.recipient.email}</span> }]
                : []),
              {
                label: t('ordd.address'),
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

        <RoSection title={t('ordd.money')}>
          <div className="ro-stack ro-stack--tight">
            <Facts
              items={[
                {
                  label: t('ordd.payment'),
                  value: o.paymentMode === 'COD' ? t('ordd.cod') : t('ordd.prepaid'),
                },
                {
                  label: t('ordd.toCollect'),
                  value:
                    o.codAmountInr === null ? (
                      '—'
                    ) : (
                      <Money amount={o.codAmountInr} convert={false} />
                    ),
                },
                {
                  label: t('ordd.soldFor'),
                  value: <Money amount={o.totals.retailInr} convert={false} />,
                },
                // ASSOC-1 — withheld from an associate, who is not a
                // party to what the store pays its seller. The row is
                // left out rather than shown as "—", which would say
                // "nothing" about a figure that exists.
                ...(o.totals.cost.visible
                  ? [
                      {
                        label: t('ordd.youPayClient'),
                        value: <Money amount={o.totals.cost.transferInr} convert={false} />,
                      },
                    ]
                  : []),
                {
                  label: t('ordd.terms'),
                  value:
                    o.termsVersion === null
                      ? '—'
                      : t('ordd.termsVersion', { version: o.termsVersion }),
                },
              ]}
            />
            <p className="ro-faint">{t('ordd.fixedNote')}</p>
          </div>
        </RoSection>
      </div>

      <RoSection title={t('ordd.products')} flush>
        <Table caption={t('ordd.products')}>
          <THead>
            <Tr>
              <Th>{t('ordd.col.product')}</Th>
              <Th align="right">{t('ordd.col.qty')}</Th>
              <Th align="right">{t('ordd.col.soldAt')}</Th>
              {/* ASSOC-1 — the column itself goes for an associate. */}
              {showsCost ? <Th align="right">{t('ordd.col.youPay')}</Th> : null}
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
                {l.cost.visible ? (
                  <Td align="right">
                    {l.cost.transferPriceInr === null ? (
                      '—'
                    ) : (
                      <Money amount={l.cost.transferPriceInr} convert={false} />
                    )}
                  </Td>
                ) : null}
              </Tr>
            ))}
          </TBody>
        </Table>
      </RoSection>

      {parcels.length > 0 ? (
        <RoSection title={t('ordd.parcel')}>
          <ul className="ro-offers">
            {parcels.map((s) => (
              <li key={s.awbNumber ?? s.courierCode} className="ro-offer">
                <Truck size={15} aria-hidden />
                <span>
                  {richMessage(t('ordd.waybill', { courier: s.courierCode }), {
                    awb: <span className="sk-ident">{s.awbNumber}</span>,
                  })}
                </span>
                <StatusChip
                  kind={shipmentStatusKind(s.status as ShipmentStatus)}
                  label={statusLabel(s.status as ShipmentStatus, locale)}
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

      {/*
        ASSOC-1 — the money plan is refused outright for an associate
        (403 `STORE_MONEY_NOT_FOR_ASSOCIATE`), so the panel is not
        mounted rather than mounted and left to render its own refusal.
        Read off the SAME flag the response carried: the server decided
        it, and asking the role here would be a second copy of that
        decision. Cosmetic either way (FE-2).
      */}
      {showsCost ? <OrderMoney orderId={o.id} /> : null}

      {can(me, 'tickets.manage') ? (
        <RaiseTicketLinks orderId={o.id} chase={policy.data?.chaseSkydrop} />
      ) : null}

      <OrderTimeline orderId={o.id} orderNumber={o.orderNumber} status={o.status} />

      <Dialog
        open={confirming}
        onOpenChange={setConfirming}
        title={
          cancelNeedsSeller
            ? t('ordd.dlg.titleAsk', { order: o.orderNumber })
            : t('ordd.dlg.titleCancel', { order: o.orderNumber })
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
              {t('ordd.dlg.keepIt')}
            </Button>
            <AsyncButton
              variant="destructive"
              state={cancel.isPending ? 'busy' : undefined}
              labels={{ idle: cancelLabel, busy: t('ordd.dlg.sending') }}
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
            o.codAmountInr === null
              ? undefined
              : richMessage(t('ordd.dlg.toCollect'), {
                  amount: <Money amount={o.codAmountInr} convert={false} />,
                })
          }
          consequence={
            cancelNeedsSeller ? t('ordd.dlg.consequence.ask') : t('ordd.dlg.consequence.direct')
          }
        >
          <TextArea
            label={cancelNeedsSeller ? t('ordd.dlg.why.required') : t('ordd.dlg.why.optional')}
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
  const t = useT();
  const reviews = useStoreCallReviews({ enabled: mode !== 'OFF' });
  const review = (reviews.data ?? []).find((r) => r.orderId === orderId);

  if (mode === 'OFF') {
    return (
      <RoSection title={t('ordd.callcap.title')} note={t('ordd.callcap.note.off')}>
        <p className="ro-p">{t('ordd.callcap.body.off')}</p>
      </RoSection>
    );
  }

  return (
    <RoSection title={t('ordd.callcap.title')} note={t('ordd.callcap.note.on')} bare>
      {reviews.isPending ? (
        <SkeletonRows rows={1} cols={2} label={t('ordd.callcap.loading')} />
      ) : reviews.isError ? (
        <ErrorState message={verdict(reviews.error, t)} retry={() => void reviews.refetch()} />
      ) : review === undefined ? (
        <Notice tone="warn" icon={<PhoneMissed size={16} />}>
          <span>
            {t('ordd.callcap.waiting')}{' '}
            <Link href="/orders/call-reviews" className="ro-link">
              {t('ordd.callcap.seeAll')}
            </Link>
          </span>
        </Notice>
      ) : (
        <Notice tone="warn" icon={<PhoneMissed size={16} />}>
          <div className="ro-row ro-row--between">
            <span>
              {t('ordd.callcap.rung', {
                attempts: t(
                  review.attemptCount === 1
                    ? 'ordd.callcap.attempts.one'
                    : 'ordd.callcap.attempts.other',
                  { n: review.attemptCount },
                ),
                held: t(
                  review.heldQty === 1 ? 'ordd.callcap.units.one' : 'ordd.callcap.units.other',
                  {
                    n: review.heldQty,
                  },
                ),
                verb: t(review.heldQty === 1 ? 'ordd.callcap.verb.one' : 'ordd.callcap.verb.other'),
              })}
            </span>
            <CallReviewDecision
              review={review}
              orderNumber={orderNumber}
              triggerLabel={
                mode === 'ASK_SELLER' ? t('ordd.callcap.propose') : t('ordd.callcap.answer')
              }
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
  const t = useT();
  return (
    <Notice tone="neutral" icon={<Flag size={16} />}>
      <p className="ro-body">
        {t('ordd.raise.client')}{' '}
        <Link href={`/tickets/new?orderId=${orderId}&with=seller`} className="ro-link">
          {t('ordd.raise.clientLink')}
        </Link>
      </p>
      {chase === 'OFF' ? null : (
        <p className="ro-body">
          {t('ordd.raise.skydrop')}{' '}
          <Link href={`/tickets/new?orderId=${orderId}&with=skydrop`} className="ro-link">
            {t('ordd.raise.skydropLink')}
          </Link>
          <span className="ro-faint">
            {chase === 'ASK_SELLER' ? t('ordd.raise.approveFirst') : t('ordd.raise.clientNotTold')}
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
  const t = useT();
  const locale = useLocale();
  const requests = useStoreOrderRequests(orderId);
  if (requests.isPending) {
    return <SkeletonRows rows={1} cols={3} label={t('ordd.held.loading')} />;
  }
  if (requests.isError) {
    return (
      <ErrorState message={verdict(requests.error, t)} retry={() => void requests.refetch()} />
    );
  }
  if (requests.data.length === 0) return <></>;
  return (
    <RoSection title={t('ordd.held.title')} note={t('ordd.held.note')} flush>
      <Table caption={t('ordd.held.title')}>
        <THead>
          <Tr>
            <Th>{t('ordd.held.col.asked')}</Th>
            <Th>{t('ordd.held.col.when')}</Th>
            <Th>{t('ordd.held.col.state')}</Th>
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
                <span className="ro-muted sk-figure">{formatDateTime(r.createdAt, locale)}</span>
              </Td>
              <Td>
                <StatusChip
                  kind={storeOrderRequestStatusKind(r.status)}
                  label={storeOrderRequestStatusLabel(r.status)}
                  size="sm"
                />
                {r.decisionNote !== null ? (
                  <p className="ro-quote">{t('ordd.held.theySaid', { note: r.decisionNote })}</p>
                ) : null}
                {r.failureReason !== null ? (
                  <span className="ro-sub ro-tone-bad">
                    {t('ordd.held.notDone', { reason: r.failureReason })}
                  </span>
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
function eventSteps(events: readonly StoreOrderEvent[], locale: Locale): TimelineStep[] {
  return events.map((e, i): TimelineStep => {
    const current = i === events.length - 1;
    return {
      id: e.id,
      label:
        e.toStatus !== null
          ? chipWords(statusLabel(e.toStatus, locale))
          : (e.description ?? e.type),
      state: current ? 'current' : 'done',
      ...(e.toStatus !== null && e.description !== null ? { description: e.description } : {}),
      time: formatDateTime(e.createdAt, locale),
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
  const t = useT();
  const locale = useLocale();
  const events = useStoreOrderEvents(orderId);
  return (
    <RoSection title={t('ordd.timeline')} bare>
      {events.isPending ? (
        <SkeletonRows rows={3} cols={2} label={t('ordd.timeline.loading')} />
      ) : events.isError ? (
        <ErrorState message={verdict(events.error, t)} retry={() => void events.refetch()} />
      ) : events.data.length === 0 ? (
        <EmptyState bare icon={<Route size={20} />} title={t('ordd.timeline.empty')} />
      ) : (
        <div className="ro-card">
          <Timeline
            label={t('ordd.timeline.label')}
            steps={eventSteps(events.data, locale)}
            header={{
              icon: <Route size={16} />,
              title: t('ordd.timeline.header'),
              id: orderNumber,
              status: (
                <StatusChip
                  kind={orderStatusKind(status)}
                  label={statusLabel(status, locale)}
                  size="sm"
                />
              ),
            }}
          />
        </div>
      )}
    </RoSection>
  );
}
