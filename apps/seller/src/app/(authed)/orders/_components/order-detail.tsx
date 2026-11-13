'use client';

import Link from 'next/link';

import {
  AlertTriangle,
  ArrowLeft,
  Clock,
  CreditCard,
  Download,
  FileText,
  Activity,
  MapPin,
  Package,
  Pencil,
  Receipt,
  StickyNote,
  Truck,
  XCircle,
} from 'lucide-react';
import { useState, type ReactElement } from 'react';
import { useDeliveryActions } from '@/lib/ops-hooks';
import type { OrderView } from '@skydrop/api-client';
import {
  useGenerateInvoice,
  useOrderDetail,
  useOrderReattemptRequests,
  useOrderInvoice,
  useOrderJourney,
} from '@/lib/api-hooks';
import { Money, ProductThumb } from '@skydrop/ui/components';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { ConfirmDialog } from '@skydrop/ui/app/dialog';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { Table, TBody, THead, TableEmpty, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import { ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { useToast } from '@skydrop/ui/app/toast';
import { DeliveryTroublePanel } from '../[id]/_components/delivery-trouble-panel';
import { CancelOrderDialog } from './cancel-order-dialog';
import { RequestReturnDialog } from './request-return-dialog';
import { ReattemptRequestDialog } from './reattempt-request-dialog';
import { OrderChargesSection } from './order-charges';
import { CsvExtrasSection } from './csv-extras';
import { BackLink, Facts, Notice } from './orders-parts';
import { verdict } from '@/i18n/verdict';
import { packageWords } from '@/lib/package-type';
import { can } from '@/lib/page-access';
import { useSellerIdentity } from '@skydrop/auth/client';
import { OrderTicketsPanel } from '../[id]/_components/order-tickets-panel';
import { ConsigneePanel } from '../[id]/_components/consignee-panel';
import { useOrderAddressCheck } from '@/lib/address-check-hooks';
import { ResellerMoneyPanel } from '../[id]/_components/reseller-money-panel';
import { UnreachableCustomerPanel } from '../[id]/_components/unreachable-customer-panel';
import { useT, useLocale } from '@/i18n/client';
import { richMessage } from '@/i18n/rich';
import { DetailCard } from './detail/detail-card';
import { CopyButton } from './detail/copy-button';
import { fmtWhen } from './detail/format';
import { OrderHeader, type HeaderActions } from './detail/order-header';
import { OrderStepper } from './detail/order-stepper';
import { OrderActivity } from './detail/order-activity';
import { ParcelFacts, collectableMismatch } from './detail/parcel-facts';
import { AddressCheckView, addressNeedsFix } from './detail/address-check-view';
import { OrderSkeleton } from './detail/order-skeleton';
import { nextMilestoneKey, summaryFor } from './detail/summary';
import './detail/order-detail.css';

/** The public tracking site. Env-driven so a domain change is a deploy
 *  variable rather than a code edit. */
const TRACK_URL = process.env.NEXT_PUBLIC_TRACK_URL ?? 'https://track.skydrop.global';

/**
 * Seller order detail. Two fetches: the order body (with items) and
 * the seller-visible lifecycle timeline (server filters to
 * `isVisibleToSeller=true` events). The page is a layout over the same
 * panels as before — header with its actions, a banner zone, a two-sentence
 * summary, the stepper, then two columns of cards — and every control opens
 * the same dialog or flow it always did.
 */
/**
 * The states a seller may cancel from — until the parcel is packed.
 * COSMETIC ONLY (FE-2): this decides whether the button is offered, and
 * the server decides whether the cancel happens. Mirrors the API's
 * SELLER_CANCELLABLE_STATES; if the two ever drift the seller sees a
 * verbatim refusal rather than a wrong outcome.
 */
/**
 * Statuses worth ASKING the server about a re-attempt on.
 *
 * Only a gate on the round trip, never the answer: which of these
 * actually qualifies is a per-seller setting, and the server returns
 * `canRequest`. Deliberately wider than the current default, so turning
 * REJECTED_NDR on in settings needs no frontend change.
 */
const FAILED_STATUSES: ReadonlySet<string> = new Set([
  'REJECTED_BY_CUSTOMER',
  'REJECTED_NDR',
  'REJECTED',
  // AWAITING_SELLER_DECISION is deliberately NOT here (2026-09-27). R5b's
  // pause is answered by `UnreachableCustomerPanel` — "Keep trying" puts
  // the order back in the call queue AND closes the review that is
  // holding the stock. A re-attempt request would make the same
  // transition and leave that review OPEN, so the TTL sweep would later
  // reject the order it had just re-queued. One button, not two.
]);

const CANCELLABLE: ReadonlySet<string> = new Set([
  'DRAFT',
  'PENDING_CONFIRMATION',
  'CALL_NO_RESPONSE',
  'CALL_RESCHEDULED',
  'AWAITING_SELLER_DECISION',
  // CUR-17 — held for a carrier decision. Nothing has been booked and
  // nothing has been picked, so this is one of the cheapest points in
  // the whole lifecycle to change your mind.
  'AWAITING_COURIER',
  'CONFIRMED',
  'OUT_OF_STOCK',
  'PENDING_PICK',
  'PICKED',
  'PACK_FAILED',
  'PENDING_MANUAL_PLACEMENT',
]);

function Dash(): ReactElement {
  return <span className="cod-faint">—</span>;
}

export function OrderDetailView({ orderId }: { orderId: string }): ReactElement {
  const locale = useLocale();
  const t = useT();
  const detail = useOrderDetail(orderId);
  // Asked for any FAILED status, because which of them qualifies is a
  // per-seller setting the server owns — not something to guess here.
  // Still not asked on a healthy order: that would be a round trip per
  // page view for a list that is always empty.
  const failed = detail.data !== undefined && FAILED_STATUSES.has(detail.data.status);
  const reattempts = useOrderReattemptRequests(orderId, { enabled: failed });
  const requests = reattempts.data?.requests ?? [];
  const canRequest = reattempts.data?.canRequest ?? false;
  const pendingRequest = requests.find((r) => r.status === 'PENDING') ?? null;
  const lastDecided = requests.find((r) => r.status !== 'PENDING') ?? null;
  const identity = useSellerIdentity();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [reattemptOpen, setReattemptOpen] = useState(false);
  // The two actions promoted to the header. `useDeliveryActions` is the
  // SAME query key the trouble panel uses, so asking here costs nothing
  // — TanStack serves both from one fetch — and it keeps the header
  // from offering a button the server would refuse.
  // The consignee editor is HIDDEN until asked for. It shows the same
  // three fields the Recipient card already shows, so having both open
  // at once was the same data twice, a screen apart — and the editable
  // copy was the one that got read first. It now opens IN PLACE, inside
  // the Recipient card.
  const [editingCustomer, setEditingCustomer] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [raiseOpen, setRaiseOpen] = useState(false);
  const deliveryActions = useDeliveryActions(orderId);
  const canAsk = deliveryActions.data?.canRequest === true;
  const words = { today: t('orderPage.today'), yesterday: t('orderPage.yesterday') };

  if (detail.isLoading) return <OrderSkeletonPage />;

  if (detail.isError || !detail.data) {
    return (
      <div className="cod-page">
        <BackLink href="/orders" icon={<ArrowLeft size={14} aria-hidden />}>
          {t('orderDetail.orders')}
        </BackLink>
        {detail.isError ? (
          <ErrorState
            message={detail.error?.message ?? t('orderDetail.failedToLoadOrder')}
            retry={() => void detail.refetch()}
          />
        ) : (
          <ErrorState message={t('orderDetail.orderNotFound')} />
        )}
      </div>
    );
  }

  const order = detail.data;

  const actions: HeaderActions = {
    askAdmin: canAsk ? () => setAskOpen(true) : null,
    raiseIssue: () => setRaiseOpen(true),
    // A Reseller store's order is EDITABLE HERE TOO (owner, 2026-09-18). You
    // own the goods, the warehouse slot, the courier and the money at risk,
    // so the whole order is yours to change — its products, quantities,
    // prices and the customer's details. The store is emailed what moved,
    // and its money is recalculated to the new order under the terms it
    // was placed on.
    editHref:
      order.status === 'DRAFT' || order.status === 'PENDING_CONFIRMATION'
        ? `/orders/${orderId}/edit`
        : null,
    // The customer declined, so nothing calls this order again on its own.
    // Asking is the only path — and it is an ASK: an admin decides.
    // `canRequest` is the SERVER's answer — which statuses qualify is a
    // per-seller setting, and it already accounts for the one-open-request
    // rule.
    reattempt:
      canRequest && identity !== null && can(identity, 'orders.create')
        ? {
            label: lastDecided === null ? t('orderDetail.askUsToCall') : t('orderDetail.askAgain'),
            onClick: () => setReattemptOpen(true),
          }
        : null,
    // Only a DELIVERED order can come back — before that a parcel that
    // cannot be delivered returns as an RTO on its own, and offering a
    // button for it would suggest the seller has a choice they do not have.
    requestReturn:
      order.status === 'DELIVERED' && identity !== null && can(identity, 'orders.cancel')
        ? () => setReturnOpen(true)
        : null,
    cancel:
      CANCELLABLE.has(order.status) && identity !== null && can(identity, 'orders.cancel')
        ? () => setCancelOpen(true)
        : null,
  };

  const unreachable = order.status === 'AWAITING_SELLER_DECISION';
  const declined =
    pendingRequest === null && lastDecided !== null && lastDecided.status === 'REJECTED';
  const hasBanner = unreachable || pendingRequest !== null || declined;

  return (
    <div className="cod-page">
      <OrderHeader order={order} actions={actions} />

      {/* ── Banner zone ─────────────────────────────────────────────────
          Directly under the header, above the summary and the stepper.
          THE PAUSE COMES FIRST. R5b holds the order at
          AWAITING_SELLER_DECISION and nothing moves until the seller
          answers; above the re-attempt notices because this one has a
          deadline. */}
      {hasBanner && (
        <div className="cod-banners">
          {unreachable && (
            <UnreachableCustomerPanel orderId={orderId} orderNumber={order.orderNumber} />
          )}

          {pendingRequest !== null && (
            // The ORDER is still REJECTED_BY_CUSTOMER and the chip above
            // says so, because that is what it is until somebody
            // approves. This says what is ALSO true: a request is with
            // us. Two facts, not one overwritten by the other.
            <Notice
              tone="warn"
              icon={<Clock size={18} />}
              title={t('orderDetail.weAreReviewingYour')}
            >
              <span className="ord-p">
                {richMessage(t('orderDetail.sentTheOrderStays'), {
                  createdAt: fmtWhen(pendingRequest.createdAt, locale, words),
                })}
              </span>
              <p className="ord-quote">“{pendingRequest.reason}”</p>
            </Notice>
          )}

          {declined && lastDecided !== null && (
            <Notice
              tone="bad"
              icon={<XCircle size={18} />}
              title={t('orderDetail.weReviewedYourRequest')}
            >
              {lastDecided.decisionNote !== null && lastDecided.decisionNote !== '' && (
                <span className="ord-p">{lastDecided.decisionNote}</span>
              )}
              <span className="ord-faint">{t('orderDetail.youCanAskAgain')}</span>
            </Notice>
          )}
        </div>
      )}

      <OrderBody
        orderId={orderId}
        order={order}
        hasBanner={hasBanner}
        editing={editingCustomer}
        onEdit={() => {
          setEditingCustomer(true);
          // Opened, then scrolled to: revealing the editor without moving
          // there would look like the button did nothing.
          window.setTimeout(
            () =>
              document
                .getElementById('customer-details')
                ?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
            50,
          );
        }}
        onCloseEdit={() => setEditingCustomer(false)}
        askOpen={askOpen}
        onAskOpenChange={setAskOpen}
        raiseOpen={raiseOpen}
        onRaiseOpenChange={setRaiseOpen}
      />

      <ReattemptRequestDialog
        orderId={orderId}
        orderNumber={order.orderNumber}
        open={reattemptOpen}
        onOpenChange={setReattemptOpen}
      />
      <RequestReturnDialog
        orderId={orderId}
        orderNumber={order.orderNumber}
        open={returnOpen}
        onClose={() => setReturnOpen(false)}
      />

      {/* `chargedInr` is what the wallet has actually taken for
          this order and not given back — the figure the refund will
          credit, from the server. It went unpassed from the day the
          dialog was written (found 2026-09-30), so the paragraph
          that names the money had never rendered for anybody, on
          the one screen whose whole argument is that a seller
          should see it before agreeing. Null for an AT_DELIVERY
          seller, whose order is billed on arrival and has taken
          nothing yet. */}
      <CancelOrderDialog
        open={cancelOpen}
        orderId={orderId}
        orderNumber={order.orderNumber}
        status={order.status}
        chargedInr={detail.data.chargedInr ?? null}
        onOpenChange={setCancelOpen}
      />
    </div>
  );
}

function OrderSkeletonPage(): ReactElement {
  return (
    <div className="cod-page">
      <OrderSkeleton />
    </div>
  );
}

/**
 * Everything under the banners: summary, stepper, the two columns.
 *
 * Its own failure surface for the journey rather than one shared with the
 * order body: the journey is enrichment, and a courier read that is briefly
 * unavailable must not blank the recipient and the items a seller came to
 * check.
 */
function OrderBody({
  orderId,
  order,
  hasBanner,
  editing,
  onEdit,
  onCloseEdit,
  askOpen,
  onAskOpenChange,
  raiseOpen,
  onRaiseOpenChange,
}: {
  readonly orderId: string;
  readonly order: OrderView;
  readonly hasBanner: boolean;
  readonly editing: boolean;
  readonly onEdit: () => void;
  readonly onCloseEdit: () => void;
  readonly askOpen: boolean;
  readonly onAskOpenChange: (open: boolean) => void;
  readonly raiseOpen: boolean;
  readonly onRaiseOpenChange: (open: boolean) => void;
}): ReactElement {
  const t = useT();
  const identity = useSellerIdentity();
  const journey = useOrderJourney(orderId);
  const check = useOrderAddressCheck(orderId);
  const checkResult = check.data ?? null;
  const parcels = journey.data?.parcels ?? [];
  // The latest parcel, as the shared panels chose it.
  const parcel = parcels[parcels.length - 1] ?? null;
  const summary = summaryFor({
    status: order.status,
    paymentMode: order.paymentMode,
    codAmountInr: order.codAmountInr,
    nextMilestoneKey: journey.data === undefined ? null : nextMilestoneKey(journey.data.milestones),
    hasBanner,
    addressNeedsFix: addressNeedsFix(checkResult),
    collectableMismatch: collectableMismatch(parcel),
  });

  // "1 line · 1 unit · 500 g." — what the header's facts row used to say.
  const lineCount = order.items.length;
  const unitCount = order.items.reduce((n, i) => n + i.quantity, 0);
  const contents = [
    t(lineCount === 1 ? 'orderPage.lineOne' : 'orderPage.lineMany', { count: lineCount }),
    t(unitCount === 1 ? 'orderPage.unitOne' : 'orderPage.unitMany', { count: unitCount }),
    order.totalWeightGrams === null ? null : `${order.totalWeightGrams} g`,
  ]
    .filter((x): x is string => x !== null)
    .join(' · ')
    .concat('.');
  return (
    <>
      <div className="cod-summary" aria-label={t('orderPage.sum.label')}>
        {/* One paragraph: where it is, what is next, the money, and what is
            in it — the header no longer repeats any of these (owner,
            2026-11-13: "the header is looking too messy"). */}
        <p>
          {summary.where !== null ? t(summary.where) : null}
          {summary.next !== null ? ` ${t(summary.next)}` : null}
          {summary.collectInr !== null ? (
            <>
              {' '}
              {richMessage(t('orderPage.sum.collect'), {
                money: <Money amount={summary.collectInr} size="md" />,
              })}
            </>
          ) : summary.prepaid ? (
            ` ${t('orderPage.sum.prepaid')}`
          ) : null}{' '}
          <span className="cod-summary__contents">{contents}</span>
        </p>
        {summary.addressFix && (
          <p className="cod-summary__warn">
            <AlertTriangle size={16} aria-hidden />
            <a href="#recipient">{t('orderPage.sum.addressFix')}</a>
          </p>
        )}
        {summary.mismatch && (
          <p className="cod-summary__warn">
            <AlertTriangle size={16} aria-hidden />
            <a href="#parcel">{t('orderPage.sum.mismatch')}</a>
          </p>
        )}
      </div>

      {journey.isPending ? (
        <div className="cod-stepper cod-stepper--wait">
          <SkeletonRows rows={2} cols={1} label={t('orderDetail.loadingTheJourney')} />
        </div>
      ) : journey.isError || journey.data === undefined ? (
        <div className="cod-stepper">
          <ErrorState message={verdict(journey.error, t)} retry={() => void journey.refetch()} />
        </div>
      ) : (
        <OrderStepper milestones={journey.data.milestones} />
      )}

      <div className="cod-grid">
        <div className="cod-main">
          <RecipientCard
            order={order}
            orderId={orderId}
            check={checkResult}
            editing={editing}
            onEdit={onEdit}
            onCloseEdit={onCloseEdit}
          />

          <ItemsCard orderId={orderId} order={order} />

          {order.sellerNotes && (
            <DetailCard
              id="notes"
              icon={<StickyNote size={18} />}
              title={t('orderDetail.yourNotes')}
              titleText={t('orderDetail.yourNotes')}
              note={t('orderDetail.whatYouToldUs')}
            >
              <p className="ord-body">{order.sellerNotes}</p>
            </DetailCard>
          )}

          <CsvExtrasSection extras={order.csvExtras} />

          {/* RS-6 phase 3c — a reseller store's order: your transfer
              price, your fee shares, and when.

              ── THE `role !== 'VIEWER'` CHECK IS GONE ─────────────
              It read the LEGACY `SellerUserRole` enum, which is null
              for anybody holding only roles the company invented, so
              `null !== 'VIEWER'` is true and it had stopped closing
              anything for exactly those people. Worse, it was a
              client-side mirror of a policy the server does not
              have: `SellerResellerOrderMoneyController` is gated on
              `orders.view`, which the `viewer` role holds, so this
              was the ONLY thing standing between a viewer and the
              figures — and the UI is not a boundary (FE-2, RBAC-1).
              That was fixed where it belonged: the controller now
              requires `stores.order_money.view` (Admin, Finance, and
              the owner implicitly). This gate tracks that key so the
              panel is not offered to somebody the server will refuse
              — cosmetic, which FE-2 permits; what it forbids is the
              UI being the only check, which is what it used to be. */}
          <ResellerMoneyPanel
            orderId={orderId}
            enabled={
              order.storeKind === 'RESELLER' &&
              identity !== null &&
              can(identity, 'stores.order_money.view')
            }
          />

          <DeliveryTroublePanel
            orderId={orderId}
            orderNumber={order.orderNumber}
            orderStatus={order.status}
            open={askOpen}
            onOpenChange={onAskOpenChange}
          />

          {journey.isPending ? (
            <DetailCard
              id="activity"
              icon={<Activity size={18} />}
              title={t('orderPage.card.activity')}
              titleText={t('orderPage.card.activity')}
              note={t('orderPage.card.activityNote')}
            >
              <SkeletonRows rows={4} cols={1} label={t('orderDetail.loadingTheJourney')} />
            </DetailCard>
          ) : journey.data !== undefined ? (
            <DetailCard
              id="activity"
              icon={<Activity size={18} />}
              title={t('orderPage.card.activity')}
              titleText={t('orderPage.card.activity')}
              note={t('orderPage.card.activityNote')}
            >
              <OrderActivity entries={journey.data.timeline} milestones={journey.data.milestones} />
            </DetailCard>
          ) : null}
        </div>

        <div className="cod-side">
          {parcel !== null && (
            <DetailCard
              id="parcel"
              icon={<Truck size={18} />}
              title={t('orderDetail.parcel')}
              titleText={t('orderDetail.parcel')}
              note={t('orderDetail.whatTheCourierSays')}
              actions={
                <Link href="/tracking" className="cod-link cod-link--tap">
                  {t('orderPage.parcel.allParcels')} →
                </Link>
              }
            >
              {/* The customer-safe page (TRK-8), so a seller can hand it to
                  the person waiting for the parcel without exposing
                  anything else. */}
              <ParcelFacts parcel={parcel} trackingUrlBase={TRACK_URL} />
            </DetailCard>
          )}

          <PaymentCard order={order} />

          <OrderTicketsPanel
            orderId={orderId}
            raising={raiseOpen}
            onRaisingChange={onRaiseOpenChange}
          />

          <DetailCard
            id="invoice"
            icon={<Receipt size={18} />}
            title={t('orderDetail.invoice')}
            titleText={t('orderDetail.invoice')}
            note={t('orderDetail.theTaxDocumentFor')}
          >
            <OrderInvoiceSection
              orderId={orderId}
              orderNumber={order.orderNumber}
              status={order.status}
            />
          </DetailCard>
        </div>
      </div>
    </>
  );
}

function RecipientCard({
  order,
  orderId,
  check,
  editing,
  onEdit,
  onCloseEdit,
}: {
  readonly order: OrderView;
  readonly orderId: string;
  readonly check: Parameters<typeof AddressCheckView>[0]['result'] | null;
  readonly editing: boolean;
  readonly onEdit: () => void;
  readonly onCloseEdit: () => void;
}): ReactElement {
  const t = useT();
  const identity = useSellerIdentity();
  const attention = addressNeedsFix(check);
  const cityState = [order.recipientCity, order.recipientStateProvince].filter(Boolean).join(', ');
  return (
    <DetailCard
      id="recipient"
      icon={attention ? <AlertTriangle size={18} /> : <MapPin size={18} />}
      title={t('orderPage.card.recipient')}
      titleText={t('orderPage.card.recipient')}
      note={t('orderPage.card.recipientNote')}
      tone={attention ? 'warn' : undefined}
      forceOpen={editing}
      actions={
        <>
          {attention && (
            <span className="cod-attn">
              <AlertTriangle size={16} aria-hidden />
              {t('orderPage.card.addressAttention')}
            </span>
          )}
          {
            // `orders.create` is what the SERVER requires to save a
            // consignee change ("whoever may commit the company to a
            // delivery is who may change where it goes"). Gating on
            // anything else shows an Edit whose save comes back 403 —
            // cosmetic RBAC that disagrees with the boundary is worse
            // than none.
            identity !== null && can(identity, 'orders.create') ? (
              <Button variant="ghost" size="sm" icon={<Pencil size={16} />} onClick={onEdit}>
                {t('orderDetail.edit')}
              </Button>
            ) : null
          }
        </>
      }
    >
      {editing && (
        <div id="customer-details" className="cod-edit">
          <ConsigneePanel
            orderId={orderId}
            orderNumber={order.orderNumber}
            onClose={onCloseEdit}
            inPlace
          />
        </div>
      )}
      <div className="cod-rec" data-check={check !== null ? '1' : '0'}>
        <div className="cod-rec__facts">
          {order.storeKind === 'RESELLER' && (
            // The order is yours and so are its details; the note says who
            // sold to this person, because they are who the customer will
            // ring first.
            <p className="ord-p">
              {richMessage(t('orderDetail.soldByYourMember'), {
                span:
                  order.storeId !== null ? (
                    <Link href={`/reseller-stores/${order.storeId}`} className="cod-link">
                      {order.storeNameSnapshot ?? t('orderDetail.aMemberStore')}
                    </Link>
                  ) : (
                    <span className="ord-strong">
                      {order.storeNameSnapshot ?? t('orderDetail.aMemberStore')}
                    </span>
                  ),
              })}
            </p>
          )}
          <dl className="cod-dl">
            <div className="cod-dl__row">
              <dt>{t('orderDetail.name')}</dt>
              <dd className="cod-wrap">{order.recipientName}</dd>
            </div>
            <div className="cod-dl__row">
              <dt>{t('orderDetail.phone')}</dt>
              <dd>
                <span className="cod-phone">
                  <a href={`tel:${order.recipientPhoneE164}`} className="cod-link sk-figure">
                    {order.recipientPhoneE164}
                  </a>
                  <CopyButton value={order.recipientPhoneE164} />
                </span>
              </dd>
            </div>
            {order.recipientAltPhoneE164 && (
              <div className="cod-dl__row">
                <dt>{t('orderPage.rec.altPhone')}</dt>
                <dd>
                  <span className="cod-phone">
                    <a href={`tel:${order.recipientAltPhoneE164}`} className="cod-link sk-figure">
                      {order.recipientAltPhoneE164}
                    </a>
                    <CopyButton value={order.recipientAltPhoneE164} />
                  </span>
                </dd>
              </div>
            )}
            {order.recipientEmail && (
              <div className="cod-dl__row">
                <dt>{t('orderDetail.email')}</dt>
                <dd className="cod-wrap">{order.recipientEmail}</dd>
              </div>
            )}
            <div className="cod-dl__row">
              <dt>{t('orderDetail.address')}</dt>
              <dd className="cod-wrap">
                <div>{order.recipientAddressLine1}</div>
                {order.recipientAddressLine2 && <div>{order.recipientAddressLine2}</div>}
              </dd>
            </div>
            {order.recipientLandmark && (
              <div className="cod-dl__row">
                <dt>{t('orderPage.rec.landmark')}</dt>
                <dd className="cod-wrap">{order.recipientLandmark}</dd>
              </div>
            )}
            <div className="cod-dl__row">
              <dt>{t('orderPage.rec.cityState')}</dt>
              <dd className="cod-wrap">{cityState}</dd>
            </div>
            <div className="cod-dl__row">
              <dt>{t('orderPage.rec.pin')}</dt>
              <dd className="sk-figure">{order.recipientPostalCode}</dd>
            </div>
            <div className="cod-dl__row">
              <dt>{t('orderPage.rec.country')}</dt>
              <dd>{order.recipientCountryCode}</dd>
            </div>
          </dl>
        </div>

        {/* The verdict on that address, beside it — the two are read
            together or not at all. The whole block is absent on an order
            that was never checked (or whose read failed): this is advice
            about a delivery, and an error box about advice is worse than
            no advice. */}
        {check !== null && (
          <div className="cod-rec__check">
            <AddressCheckView result={check} />
          </div>
        )}
      </div>
    </DetailCard>
  );
}

function PaymentCard({ order }: { readonly order: OrderView }): ReactElement {
  const t = useT();
  return (
    <DetailCard
      id="payment"
      icon={<CreditCard size={18} />}
      title={t('orderPage.card.payment')}
      titleText={t('orderPage.card.payment')}
      note={t('orderDetail.whatItIsWorth')}
    >
      <Facts
        items={[
          {
            label: t('orderDetail.paymentMode'),
            value:
              order.paymentMode === 'COD'
                ? t('orderDetail.cashOnDelivery')
                : t('orderDetail.prepaid'),
          },
          {
            // The one figure here that decides whether the parcel is
            // worth chasing, through `Money` so it groups the Indian way
            // and sits on tabular figures.
            label: t('orderDetail.toCollect'),
            value:
              order.codAmountInr === null ? (
                <span className="cod-faint">{t('orderDetail.prepaid')}</span>
              ) : (
                <span className="cod-amount">
                  <Money amount={order.codAmountInr} size="md" />
                </span>
              ),
          },
          {
            label: t('orderPage.pay.declared'),
            value:
              order.declaredValueInr === null ? (
                <Dash />
              ) : (
                <Money amount={order.declaredValueInr} />
              ),
          },
          {
            label: t('orderDetail.weight'),
            value:
              order.totalWeightGrams === null ? (
                <Dash />
              ) : (
                <span className="sk-figure">{order.totalWeightGrams} g</span>
              ),
          },
          {
            label: t('orderDetail.package'),
            value: order.packageType ? (
              packageWords(order.packageType, t)
            ) : (
              <span className="cod-faint">{t('orderPage.pay.notSet')}</span>
            ),
          },
          {
            label: t('orderPage.pay.special'),
            value: order.isUrgent ? (
              <StatusChip kind="pending" label={t('orderDetail.urgent')} size="sm" />
            ) : (
              <span className="cod-faint">{t('orderPage.pay.none')}</span>
            ),
          },
        ]}
      />
    </DetailCard>
  );
}

function ItemsCard({
  orderId,
  order,
}: {
  readonly orderId: string;
  readonly order: OrderView;
}): ReactElement {
  const t = useT();
  const identity = useSellerIdentity();
  const count = order.items.length;
  return (
    <DetailCard
      id="items"
      icon={<Package size={18} />}
      title={t('orderPage.card.items')}
      titleText={t('orderPage.card.items')}
      note={t('orderPage.card.itemsNote')}
    >
      <h3 className="cod-group">
        {t('orderDetail.items')} ·{' '}
        {t(count === 1 ? 'orderPage.lineOne' : 'orderPage.lineMany', { count })}
      </h3>
      <div className="cod-items">
        <Table caption={t('orderDetail.itemsOnThisOrder')}>
          <THead>
            <Tr>
              <Th className="ord-thumb-cell" aria-label={t('orderDetail.picture')} />
              <Th>{t('orderDetail.sku')}</Th>
              <Th>{t('orderDetail.product')}</Th>
              <Th align="right">{t('orderPage.col.price')}</Th>
              <Th align="right">{t('orderDetail.qty')}</Th>
              <Th align="right">{t('orderDetail.unitWeight')}</Th>
            </Tr>
          </THead>
          <TBody>
            {order.items.length === 0 && (
              // A header row over nothing says less than a sentence does.
              <TableEmpty colSpan={6}>{t('orderDetail.noItemsRecordedOn')}</TableEmpty>
            )}
            {order.items.map((item) => (
              <Tr key={item.id}>
                <Td className="ord-thumb-cell">
                  {/* Live presigned thumbnail, NOT the snapshot's stored
                      url — that one has resolved for nobody since the
                      bucket went private. */}
                  <ProductThumb src={item.imageUrl} size={40} />
                </Td>
                <Td>
                  <span className="sk-ident cod-wrap">{item.skuCode}</span>
                </Td>
                <Td>
                  <span className="cod-wrap">
                    {item.productName}
                    {item.variantLabel && <span className="cod-faint"> · {item.variantLabel}</span>}
                  </span>
                </Td>
                <Td align="right">
                  <ItemPrice
                    price={item.unitPriceInr}
                    declared={item.unitDeclaredValueInr}
                    quantity={item.quantity}
                  />
                </Td>
                <Td align="right">
                  <span className="sk-figure">{item.quantity}</span>
                </Td>
                <Td align="right">
                  <span className="sk-figure cod-muted">
                    {item.unitWeightGrams === null ? <Dash /> : `${item.unitWeightGrams} g`}
                  </span>
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </div>

      {/* Hidden rather than shown-and-refused for a VIEWER: the server
          rejects /charges for that role, and rendering its 403 in a red box
          reads as a broken page rather than as policy. Cosmetic — the server
          is still the boundary. */}
      {identity !== null && can(identity, 'charges.view') && (
        <div className="cod-charges-wrap">
          <h3 className="cod-group">{t('orderDetail.charges')}</h3>
          <p className="cod-card__note">{t('orderDetail.whatThisParcelCosts')}</p>
          <OrderChargesSection orderId={orderId} />
        </div>
      )}
    </DetailCard>
  );
}

function OrderInvoiceSection({
  orderId,
  orderNumber,
  status,
}: {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly status: string;
}): ReactElement {
  const locale = useLocale();
  const t = useT();
  const invoice = useOrderInvoice(orderId);
  const generate = useGenerateInvoice(orderId);
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  // RS-10 / decision 8: an order sold by a reseller store gets no tax
  // invoice. The SERVER refuses it by name; we show its verdict verbatim
  // and offer nothing to press (FE-2 — the hide is cosmetic). Checked
  // first, whatever the status: "auto-generated on delivery" would be a
  // promise that never comes true for this order.
  if (invoice.data !== undefined && invoice.data !== null && 'refused' in invoice.data) {
    return (
      <p className="ord-p" data-testid="invoice-refused">
        {invoice.data.refused}
      </p>
    );
  }

  if (status !== 'DELIVERED') {
    return <p className="ord-p">{t('orderDetail.invoicesAreAutoGenerated')}</p>;
  }

  async function onGenerate(): Promise<void> {
    setError(null);
    try {
      const res = await generate.mutateAsync();
      toast.success(
        res.alreadyExisted ? t('orderDetail.invoiceLoaded') : t('orderDetail.invoiceGenerated'),
      );
    } catch (e) {
      setError(verdict(e, t, t('orderDetail.generationFailed')));
    }
  }

  if (invoice.isLoading) {
    return <SkeletonRows rows={1} cols={2} label={t('orderDetail.loadingInvoice')} />;
  }

  if (!invoice.data) {
    return (
      <div className="ord-stack ord-stack--tight">
        <p className="ord-p">{t('orderDetail.noInvoiceYetUsually')}</p>
        <div>
          <AsyncButton
            variant="secondary"
            size="md"
            icon={<FileText size={16} />}
            state={generate.isPending ? 'busy' : undefined}
            labels={{ idle: t('orderDetail.generateNow'), busy: t('orderDetail.generating') }}
            onClick={() => setConfirming(true)}
          />
        </div>
        {error && <p className="ord-error">{error}</p>}
        <ConfirmDialog
          open={confirming}
          onOpenChange={setConfirming}
          title={t('orderDetail.generateTheInvoiceNow')}
          entity={orderNumber}
          entityIsIdentifier
          consequence={t('orderDetail.weIssueTheTaxInvoice')}
          confirmLabel={t('orderDetail.generateInvoice')}
          onConfirm={() => onGenerate()}
        />
      </div>
    );
  }

  return (
    <div className="cod-invoice">
      <div>
        <div className="sk-ident ord-strong cod-wrap">{invoice.data.invoiceNumber}</div>
        <span className="ord-sub">
          {richMessage(t('orderDetail.issuedTotal'), {
            invoiceDate: fmtWhen(invoice.data.invoiceDate, locale, {
              today: t('orderPage.today'),
              yesterday: t('orderPage.yesterday'),
            }),
            totalInr: invoice.data.totalInr,
          })}
        </span>
      </div>
      {invoice.data.pdfUrl !== null && (
        // A PLAIN, PERMANENT href. The endpoint signs at the moment
        // it is followed, so there is no expiring URL in the page —
        // this survives a bookmark, a refresh and a slow reader,
        // and needs no popup-blocker dance.
        <a
          href={`/api/seller/orders/${orderId}/invoice/pdf`}
          target="_blank"
          rel="noopener noreferrer"
          className="cod-link cod-link--tap"
        >
          <Download size={16} aria-hidden />
          {t('orderDetail.downloadPdf')}
        </a>
      )}
    </div>
  );
}

/**
 * The item's price (owner, 2026-11-13: "show the product price too"): the
 * unit price the order was placed with, and the line total when there is
 * more than one. An older order placed without a price shows its declared
 * value, labelled as such, rather than a blank.
 */
function ItemPrice({
  price,
  declared,
  quantity,
}: {
  readonly price: string | null;
  readonly declared: string | null;
  readonly quantity: number;
}): ReactElement {
  const t = useT();
  const unit = price ?? declared;
  if (unit === null) return <Dash />;
  const total = (Number(unit) * quantity).toFixed(2);
  return (
    <span className="cod-price">
      <Money amount={unit} />
      {price === null ? <span className="cod-faint">{t('orderPage.price.declared')}</span> : null}
      {quantity > 1 ? (
        <span className="cod-faint">
          {richMessage(t('orderPage.price.lineTotal'), {
            amount: <Money amount={total} />,
            count: String(quantity),
          })}
        </span>
      ) : null}
    </span>
  );
}
