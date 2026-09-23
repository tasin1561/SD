'use client';

import Link from 'next/link';

import {
  ArrowLeft,
  CircleDot,
  Clock,
  CreditCard,
  Download,
  FileText,
  LifeBuoy,
  Package,
  Pencil,
  PhoneCall,
  Truck,
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
import { Money, ProductThumb } from '@skydrop/ui/components';
import { orderStatusKind, statusLabel } from '@skydrop/ui/status';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { KpiCard, type KpiTone } from '@skydrop/ui/app/kpi-card';
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
import { OrderJourney } from './order-journey-parts';
import { BackLink, Facts, LinkButton, MetaFact, Notice, OrdSection } from './orders-parts';
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
  return <span className="ord-faint">—</span>;
}

/** `21 Aug 2026` — a tile is a glance, not a timestamp. */
function tileDate(value: string): string {
  return new Date(value).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** The status tile's glow, from the same four tones. */
const TILE_TONE: Record<ReturnType<typeof statusTone>, KpiTone> = {
  good: 'credit',
  bad: 'debit',
  warn: 'pending',
  neutral: 'neutral',
};

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

  return (
    <div className="ord-page">
      {/* The BACK link stays beside the breadcrumb rather than being
          replaced by it. They answer different questions — "where am
          I" and "take me back one" — and a crumb trail is a poor
          back button on a phone, where the tap target is a word in a
          line of words. */}
      <BackLink href="/orders" icon={<ArrowLeft size={14} aria-hidden />}>
        Orders
      </BackLink>

      {detail.isLoading ? (
        <SkeletonRows rows={6} cols={4} label="Loading order…" />
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
            breadcrumbs={[
              { label: 'Seller console' },
              { label: 'Orders', href: '/orders' },
              { label: detail.data.orderNumber },
            ]}
            Link={Link}
            title={<span className="sk-ident">{detail.data.orderNumber}</span>}
            subtitle={
              detail.data.sellerOrderRef ? (
                <span>
                  Your ref: <span className="sk-ident">{detail.data.sellerOrderRef}</span>
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
              <span className="ord-meta">
                <StatusChip
                  kind={orderStatusKind(detail.data.status as OrderStatus)}
                  label={statusLabel(detail.data.status as OrderStatus)}
                />
                <MetaFact tone="accent">
                  {detail.data.paymentMode === 'COD' ? 'Cash on delivery' : 'Prepaid'}
                </MetaFact>
                {detail.data.storeKind === 'RESELLER' && (
                  <MetaFact>Sold by {detail.data.storeNameSnapshot ?? 'a reseller store'}</MetaFact>
                )}
              </span>
            }
            action={
              <div className="ord-row">
                {/* The two things a seller can DO about a live parcel,
                    beside the order number, where a seller looks for
                    something to do. */}
                {canAsk && (
                  <Button
                    variant="primary"
                    size="sm"
                    icon={<Truck size={14} />}
                    onClick={() => setAskOpen(true)}
                  >
                    Ask admin to act
                  </Button>
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<LifeBuoy size={14} />}
                  onClick={() => setRaiseOpen(true)}
                >
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
                  <LinkButton
                    href={`/orders/${orderId}/edit`}
                    variant="secondary"
                    size="sm"
                    icon={<Pencil size={14} />}
                  >
                    Edit
                  </LinkButton>
                )}
                {/* The customer declined, so nothing calls this order
                    again on its own. Asking is the only path — and it is
                    an ASK: an admin decides. `canRequest` is the SERVER's
                    answer — which statuses qualify is a per-seller
                    setting, and it already accounts for the
                    one-open-request rule. */}
                {canRequest && identity !== null && can(identity, 'orders.create') && (
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<PhoneCall size={14} />}
                    onClick={() => setReattemptOpen(true)}
                  >
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
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={<Undo2 size={14} />}
                      onClick={() => setReturnOpen(true)}
                    >
                      Request return
                    </Button>
                  )}
                {CANCELLABLE.has(detail.data.status) &&
                  identity !== null &&
                  can(identity, 'orders.cancel') && (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<XCircle size={14} />}
                      onClick={() => setCancelOpen(true)}
                    >
                      Cancel
                    </Button>
                  )}
              </div>
            }
          />

          {/* ── The four standing facts about this parcel ────────────
                 Every one is a COLUMN on the order, not a derivation —
                 a tile that needed arithmetic to exist would be a
                 claim rather than a record. The exceptions are the two
                 sums in the items tile's footer, which add up lines
                 that are all on the page directly below it. */}
          <div className="ord-kpis">
            <KpiCard
              label="Status"
              icon={<CircleDot size={14} />}
              /* `statusLabel` from `@skydrop/ui/status`, never the raw
                 enum: the chip in the header beside this tile reads
                 the same vocabulary. */
              figure={<span>{statusLabel(detail.data.status as OrderStatus)}</span>}
              tone={TILE_TONE[statusTone(detail.data.status as OrderStatus)]}
            />
            <KpiCard
              label={detail.data.paymentMode === 'COD' ? 'To collect' : 'Paid up front'}
              icon={<CreditCard size={14} />}
              /* A PREPAID order reads "Prepaid", never ₹0 — nothing
                 being owed and nothing having been recorded look the
                 same at a glance otherwise. */
              figure={
                detail.data.codAmountInr === null ? (
                  <span className="ord-faint">Prepaid</span>
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
            <KpiCard
              label="What is in it"
              icon={<Package size={14} />}
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
                      <span className="ord-faint">Not recorded</span>
                    ) : (
                      `${detail.data.totalWeightGrams} g`
                    ),
                },
              ]}
            />
            <KpiCard
              label="Placed"
              icon={<Clock size={14} />}
              figure={<span>{tileDate(detail.data.placedAt)}</span>}
              tone="neutral"
              hint={`Last moved ${tileDate(detail.data.updatedAt)}.`}
            />
          </div>

          {pendingRequest !== null && (
            // The ORDER is still REJECTED_BY_CUSTOMER and the chip above
            // says so, because that is what it is until somebody
            // approves. This says what is ALSO true: a request is with
            // us. Two facts, not one overwritten by the other.
            <Notice
              tone="warn"
              icon={<Clock size={16} />}
              title="We are reviewing your request to call this customer again"
            >
              <span className="ord-p">
                Sent {new Date(pendingRequest.createdAt).toLocaleString('en-IN')}. The order stays
                rejected until we decide. If we approve it, it goes back into the call queue and you
                will see the status change here.
              </span>
              <p className="ord-quote">“{pendingRequest.reason}”</p>
            </Notice>
          )}

          {pendingRequest === null && lastDecided !== null && lastDecided.status === 'REJECTED' && (
            <Notice
              tone="bad"
              icon={<XCircle size={16} />}
              title="We reviewed your request and did not call again"
            >
              {lastDecided.decisionNote !== null && lastDecided.decisionNote !== '' && (
                <span className="ord-p">{lastDecided.decisionNote}</span>
              )}
              <span className="ord-faint">You can ask again if something changes.</span>
            </Notice>
          )}

          {/* Correcting the consignee sits with the parcel, not in a
              settings screen: it is only ever done while looking at a
              specific delivery that is about to go wrong — and now only
              when somebody has actually asked to change something, via
              Edit on the Recipient card. */}
          {editingCustomer && (
            <div id="customer-details">
              <ConsigneePanel
                orderId={orderId}
                orderNumber={detail.data.orderNumber}
                onClose={() => setEditingCustomer(false)}
              />
            </div>
          )}

          {/*
            Two columns. The JOURNEY is the wide left one — it is what the
            page is for — and the FACTS stack down the right, where they
            can be checked without leaving the timeline.
          */}
          <div className="ord-split ord-split--journey">
            {/* The journey: the stage ladder, the parcels, and the
                courier's own scans merged with our handling. */}
            <div className="ord-stack">
              <OrderJourneySection
                orderId={orderId}
                orderNumber={detail.data.orderNumber}
                status={detail.data.status as OrderStatus}
              />
            </div>

            {/* The facts, in the order a seller checks them: who it is
                going to, what is in it, what it costs, the paperwork. */}
            <div className="ord-stack">
              <OrdSection
                title="Recipient"
                note="Snapshotted when the order was placed."
                action={
                  // `orders.create` is what the SERVER requires to save
                  // a consignee change ("whoever may commit the company
                  // to a delivery is who may change where it goes").
                  // Gating on anything else shows an Edit whose save
                  // comes back 403 — cosmetic RBAC that disagrees with
                  // the boundary is worse than none.
                  identity !== null && can(identity, 'orders.create') ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<Pencil size={14} />}
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
                      Edit
                    </Button>
                  ) : undefined
                }
              >
                <div className="ord-stack ord-stack--tight">
                  {detail.data.storeKind === 'RESELLER' && (
                    // The order is yours and so are its details; the
                    // note says who sold to this person, because they
                    // are who the customer will ring first.
                    <p className="ord-p">
                      Sold by your reseller store{' '}
                      {detail.data.storeId !== null ? (
                        <Link href={`/reseller-stores/${detail.data.storeId}`} className="ord-link">
                          {detail.data.storeNameSnapshot ?? 'a reseller store'}
                        </Link>
                      ) : (
                        <span className="ord-strong">
                          {detail.data.storeNameSnapshot ?? 'a reseller store'}
                        </span>
                      )}
                      .
                    </p>
                  )}
                  <Facts
                    items={[
                      { label: 'Name', value: detail.data.recipientName },
                      {
                        label: 'Phone',
                        value: (
                          <span className="sk-figure">
                            {detail.data.recipientPhoneE164}
                            {detail.data.recipientAltPhoneE164 && (
                              <span className="ord-faint">
                                {' '}
                                / {detail.data.recipientAltPhoneE164}
                              </span>
                            )}
                          </span>
                        ),
                      },
                      ...(detail.data.recipientEmail
                        ? [{ label: 'Email', value: detail.data.recipientEmail }]
                        : []),
                      {
                        label: 'Address',
                        value: (
                          <>
                            <div>{detail.data.recipientAddressLine1}</div>
                            {detail.data.recipientAddressLine2 && (
                              <div>{detail.data.recipientAddressLine2}</div>
                            )}
                            {detail.data.recipientLandmark && (
                              <div className="ord-faint">
                                Landmark: {detail.data.recipientLandmark}
                              </div>
                            )}
                            <div>
                              {[detail.data.recipientCity, detail.data.recipientStateProvince]
                                .filter(Boolean)
                                .join(', ')}{' '}
                              <span className="sk-figure">{detail.data.recipientPostalCode}</span>{' '}
                              <span className="ord-faint">{detail.data.recipientCountryCode}</span>
                            </div>
                          </>
                        ),
                      },
                    ]}
                  />
                </div>
              </OrdSection>

              {/* Six facts do not need two bordered boxes and two
                  heads, so they are one section and one list that
                  reflows to a single column on a phone. */}
              <OrdSection title="Payment &amp; parcel" note="What it is worth and what it weighs.">
                <Facts
                  items={[
                    {
                      label: 'Payment mode',
                      value: detail.data.paymentMode === 'COD' ? 'Cash on delivery' : 'Prepaid',
                    },
                    {
                      // The one figure here that decides whether the
                      // parcel is worth chasing, through `Money` so it
                      // groups the Indian way and sits on tabular
                      // figures.
                      label: 'To collect',
                      value:
                        detail.data.codAmountInr === null ? (
                          <span className="ord-faint">Prepaid</span>
                        ) : (
                          <span className="ord-strong">
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
                          <span className="sk-figure">{detail.data.totalWeightGrams} g</span>
                        ),
                    },
                    {
                      label: 'Package',
                      value: packageWords(detail.data.packageType),
                    },
                    {
                      label: 'Flags',
                      value: detail.data.isUrgent ? (
                        <StatusChip kind="pending" label="Urgent" size="sm" />
                      ) : (
                        <Dash />
                      ),
                    },
                  ]}
                />
              </OrdSection>

              <OrdSection
                title="Items"
                note={`${detail.data.items.length} ${detail.data.items.length === 1 ? 'line' : 'lines'}`}
                flush
              >
                <Table caption="Items on this order">
                  <THead>
                    <Tr>
                      <Th className="ord-thumb-cell" aria-label="Picture" />
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
                      <TableEmpty colSpan={5}>No items recorded on this order.</TableEmpty>
                    )}
                    {detail.data.items.map((item) => (
                      <Tr key={item.id}>
                        <Td className="ord-thumb-cell">
                          {/* Live presigned thumbnail, NOT the snapshot's
                              stored url — that one has resolved for
                              nobody since the bucket went private. */}
                          <ProductThumb src={item.imageUrl} size={36} />
                        </Td>
                        <Td>
                          <span className="sk-ident">{item.skuCode}</span>
                        </Td>
                        <Td>
                          {item.productName}
                          {item.variantLabel && (
                            <span className="ord-faint"> · {item.variantLabel}</span>
                          )}
                        </Td>
                        <Td align="right">
                          <span className="sk-figure">{item.quantity}</span>
                        </Td>
                        <Td align="right">
                          <span className="sk-figure ord-muted">
                            {item.unitWeightGrams === null ? <Dash /> : `${item.unitWeightGrams} g`}
                          </span>
                        </Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              </OrdSection>

              {detail.data.sellerNotes && (
                <OrdSection title="Your notes" note="What you told us at order time.">
                  <p className="ord-body">{detail.data.sellerNotes}</p>
                </OrdSection>
              )}

              {/* Hidden rather than shown-and-refused for a VIEWER: the
                  server rejects /charges for that role, and rendering its
                  403 in a red box reads as a broken page rather than as
                  policy. Cosmetic — the server is still the boundary. */}
              {identity !== null && can(identity, 'charges.view') && (
                <OrdSection title="Charges" note="What this parcel costs you." flush>
                  <OrderChargesSection orderId={orderId} />
                </OrdSection>
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

              <OrdSection title="Invoice" note="The tax document for this sale.">
                <OrderInvoiceSection
                  orderId={orderId}
                  orderNumber={detail.data.orderNumber}
                  status={detail.data.status}
                />
              </OrdSection>

              {/* Directly UNDER the invoice, in the facts column: position
                  in a two-column layout is what the eye sees, not what
                  the DOM order says. */}
              <DeliveryTroublePanel
                orderId={orderId}
                orderNumber={detail.data.orderNumber}
                orderStatus={detail.data.status}
                open={askOpen}
                onOpenChange={setAskOpen}
              />
              <OrderTicketsPanel
                orderId={orderId}
                raising={raiseOpen}
                onRaisingChange={setRaiseOpen}
              />
            </div>
          </div>

          <p className="ord-footnote sk-figure">
            Placed {new Date(detail.data.placedAt).toISOString().replace('T', ' ').slice(0, 16)} ·
            Updated {new Date(detail.data.updatedAt).toISOString().replace('T', ' ').slice(0, 16)}
          </p>

          <ReattemptRequestDialog
            orderId={orderId}
            orderNumber={detail.data.orderNumber}
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

/** The package type in words — the enum names the same three things. */
function packageWords(t: string): string {
  switch (t) {
    case 'STANDARD':
      return 'Standard';
    case 'FRAGILE':
      return 'Fragile';
    case 'DOCUMENT':
      return 'Document';
    default:
      return t;
  }
}

/**
 * The journey panels.
 *
 * Its own failure surface rather than one shared with the order body:
 * the journey is enrichment, and a courier read that is briefly
 * unavailable must not blank the recipient and the items a seller came
 * to check.
 */
function OrderJourneySection({
  orderId,
  orderNumber,
  status,
}: {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly status: OrderStatus;
}): ReactElement | null {
  const journey = useOrderJourney(orderId);
  if (journey.isPending) return <SkeletonRows rows={4} cols={1} label="Loading the journey…" />;
  if (journey.isError || journey.data === undefined) {
    return (
      <OrdSection title="Order tracker">
        <ErrorState message={serverVerdict(journey.error)} retry={() => void journey.refetch()} />
      </OrdSection>
    );
  }
  return (
    <OrderJourney
      orderNumber={orderNumber}
      status={<StatusChip kind={orderStatusKind(status)} label={statusLabel(status)} size="sm" />}
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
  orderNumber,
  status,
}: {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly status: string;
}): ReactElement {
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
    return <p className="ord-p">Invoices are auto-generated when the order is delivered.</p>;
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
    return <SkeletonRows rows={1} cols={2} label="Loading invoice…" />;
  }

  if (!invoice.data) {
    return (
      <div className="ord-stack ord-stack--tight">
        <div className="ord-row ord-row--between">
          <p className="ord-p">No invoice yet — usually generated within seconds of delivery.</p>
          <AsyncButton
            variant="secondary"
            size="sm"
            icon={<FileText size={14} />}
            state={generate.isPending ? 'busy' : undefined}
            labels={{ idle: 'Generate now', busy: 'Generating…' }}
            onClick={() => setConfirming(true)}
          />
        </div>
        {error && <p className="ord-error">{error}</p>}
        <ConfirmDialog
          open={confirming}
          onOpenChange={setConfirming}
          title="Generate the invoice now?"
          entity={orderNumber}
          entityIsIdentifier
          consequence="We issue the tax invoice for this delivered order. If one already exists, that one is loaded instead."
          confirmLabel="Generate invoice"
          onConfirm={() => onGenerate()}
        />
      </div>
    );
  }

  return (
    <div className="ord-row ord-row--between">
      <div>
        <div className="sk-ident ord-strong">{invoice.data.invoiceNumber}</div>
        <span className="ord-sub">
          Issued {new Date(invoice.data.invoiceDate).toLocaleString()} · Total ₹{' '}
          {invoice.data.totalInr}
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
          className="ord-link ord-link--block"
        >
          <Download size={14} aria-hidden />
          Download PDF
        </a>
      )}
    </div>
  );
}
