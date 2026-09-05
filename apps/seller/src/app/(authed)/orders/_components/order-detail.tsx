'use client';

import Link from 'next/link';

import {
  ArrowLeft,
  Clock,
  CreditCard,
  FileText,
  Package,
  Pencil,
  PhoneCall,
  Receipt,
  Ruler,
  StickyNote,
  Undo2,
  User,
  XCircle,
} from 'lucide-react';
import { useState, type ReactElement, type ReactNode } from 'react';
import { useDeliveryActions } from '@/lib/ops-hooks';
import type { OrderStatus } from '@skydrop/db';
import { ApiError } from '@skydrop/api-client';
import {
  useGenerateInvoice,
  useOrderDetail,
  useOrderReattemptRequests,
  useOrderInvoice,
  useOrderJourney,
} from '@/lib/api-hooks';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  ErrorState,
  LoadingState,
  OrderStatusBadge,
  PageHeader,
  Section,
  Table,
  useToast,
  ProductThumb,
  OrderJourneyPanels,
  SkeletonRows,
  ErrorNote,
} from '@skydrop/ui/components';
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
  'CONFIRMED',
  'OUT_OF_STOCK',
  'PENDING_PICK',
  'PICKED',
  'PACK_FAILED',
  'PENDING_MANUAL_PLACEMENT',
]);

/**
 * A section heading with its own accent icon.
 *
 * The comps put a small coloured glyph on every card head, and it does
 * more than decorate: a column of eight grey headings is scanned by
 * reading all eight, while a column of eight distinct glyphs is scanned
 * by shape. The icon carries the accent colour — the one place on these
 * cards where the palette shows — and it is `aria-hidden`, because the
 * heading text already says what this is.
 */
function Titled({
  icon: Icon,
  children,
}: {
  readonly icon: typeof User;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <span className="inline-flex items-center gap-2">
      <Icon size={14} className="text-accent shrink-0" aria-hidden />
      {children}
    </span>
  );
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
  const [askOpen, setAskOpen] = useState(false);
  const [raiseOpen, setRaiseOpen] = useState(false);
  const deliveryActions = useDeliveryActions(orderId);
  const canAsk = deliveryActions.data?.canRequest === true;

  return (
    <div>
      <Link
        href="/orders"
        className="inline-flex items-center gap-1.5 text-text-muted hover:text-text-body text-xs mb-4 transition-colors"
      >
        <ArrowLeft size={12} /> Orders
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
            title={<span className="font-mono">{detail.data.orderNumber}</span>}
            subtitle={
              detail.data.sellerOrderRef ? (
                <span>
                  Your ref: <span className="font-mono">{detail.data.sellerOrderRef}</span>
                </span>
              ) : undefined
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
              specific delivery that is about to go wrong. */}
          <ConsigneePanel orderId={orderId} />

          {/*
            `mt-6` because the panels above space themselves from what
            precedes them (each carries its own `mt-4`) and this grid
            carried nothing — so the facts butted straight up against
            the consignee panel with no gap at all. Six rather than four:
            this is the seam between "something needs you" and "here is
            the order", and it should read as a bigger break than the
            one between two notices.
          */}
          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
            {/* The journey: the stage ladder, the parcels, and the
                courier's own scans merged with our handling. */}
            <div className="min-w-0 space-y-4">
              <OrderJourneySection orderId={orderId} />
            </div>

            {/* The facts, in the order a seller checks them: who it is
                going to, what is in it, what it costs, the paperwork. */}
            <div className="min-w-0 space-y-4">
              <Section title={<Titled icon={User}>Recipient</Titled>}>
                <Card>
                  <CardBody>
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
                          <span className="text-text-muted">
                            {detail.data.recipientCountryCode}
                          </span>
                        </div>
                      </dd>
                    </dl>
                  </CardBody>
                </Card>
              </Section>

              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                <Card>
                  <CardHeader title={<Titled icon={CreditCard}>Payment</Titled>} />
                  <CardBody>
                    <dl className="grid grid-cols-[minmax(84px,36%)_1fr] sm:grid-cols-[120px_1fr] gap-x-3 sm:gap-x-4 gap-y-1.5 text-sm">
                      <dt className="text-text-muted">Mode</dt>
                      <dd className="text-text-body uppercase">{detail.data.paymentMode}</dd>
                      <dt className="text-text-muted">COD (INR)</dt>
                      <dd className="text-text-body font-mono">
                        {detail.data.codAmountInr ?? '—'}
                      </dd>
                      <dt className="text-text-muted">Declared (INR)</dt>
                      <dd className="text-text-body font-mono">
                        {detail.data.declaredValueInr ?? '—'}
                      </dd>
                    </dl>
                  </CardBody>
                </Card>
                <Card>
                  <CardHeader title={<Titled icon={Ruler}>Physical</Titled>} />
                  <CardBody>
                    <dl className="grid grid-cols-[minmax(84px,36%)_1fr] sm:grid-cols-[120px_1fr] gap-x-3 sm:gap-x-4 gap-y-1.5 text-sm">
                      <dt className="text-text-muted">Weight (g)</dt>
                      <dd className="text-text-body font-mono">
                        {detail.data.totalWeightGrams ?? '—'}
                      </dd>
                      <dt className="text-text-muted">Package</dt>
                      <dd className="text-text-body uppercase">{detail.data.packageType}</dd>
                      <dt className="text-text-muted">Flags</dt>
                      <dd className="text-text-body">
                        {detail.data.isUrgent ? (
                          <span className="text-pending text-xs uppercase tracking-wide">
                            Urgent
                          </span>
                        ) : (
                          <span className="text-text-muted">—</span>
                        )}
                      </dd>
                    </dl>
                  </CardBody>
                </Card>
              </div>

              <Section title={<Titled icon={Package}>Items ({detail.data.items.length})</Titled>}>
                <Card>
                  <Table wrapperClassName="rounded-none border-0 bg-transparent">
                    <thead className="text-text-muted text-xs uppercase tracking-wide bg-surface-raised border-b border-border">
                      <tr>
                        <th className="px-3 py-2 font-medium w-px">
                          <span className="sr-only">Image</span>
                        </th>
                        <th className="text-left px-3 py-2 font-medium">SKU</th>
                        <th className="text-left px-3 py-2 font-medium">Product</th>
                        <th className="text-right px-3 py-2 font-medium">Qty</th>
                        <th className="text-right px-3 py-2 font-medium">Weight (g)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {detail.data.items.length === 0 && (
                        // A header row over nothing says less than a
                        // sentence does.
                        <tr>
                          <td colSpan={5} className="text-text-muted px-3 py-4 text-center text-sm">
                            No items recorded on this order.
                          </td>
                        </tr>
                      )}
                      {detail.data.items.map((item) => (
                        <tr key={item.id}>
                          <td className="px-3 py-2 w-px">
                            {/* Live presigned thumbnail, NOT the snapshot's
                            stored url — that one has resolved for nobody
                            since the bucket went private. */}
                            <ProductThumb src={item.imageUrl} size={36} />
                          </td>
                          <td className="px-3 py-2 font-mono text-xs text-text-body">
                            {item.skuCode}
                          </td>
                          <td className="px-3 py-2 text-text-body">
                            {item.productName}
                            {item.variantLabel && (
                              <span className="text-text-muted ml-1">· {item.variantLabel}</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right text-text-body font-mono">
                            {item.quantity}
                          </td>
                          <td className="px-3 py-2 text-right text-text-muted font-mono text-xs">
                            {item.unitWeightGrams ?? '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </Card>
              </Section>

              {detail.data.sellerNotes && (
                <Section title={<Titled icon={StickyNote}>Notes</Titled>}>
                  <Card>
                    <CardBody>
                      <p className="text-text-body text-sm whitespace-pre-wrap">
                        {detail.data.sellerNotes}
                      </p>
                    </CardBody>
                  </Card>
                </Section>
              )}

              {/* Hidden rather than shown-and-refused for a VIEWER: the
              server rejects /charges for that role, and rendering its
              403 in a red box reads as a broken page rather than as
              policy. Cosmetic — the server is still the boundary. */}
              {identity !== null && can(identity, 'charges.view') && (
                <Section title={<Titled icon={Receipt}>Charges</Titled>}>
                  <OrderChargesSection orderId={orderId} />
                </Section>
              )}

              <Section title={<Titled icon={FileText}>Invoice</Titled>}>
                <OrderInvoiceSection orderId={orderId} status={detail.data.status} />
              </Section>

              {/*
                Every conversation open on this parcel, at the FOOT of
                the facts rather than up with the trouble panel.

                It moved because of what it says most of the time:
                "nothing raised yet". A panel whose usual content is an
                absence was sitting third from the top, pushing the
                recipient and the parcel down the page on every healthy
                order. Down here it is where somebody arrives having
                read the order and decided something is wrong — which is
                the moment they want it.
              */}
              {/* What we did about it, and every conversation open on
                  it — both below the invoice, both read AFTER the order
                  rather than before it. The buttons that drive them are
                  in the header. */}
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
      <Section title="Order tracker">
        <ErrorNote message={serverVerdict(journey.error)} retry={() => void journey.refetch()} />
      </Section>
    );
  }
  return (
    <OrderJourneyPanels
      milestones={journey.data.milestones}
      parcels={journey.data.parcels}
      entries={journey.data.timeline}
      allParcelsHref="/tracking"
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

  if (status !== 'DELIVERED') {
    return (
      <Card>
        <CardBody>
          <p className="text-text-muted text-sm">
            Invoices are auto-generated when the order is delivered.
          </p>
        </CardBody>
      </Card>
    );
  }

  async function onGenerate(): Promise<void> {
    setError(null);
    try {
      const res = await generate.mutateAsync();
      toast.success(res.alreadyExisted ? 'Invoice loaded.' : 'Invoice generated.');
    } catch (e) {
      if (e instanceof ApiError) {
        const b = e.body as { code?: unknown; message?: unknown } | null;
        const code = typeof b?.code === 'string' ? b.code : null;
        const msg = typeof b?.message === 'string' ? b.message : e.message;
        setError(code ? `[${code}] ${msg}` : msg);
      } else {
        setError(e instanceof Error ? e.message : 'Generation failed');
      }
    }
  }

  if (invoice.isLoading) return <LoadingState label="Loading invoice…" />;

  if (!invoice.data) {
    return (
      <Card>
        <CardBody>
          <div className="flex items-baseline justify-between gap-3">
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
          {error && <div className="text-critical text-xs mt-2">{error}</div>}
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardBody>
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <div className="text-text-bright text-sm font-mono">{invoice.data.invoiceNumber}</div>
            <div className="text-text-muted text-xs mt-0.5">
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
      </CardBody>
    </Card>
  );
}
