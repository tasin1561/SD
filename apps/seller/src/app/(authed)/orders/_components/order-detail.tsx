'use client';

import Link from 'next/link';

import {
  ArrowLeft,
  CircleDot,
  Clock,
  CreditCard,
  Package,
  Pencil,
  PhoneCall,
  Undo2,
  XCircle,
} from 'lucide-react';
import { useState, type ReactElement } from 'react';
import { useDeliveryActions } from '@/lib/ops-hooks';
import type { OrderStatus } from '@skydrop/db';
import {
  useGenerateInvoice,
  useOrderDetail,
  useOrderReattemptRequests,
  useOrderInvoice,
  useOrderJourney,
} from '@/lib/api-hooks';
import {
  BandBody,
  Button,
  Card,
  CardBody,
  Crumbs,
  DescriptionList,
  ErrorState,
  LoadingState,
  MetaChip,
  OrderStatusBadge,
  Money,
  PageHeader,
  SectionBand,
  Stat,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
  useToast,
  ProductThumb,
  OrderJourneyPanels,
  SkeletonRows,
  ErrorNote,
} from '@skydrop/ui/components';
import { orderStatusKind, statusLabel } from '@skydrop/ui/status';
import { DeliveryTroublePanel } from '../[id]/_components/delivery-trouble-panel';
import { CancelOrderDialog } from './cancel-order-dialog';
import { RequestReturnDialog } from './request-return-dialog';
import { ReattemptRequestDialog } from './reattempt-request-dialog';
import { OrderChargesSection } from './order-charges';
import { serverVerdict } from '@/lib/server-verdict';
import { can } from '@/lib/page-access';
import { useSellerIdentity } from '@skydrop/auth/client';
import { OrderTicketsPanel } from '../[id]/_components/order-tickets-panel';
import { ConsigneePanel } from '../[id]/_components/consignee-panel';
import { ResellerMoneyPanel } from '../[id]/_components/reseller-money-panel';

/** The public tracking site. Env-driven so a domain change is a deploy
 *  variable rather than a code edit. */
const TRACK_URL = process.env.NEXT_PUBLIC_TRACK_URL ?? 'https://track.skydrop.online';

/**
 * Seller order detail. Two fetches: the order body (with items) and
 * the seller-visible lifecycle timeline (server filters to
 * `isVisibleToSeller=true` events). Read-only view; no admin actions
 * — sellers don't have cancel/god-mode buttons here. CSV-import flow
 * and manual order create are separate fast-follows.
 *
 * Renders:
 *   - Header (order number + status badge)
 *   - Recipient (immutable ORD-6 snapshot — same shape as admin's)
 *   - Payment + physical
 *   - Items table
 *   - Seller notes (sellerNotes only — internalNotes / callNotes are
 *     admin-only)
 *   - Lifecycle timeline (CP2.A.4 — closes the M12 deferral #1 for
 *     the seller half)
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

/**
 * How the STATUS tile should read.
 *
 * Derived from the shared `orderStatusKind` (FE-6) rather than a second
 * list of statuses kept here — a local copy is exactly the drift that
 * mapper exists to prevent, and this file has already been wrong about
 * a status vocabulary once (`CANCELLABLE` is cosmetic and says so).
 * Mapping the eight kinds onto the four tile tones is the only decision
 * being made, and it is exhaustive.
 */
function statusTone(status: OrderStatus): 'neutral' | 'warn' | 'bad' | 'good' {
  switch (orderStatusKind(status)) {
    case 'delivered':
      return 'good';
    case 'failed':
    case 'rto':
      return 'bad';
    case 'pending':
      return 'warn';
    case 'draft':
    case 'confirmed':
    case 'in-transit':
    case 'cancelled':
      return 'neutral';
  }
}

function Dash(): ReactElement {
  return <span className="text-text-faint">—</span>;
}

/** `21 Aug 2026` — a tile is a glance, not a timestamp. */
function tileDate(value: string): string {
  return new Date(value).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function OrderDetailView({ orderId }: { orderId: string }): ReactElement {
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
  // copy was the one that got read first.
  const [editingCustomer, setEditingCustomer] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [raiseOpen, setRaiseOpen] = useState(false);
  const deliveryActions = useDeliveryActions(orderId);
  const canAsk = deliveryActions.data?.canRequest === true;

  /*
    The band numbers, allocated in render order.

    Two of the bands are conditional — the notes only exist when the
    seller wrote some, the charges only when they may see them — so
    fixed numbers left a jump from 03 to 05 on the commonest order,
    which reads as a section that failed to load rather than one this
    parcel does not have. JSX children evaluate top to bottom, so
    calling this inline gives 01, 02, 03… down whatever actually
    renders.
  */
  let bandsAllocated = 0;
  const band = (): string => String(++bandsAllocated).padStart(2, '0');

  return (
    <div>
      {/* The BACK link stays beside the breadcrumb rather than being
          replaced by it. They answer different questions — "where am
          I" and "take me back one" — and a crumb trail is a poor
          back button on a phone, where the tap target is a word in a
          line of words. */}
      <Link
        href="/orders"
        className="text-text-muted hover:text-text-body mb-3 inline-flex items-center gap-1.5 text-xs transition-colors"
      >
        <ArrowLeft size={12} aria-hidden /> Orders
      </Link>

      {detail.isLoading ? (
        <LoadingState label="Loading order…" />
      ) : detail.isError ? (
        <ErrorState
          message={detail.error?.message ?? 'Failed to load order.'}
          retry={() => void detail.refetch()}
        />
      ) : !detail.data ? (
        <ErrorState message="Order not found." />
      ) : (
        <>
          <PageHeader
            breadcrumb={
              <Crumbs
                items={[
                  { label: 'Seller console' },
                  { label: 'Orders', href: '/orders' },
                  { label: detail.data.orderNumber },
                ]}
                Link={Link}
              />
            }
            title={<span className="font-mono">{detail.data.orderNumber}</span>}
            subtitle={
              detail.data.sellerOrderRef ? (
                <span>
                  Your ref: <span className="font-mono">{detail.data.sellerOrderRef}</span>
                </span>
              ) : undefined
            }
            /*
              Standing facts about THIS parcel, under its number.

              The comps carry a row of chips here — waybill, service
              level, HS code, SAFTA duty, bonded status. Only the first
              two exist: an AWB is real and the payment mode is real.
              There is no service level on a shipment, HS codes were
              removed from the catalogue in 2026-08-18, and nothing
              records a duty rate per parcel. A chip that reads
              "SAFTA 0%" on a screen is taken as a customs fact.
            */
            meta={
              <>
                <MetaChip tone="accent">
                  {detail.data.paymentMode === 'COD' ? 'Cash on delivery' : 'Prepaid'}
                </MetaChip>
                {detail.data.storeKind === 'RESELLER' && (
                  <MetaChip>Sold by {detail.data.storeNameSnapshot ?? 'a reseller store'}</MetaChip>
                )}
              </>
            }
            action={
              <div className="flex items-center gap-2">
                {/* The two things a seller can DO about a live parcel,
                    beside the order number. They used to live on cards
                    further down — one of which has since moved below
                    the invoice — so the actions were somewhere you
                    arrived at rather than somewhere you look. */}
                {canAsk && (
                  <Button variant="primary" size="sm" onClick={() => setAskOpen(true)}>
                    Ask admin to act
                  </Button>
                )}
                <Button variant="secondary" size="sm" onClick={() => setRaiseOpen(true)}>
                  Raise an issue
                </Button>
                {/* A Reseller store's order is EDITABLE HERE TOO (owner,
                    2026-09-18). You own the goods, the warehouse slot,
                    the courier and the money at risk, so the whole order
                    is yours to change — its products, quantities, prices
                    and the customer's details. The store is emailed what
                    moved, and its money is recalculated to the new order
                    under the terms it was placed on. */}
                {(detail.data.status === 'DRAFT' ||
                  detail.data.status === 'PENDING_CONFIRMATION') && (
                  <Link href={`/orders/${orderId}/edit`}>
                    <Button variant="secondary" size="sm">
                      <Pencil size={12} /> Edit
                    </Button>
                  </Link>
                )}
                {/* The customer declined, so nothing calls this order
                    again on its own. Asking is the only path — and it is
                    an ASK: an admin decides. */}
                {/* `canRequest` is the SERVER's answer — which statuses
                    qualify is a per-seller setting, and it already
                    accounts for the one-open-request rule. Guessing here
                    would show a button the server refuses. */}
                {canRequest && identity !== null && can(identity, 'orders.create') && (
                  <Button variant="secondary" size="sm" onClick={() => setReattemptOpen(true)}>
                    <PhoneCall size={12} />{' '}
                    {lastDecided === null ? 'Ask us to call again' : 'Ask again'}
                  </Button>
                )}
                {/* Only a DELIVERED order can come back — before that a
                    parcel that cannot be delivered returns as an RTO on
                    its own, and offering a button for it would suggest
                    the seller has a choice they do not have. */}
                {detail.data.status === 'DELIVERED' &&
                  identity !== null &&
                  can(identity, 'orders.cancel') && (
                    <Button variant="secondary" size="sm" onClick={() => setReturnOpen(true)}>
                      <Undo2 size={12} /> Request return
                    </Button>
                  )}
                {CANCELLABLE.has(detail.data.status) &&
                  identity !== null &&
                  can(identity, 'orders.cancel') && (
                    <Button variant="ghost" size="sm" onClick={() => setCancelOpen(true)}>
                      <XCircle size={12} /> Cancel
                    </Button>
                  )}
                <OrderStatusBadge status={detail.data.status as OrderStatus} />
              </div>
            }
          />

          {/* ── The four standing facts about this parcel ────────────
                 Every one is a COLUMN on the order, not a derivation —
                 a tile that needed arithmetic to exist would be a
                 claim rather than a record. The exceptions are the two
                 sums in the items tile's footer, which add up lines
                 that are all on the page directly below it.

                 What the comps put here and we do not have: a service
                 level, an SLA clock and a "customs cleared" seal.
                 There is no service level on a shipment, nothing
                 measures a per-parcel SLA, and no customs state is
                 recorded — a cleared/held badge is precisely the sort
                 of thing a seller would ring us about. */}
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat
              label="Status"
              icon={<CircleDot size={13} aria-hidden />}
              /* `statusLabel` from `@skydrop/ui/status`, never the raw
                 enum: the badge in the header beside this tile reads
                 the same vocabulary, and two words for one status on
                 one screen reads as two things having happened. */
              value={
                <span className="text-base">{statusLabel(detail.data.status as OrderStatus)}</span>
              }
              tone={statusTone(detail.data.status as OrderStatus)}
            />
            <Stat
              label={detail.data.paymentMode === 'COD' ? 'To collect' : 'Paid up front'}
              icon={<CreditCard size={13} aria-hidden />}
              /* A PREPAID order reads "Prepaid", never ₹0 — nothing
                 being owed and nothing having been recorded look the
                 same at a glance otherwise. */
              value={
                detail.data.codAmountInr === null ? (
                  <span className="text-text-faint text-base">Prepaid</span>
                ) : (
                  <Money amount={detail.data.codAmountInr} />
                )
              }
              tone="neutral"
              {...(detail.data.declaredValueInr === null
                ? {}
                : {
                    foot: [
                      {
                        label: 'Declared value',
                        value: <Money amount={detail.data.declaredValueInr} />,
                      },
                    ],
                  })}
            />
            <Stat
              label="What is in it"
              icon={<Package size={13} aria-hidden />}
              value={detail.data.items.length}
              unit={detail.data.items.length === 1 ? 'line' : 'lines'}
              tone="neutral"
              foot={[
                {
                  label: 'Units',
                  value: detail.data.items.reduce((t, i) => t + i.quantity, 0),
                },
                {
                  label: 'Weight',
                  value:
                    detail.data.totalWeightGrams === null ? (
                      <span className="text-text-faint">Not recorded</span>
                    ) : (
                      `${detail.data.totalWeightGrams} g`
                    ),
                },
              ]}
            />
            <Stat
              label="Placed"
              icon={<Clock size={13} aria-hidden />}
              value={<span className="text-base">{tileDate(detail.data.placedAt)}</span>}
              tone="neutral"
              hint={`Last moved ${tileDate(detail.data.updatedAt)}.`}
            />
          </div>

          {/*
            ── THE 2026-09-05 REDESIGN ────────────────────────────────
            Built from two reference comps, one light and one dark. The
            page was one long column: a seller checking a parcel that
            had gone wrong scrolled past the recipient, the items and
            the money to reach the timeline that told them what
            happened.

            It is two columns now. The JOURNEY is the wide left one —
            it is what the page is for — and the FACTS stack down the
            right, where they can be checked without leaving the
            timeline. Anything WRONG stays full-width above both,
            because a delivery in trouble is not a sidebar.

            What the comps showed that is not here, for the same reason
            as the orders list: a drawing can show a field we do not
            have. No "Origin hub" or "Destination sector" (we have a
            warehouse and a PIN, not hubs and sectors), no "Channel:
            Shopify Direct" (an order has a SOURCE — manual, CSV, API —
            which is not a sales channel), no "B2C Consignment" chip.
          */}
          {pendingRequest !== null && (
            // The ORDER is still REJECTED_BY_CUSTOMER and the badge above
            // says so, because that is what it is until somebody
            // approves. This says what is ALSO true: a request is with
            // us. Two facts, not one overwritten by the other.
            <Card>
              <CardBody>
                <div className="flex items-start gap-3">
                  <Clock size={16} className="text-pending mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-text-bright text-sm font-medium">
                      We are reviewing your request to call this customer again
                    </p>
                    <p className="text-text-muted mt-0.5 text-sm">
                      Sent {new Date(pendingRequest.createdAt).toLocaleString('en-IN')}. The order
                      stays rejected until we decide. If we approve it, it goes back into the call
                      queue and you will see the status change here.
                    </p>
                    <p className="text-text-faint mt-1.5 text-sm italic">
                      “{pendingRequest.reason}”
                    </p>
                  </div>
                </div>
              </CardBody>
            </Card>
          )}

          {pendingRequest === null && lastDecided !== null && lastDecided.status === 'REJECTED' && (
            <Card>
              <CardBody>
                <div className="flex items-start gap-3">
                  <XCircle size={16} className="text-failed mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-text-bright text-sm font-medium">
                      We reviewed your request and did not call again
                    </p>
                    {lastDecided.decisionNote !== null && lastDecided.decisionNote !== '' && (
                      <p className="text-text-muted mt-0.5 text-sm">{lastDecided.decisionNote}</p>
                    )}
                    <p className="text-text-faint mt-0.5 text-sm">
                      You can ask again if something changes.
                    </p>
                  </div>
                </div>
              </CardBody>
            </Card>
          )}

          {/* Correcting the consignee sits with the parcel, not in a
              settings screen: it is only ever done while looking at a
              specific delivery that is about to go wrong — and now only
              when somebody has actually asked to change something, via
              Edit on the Recipient card. */}
          {editingCustomer && (
            <div id="customer-details">
              <ConsigneePanel orderId={orderId} onClose={() => setEditingCustomer(false)} />
            </div>
          )}

          {/*
            `mt-6` because the panels above space themselves from what
            precedes them (each carries its own `mt-4`) and this grid
            carried nothing — so the facts butted straight up against
            the consignee panel with no gap at all. Six rather than four:
            this is the seam between "something needs you" and "here is
            the order", and it should read as a bigger break than the
            one between two notices.
          */}
          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
            {/* The journey: the stage ladder, the parcels, and the
                courier's own scans merged with our handling. */}
            <div className="min-w-0 space-y-4">
              <OrderJourneySection orderId={orderId} />
            </div>

            {/* The facts, in the order a seller checks them: who it is
                going to, what is in it, what it costs, the paperwork. */}
            <div className="min-w-0 space-y-4">
              {/* ── The facts, each under its own numbered band ──────
                     The bands are numbered down the FACTS column only.
                     The journey beside them brings its own panels and
                     their own heads (it is shared with apps/admin), so
                     capping it with a band would have drawn a second
                     border a hair outside the first — the same mistake
                     the profile conversion had to undo. */}
              <div>
                <SectionBand
                  index={band()}
                  title="Recipient"
                  note="Snapshotted when the order was placed."
                  action={
                    // `orders.create` is what the SERVER requires to save
                    // a consignee change ("whoever may commit the company
                    // to a delivery is who may change where it goes").
                    // Gating on anything else shows an Edit whose save
                    // comes back 403 — cosmetic RBAC that disagrees with
                    // the boundary is worse than none.
                    // A Reseller store's order uses the SAME editor
                    // (2026-09-18, owner): Seller staff may change anything
                    // on it, and the store is told what moved. A separate
                    // narrow editor for reseller orders was the old rule
                    // wearing a component.
                    identity !== null && can(identity, 'orders.create') ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEditingCustomer(true);
                          // Opened, then scrolled to. The editor is full
                          // width at the top — it needs the room — so
                          // revealing it without moving there would look
                          // like the button did nothing.
                          window.setTimeout(
                            () =>
                              document
                                .getElementById('customer-details')
                                ?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
                            50,
                          );
                        }}
                      >
                        <Pencil size={12} /> Edit
                      </Button>
                    ) : undefined
                  }
                />
                {/* No <Card> inside: `BandBody` IS the bordered surface
                  the band caps. */}
                <BandBody>
                  {detail.data.storeKind === 'RESELLER' && (
                    // The order is yours and so are its details; the
                    // note says who sold to this person, because they
                    // are who the customer will ring first.
                    <p className="text-text-muted mb-3 text-sm">
                      Sold by your reseller store{' '}
                      {detail.data.storeId !== null ? (
                        <Link
                          href={`/reseller-stores/${detail.data.storeId}`}
                          className="text-accent font-medium hover:underline"
                        >
                          {detail.data.storeNameSnapshot ?? 'a reseller store'}
                        </Link>
                      ) : (
                        <span className="font-medium">
                          {detail.data.storeNameSnapshot ?? 'a reseller store'}
                        </span>
                      )}
                      .
                    </p>
                  )}
                  <dl className="grid grid-cols-[minmax(84px,36%)_1fr] sm:grid-cols-[160px_1fr] gap-x-3 sm:gap-x-6 gap-y-1.5 text-sm">
                    <dt className="text-text-muted">Name</dt>
                    <dd className="text-text-body">{detail.data.recipientName}</dd>
                    <dt className="text-text-muted">Phone</dt>
                    <dd className="text-text-body font-mono text-xs">
                      {detail.data.recipientPhoneE164}
                      {detail.data.recipientAltPhoneE164 && (
                        <span className="text-text-faint ml-2">
                          / {detail.data.recipientAltPhoneE164}
                        </span>
                      )}
                    </dd>
                    {detail.data.recipientEmail && (
                      <>
                        <dt className="text-text-muted">Email</dt>
                        <dd className="text-text-body font-mono text-xs">
                          {detail.data.recipientEmail}
                        </dd>
                      </>
                    )}
                    <dt className="text-text-muted">Address</dt>
                    <dd className="text-text-body">
                      <div>{detail.data.recipientAddressLine1}</div>
                      {detail.data.recipientAddressLine2 && (
                        <div>{detail.data.recipientAddressLine2}</div>
                      )}
                      {detail.data.recipientLandmark && (
                        <div className="text-text-muted text-xs">
                          Landmark: {detail.data.recipientLandmark}
                        </div>
                      )}
                      <div className="mt-0.5">
                        {[detail.data.recipientCity, detail.data.recipientStateProvince]
                          .filter(Boolean)
                          .join(', ')}{' '}
                        <span className="font-mono">{detail.data.recipientPostalCode}</span>{' '}
                        <span className="text-text-muted">{detail.data.recipientCountryCode}</span>
                      </div>
                    </dd>
                  </dl>
                </BandBody>
              </div>

              {/* Payment and Physical were two cards side by side in a
                  column that is barely wide enough for one. Six facts
                  do not need two bordered boxes and two heads, so they
                  are one band and one list that reflows to a single
                  column on a phone. */}
              <div>
                <SectionBand
                  index={band()}
                  title="Payment &amp; parcel"
                  note="What it is worth and what it weighs."
                />
                <BandBody>
                  <DescriptionList
                    columns={2}
                    items={[
                      {
                        label: 'Payment mode',
                        value: <span className="uppercase">{detail.data.paymentMode}</span>,
                      },
                      {
                        // The one figure here that decides whether the
                        // parcel is worth chasing, through `Money` so it
                        // groups the Indian way and sits on tabular
                        // figures, and given the accent so the eye lands
                        // on it rather than on the word above it.
                        label: 'To collect',
                        value:
                          detail.data.codAmountInr === null ? (
                            <span className="text-text-faint">Prepaid</span>
                          ) : (
                            <span className="text-accent font-semibold">
                              <Money amount={detail.data.codAmountInr} />
                            </span>
                          ),
                      },
                      {
                        label: 'Declared value',
                        value:
                          detail.data.declaredValueInr === null ? (
                            <Dash />
                          ) : (
                            <Money amount={detail.data.declaredValueInr} />
                          ),
                      },
                      {
                        label: 'Weight',
                        value:
                          detail.data.totalWeightGrams === null ? (
                            <Dash />
                          ) : (
                            <span className="font-mono">{detail.data.totalWeightGrams} g</span>
                          ),
                      },
                      {
                        label: 'Package',
                        value: <span className="uppercase">{detail.data.packageType}</span>,
                      },
                      {
                        label: 'Flags',
                        value: detail.data.isUrgent ? (
                          <span className="text-pending text-xs tracking-wide uppercase">
                            Urgent
                          </span>
                        ) : (
                          <Dash />
                        ),
                      },
                    ]}
                  />
                </BandBody>
              </div>

              <div>
                <SectionBand
                  index={band()}
                  title="Items"
                  note={`${detail.data.items.length} ${detail.data.items.length === 1 ? 'line' : 'lines'}`}
                />
                {/* The `Table` primitive, not a hand-rolled `<thead>`.
                  It was the latter, which meant this table alone did
                  NOT inherit the below-`md` card layout every other
                  table on the estate gets (FE-7) — five columns on a
                  360px phone pushed the page sideways. */}
                <BandBody flush>
                  <Table>
                    <THead>
                      <Tr>
                        <Th className="w-14" aria-label="Picture" />
                        <Th>SKU</Th>
                        <Th>Product</Th>
                        <Th align="right">Qty</Th>
                        <Th align="right">Unit weight</Th>
                      </Tr>
                    </THead>
                    <TBody>
                      {detail.data.items.length === 0 && (
                        // A header row over nothing says less than a
                        // sentence does.
                        <Tr>
                          <Td colSpan={5} className="text-text-muted py-4 text-center">
                            No items recorded on this order.
                          </Td>
                        </Tr>
                      )}
                      {detail.data.items.map((item) => (
                        <Tr key={item.id}>
                          <Td>
                            {/* Live presigned thumbnail, NOT the snapshot's
                              stored url — that one has resolved for
                              nobody since the bucket went private. */}
                            <ProductThumb src={item.imageUrl} size={36} />
                          </Td>
                          <Td className="text-text-body font-mono text-xs">{item.skuCode}</Td>
                          <Td className="text-text-body">
                            {item.productName}
                            {item.variantLabel && (
                              <span className="text-text-muted ml-1">· {item.variantLabel}</span>
                            )}
                          </Td>
                          <Td align="right" className="text-text-body font-mono">
                            {item.quantity}
                          </Td>
                          <Td align="right" className="text-text-muted font-mono text-xs">
                            {item.unitWeightGrams === null ? <Dash /> : `${item.unitWeightGrams} g`}
                          </Td>
                        </Tr>
                      ))}
                    </TBody>
                  </Table>
                </BandBody>
              </div>

              {detail.data.sellerNotes && (
                <div>
                  <SectionBand
                    index={band()}
                    title="Your notes"
                    note="What you told us at order time."
                  />
                  <BandBody>
                    <p className="text-text-body text-sm whitespace-pre-wrap">
                      {detail.data.sellerNotes}
                    </p>
                  </BandBody>
                </div>
              )}

              {/* Hidden rather than shown-and-refused for a VIEWER: the
              server rejects /charges for that role, and rendering its
              403 in a red box reads as a broken page rather than as
              policy. Cosmetic — the server is still the boundary. */}
              {identity !== null && can(identity, 'charges.view') && (
                <div>
                  <SectionBand index={band()} title="Charges" note="What this parcel costs you." />
                  {/* The section brings its own card, so the band caps it
                      with `flush` rather than a second padded surface. */}
                  <BandBody flush>
                    <OrderChargesSection orderId={orderId} />
                  </BandBody>
                </div>
              )}

              {/* RS-6 phase 3c — a reseller store's order: your transfer
              price, your fee shares, and when. Hidden from a VIEWER,
              whom the endpoint refuses (cosmetic — FE-2). */}
              <ResellerMoneyPanel
                orderId={orderId}
                enabled={
                  detail.data.storeKind === 'RESELLER' &&
                  identity !== null &&
                  identity.role !== 'VIEWER' &&
                  can(identity, 'orders.view')
                }
              />

              <div>
                <SectionBand
                  index={band()}
                  title="Invoice"
                  note="The tax document for this sale."
                />
                <BandBody flush>
                  <OrderInvoiceSection orderId={orderId} status={detail.data.status} />
                </BandBody>
              </div>

              {/*
                Directly UNDER the invoice, in the facts column.

                They spent a commit full-width below the grid, which was
                technically "after the invoice" and useless: the journey
                column runs to hundreds of scan rows on a real parcel,
                so these landed a screen and a half past the thing they
                were meant to sit beneath. Position in a two-column
                layout is what the eye sees, not what the DOM order
                says. The column is wider now so they still have room
                for the detail they carry.
              */}
              <DeliveryTroublePanel
                orderId={orderId}
                orderStatus={detail.data.status}
                open={askOpen}
                onOpenChange={setAskOpen}
              />
              <OrderTicketsPanel
                orderId={orderId}
                raising={raiseOpen}
                onRaisingChange={setRaiseOpen}
              />

              {/* The whole journey — the stage ladder, what the courier
              says the parcel weighs and will collect, and our own
              handling merged with their scans into one history.
              Replaces a bare scan list next to a near-empty timeline,
              which between them never showed that Skydrop had taken
              the order, phoned the customer, picked or packed it. */}
            </div>
          </div>

          <div className="text-text-faint text-xs text-center mt-8">
            Placed {new Date(detail.data.placedAt).toISOString().replace('T', ' ').slice(0, 16)} ·
            Updated {new Date(detail.data.updatedAt).toISOString().replace('T', ' ').slice(0, 16)}
          </div>

          <ReattemptRequestDialog
            orderId={orderId}
            open={reattemptOpen}
            onOpenChange={setReattemptOpen}
          />
          <RequestReturnDialog
            orderId={orderId}
            orderNumber={detail.data.orderNumber}
            open={returnOpen}
            onClose={() => setReturnOpen(false)}
          />

          <CancelOrderDialog
            open={cancelOpen}
            orderId={orderId}
            orderNumber={detail.data.orderNumber}
            status={detail.data.status}
            onOpenChange={setCancelOpen}
          />
        </>
      )}
    </div>
  );
}

/**
 * The journey panels.
 *
 * Its own failure surface rather than one shared with the order body:
 * the journey is enrichment, and a courier read that is briefly
 * unavailable must not blank the recipient and the items a seller came
 * to check.
 */
function OrderJourneySection({ orderId }: { readonly orderId: string }): ReactElement | null {
  const journey = useOrderJourney(orderId);
  if (journey.isPending) return <SkeletonRows rows={4} />;
  if (journey.isError || journey.data === undefined) {
    return (
      <div>
        <SectionBand title="Order tracker" />
        <BandBody>
          <ErrorNote message={serverVerdict(journey.error)} retry={() => void journey.refetch()} />
        </BandBody>
      </div>
    );
  }
  return (
    <OrderJourneyPanels
      milestones={journey.data.milestones}
      parcels={journey.data.parcels}
      entries={journey.data.timeline}
      allParcelsHref="/tracking"
      // The customer-safe page (TRK-8), so a seller can hand it to the
      // person waiting for the parcel without exposing anything else.
      trackingUrlBase={TRACK_URL}
    />
  );
}

function OrderInvoiceSection({
  orderId,
  status,
}: {
  readonly orderId: string;
  readonly status: string;
}): ReactElement {
  const invoice = useOrderInvoice(orderId);
  const generate = useGenerateInvoice(orderId);
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);

  // RS-10 / decision 8: an order sold by a reseller store gets no tax
  // invoice. The SERVER refuses it by name; we show its verdict verbatim
  // and offer nothing to press (FE-2 — the hide is cosmetic). Checked
  // first, whatever the status: "auto-generated on delivery" would be a
  // promise that never comes true for this order.
  if (invoice.data !== undefined && invoice.data !== null && 'refused' in invoice.data) {
    return (
      <p className="text-text-muted p-3 text-sm" data-testid="invoice-refused">
        {invoice.data.refused}
      </p>
    );
  }

  if (status !== 'DELIVERED') {
    return (
      <p className="text-text-muted p-3 text-sm">
        Invoices are auto-generated when the order is delivered.
      </p>
    );
  }

  async function onGenerate(): Promise<void> {
    setError(null);
    try {
      const res = await generate.mutateAsync();
      toast.success(res.alreadyExisted ? 'Invoice loaded.' : 'Invoice generated.');
    } catch (e) {
      setError(serverVerdict(e, 'Generation failed'));
    }
  }

  if (invoice.isLoading) {
    return (
      <div className="p-3">
        <LoadingState label="Loading invoice…" />
      </div>
    );
  }

  if (!invoice.data) {
    return (
      <div className="p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <p className="text-text-muted text-sm">
            No invoice yet — usually generated within seconds of delivery.
          </p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={generate.isPending}
            onClick={() => void onGenerate()}
          >
            {generate.isPending ? 'Generating…' : 'Generate now'}
          </Button>
        </div>
        {error && <div className="text-critical mt-2 text-xs">{error}</div>}
      </div>
    );
  }

  return (
    <div className="p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="min-w-0">
          <div className="text-text-bright font-mono text-sm">{invoice.data.invoiceNumber}</div>
          <div className="text-text-muted mt-0.5 text-xs">
            Issued {new Date(invoice.data.invoiceDate).toLocaleString()} · Total ₹{' '}
            {invoice.data.totalInr}
          </div>
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
            className="text-accent inline-flex items-center gap-1 text-sm hover:underline"
          >
            Download PDF →
          </a>
        )}
      </div>
    </div>
  );
}
