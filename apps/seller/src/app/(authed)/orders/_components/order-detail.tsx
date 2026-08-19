'use client';

import Link from 'next/link';
import { ProductThumb } from '@/components/product-thumb';
import { ArrowLeft, Pencil, XCircle } from 'lucide-react';
import { useState, type ReactElement } from 'react';
import type { OrderStatus } from '@skydrop/db';
import { ApiError } from '@skydrop/api-client';
import type { SellerOrderEventView } from '@skydrop/api-client';
import {
  useGenerateInvoice,
  useOrderDetail,
  useOrderEvents,
  useOrderInvoice,
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
} from '@skydrop/ui/components';
import { OrderTimeline } from './order-timeline';
import { CancelOrderDialog } from './cancel-order-dialog';
import { OrderChargesSection } from './order-charges';
import { can } from '@/lib/page-access';
import { useSellerIdentity } from '@skydrop/auth/client';

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

export function OrderDetailView({ orderId }: { orderId: string }): ReactElement {
  const detail = useOrderDetail(orderId);
  const events = useOrderEvents(orderId);
  const identity = useSellerIdentity();
  const [cancelOpen, setCancelOpen] = useState(false);

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
                {(detail.data.status === 'DRAFT' ||
                  detail.data.status === 'PENDING_CONFIRMATION') && (
                  <Link href={`/orders/${orderId}/edit`}>
                    <Button variant="secondary" size="sm">
                      <Pencil size={12} /> Edit
                    </Button>
                  </Link>
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

          <Section title="Recipient">
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
                      <span className="text-text-muted">{detail.data.recipientCountryCode}</span>
                    </div>
                  </dd>
                </dl>
              </CardBody>
            </Card>
          </Section>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <Card>
              <CardHeader title="Payment" />
              <CardBody>
                <dl className="grid grid-cols-[minmax(84px,36%)_1fr] sm:grid-cols-[120px_1fr] gap-x-3 sm:gap-x-4 gap-y-1.5 text-sm">
                  <dt className="text-text-muted">Mode</dt>
                  <dd className="text-text-body uppercase">{detail.data.paymentMode}</dd>
                  <dt className="text-text-muted">COD (INR)</dt>
                  <dd className="text-text-body font-mono">{detail.data.codAmountInr ?? '—'}</dd>
                  <dt className="text-text-muted">Declared (INR)</dt>
                  <dd className="text-text-body font-mono">
                    {detail.data.declaredValueInr ?? '—'}
                  </dd>
                </dl>
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Physical" />
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
                      <span className="text-pending text-xs uppercase tracking-wide">Urgent</span>
                    ) : (
                      <span className="text-text-muted">—</span>
                    )}
                  </dd>
                </dl>
              </CardBody>
            </Card>
          </div>

          <Section title={`Items (${detail.data.items.length})`}>
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
                  {detail.data.items.map((item) => (
                    <tr key={item.id}>
                      <td className="px-3 py-2 w-px">
                        {/* Live presigned thumbnail, NOT the snapshot's
                            stored url — that one has resolved for nobody
                            since the bucket went private. */}
                        <ProductThumb src={item.imageUrl} size={36} />
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-text-body">{item.skuCode}</td>
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
            <Section title="Notes">
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
            <Section title="Charges">
              <OrderChargesSection orderId={orderId} />
            </Section>
          )}

          <Section title="Invoice">
            <OrderInvoiceSection orderId={orderId} status={detail.data.status} />
          </Section>

          <Section title="Timeline">
            <OrderTimelineSection
              loading={events.isLoading}
              error={events.error?.message ?? null}
              events={events.data ?? null}
            />
          </Section>

          <div className="text-text-faint text-xs text-center mt-8">
            Placed {new Date(detail.data.placedAt).toISOString().replace('T', ' ').slice(0, 16)} ·
            Updated {new Date(detail.data.updatedAt).toISOString().replace('T', ' ').slice(0, 16)}
          </div>

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

function OrderTimelineSection({
  loading,
  error,
  events,
}: {
  loading: boolean;
  error: string | null;
  events: readonly SellerOrderEventView[] | null;
}): ReactElement {
  if (loading) return <LoadingState label="Loading timeline…" />;
  if (error) return <ErrorState message={`Failed to load timeline: ${error}`} />;
  if (!events || events.length === 0) {
    return (
      <Card>
        <CardBody>
          <p className="text-text-muted text-sm">No seller-visible events yet.</p>
        </CardBody>
      </Card>
    );
  }
  return <OrderTimeline events={events} />;
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
          {invoice.data.pdfUrl && (
            <a
              href={invoice.data.pdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-accent hover:underline text-sm"
            >
              Download PDF →
            </a>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
