'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import type { ReactElement } from 'react';
import type { OrderStatus } from '@skydrop/db';
import type { SellerOrderEventView } from '@skydrop/api-client';
import { useOrderDetail, useOrderEvents } from '@/lib/api-hooks';
import {
  Card,
  CardBody,
  CardHeader,
  ErrorState,
  LoadingState,
  PageHeader,
  Section,
  OrderStatusBadge,
} from '@skydrop/ui/components';
import { OrderTimeline } from './order-timeline';

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
export function OrderDetailView({ orderId }: { orderId: string }): ReactElement {
  const detail = useOrderDetail(orderId);
  const events = useOrderEvents(orderId);

  return (
    <div className="max-w-5xl">
      <Link
        href="/orders"
        className="inline-flex items-center gap-1.5 text-text-muted hover:text-text-body text-xs mb-4 transition-colors"
      >
        <ArrowLeft size={12} /> Orders
      </Link>

      {detail.isLoading ? (
        <LoadingState label="Loading order…" />
      ) : detail.isError ? (
        <ErrorState message={detail.error?.message ?? 'Failed to load order.'} />
      ) : !detail.data ? (
        <ErrorState message="Order not found." />
      ) : (
        <>
          <PageHeader
            title={<span className="font-mono">{detail.data.orderNumber}</span>}
            subtitle={
              detail.data.sellerOrderRef ? (
                <span>
                  Your ref:{' '}
                  <span className="font-mono">{detail.data.sellerOrderRef}</span>
                </span>
              ) : undefined
            }
            action={<OrderStatusBadge status={detail.data.status as OrderStatus} />}
          />

          <Section title="Recipient">
            <Card>
              <CardBody>
                <dl className="grid grid-cols-[160px_1fr] gap-x-6 gap-y-1.5 text-sm">
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
                      {detail.data.recipientCity},{' '}
                      {detail.data.recipientStateProvince}{' '}
                      <span className="font-mono">
                        {detail.data.recipientPostalCode}
                      </span>{' '}
                      <span className="text-text-muted">
                        {detail.data.recipientCountryCode}
                      </span>
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
                <dl className="grid grid-cols-[120px_1fr] gap-x-4 gap-y-1.5 text-sm">
                  <dt className="text-text-muted">Mode</dt>
                  <dd className="text-text-body uppercase">
                    {detail.data.paymentMode}
                  </dd>
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
              <CardHeader title="Physical" />
              <CardBody>
                <dl className="grid grid-cols-[120px_1fr] gap-x-4 gap-y-1.5 text-sm">
                  <dt className="text-text-muted">Weight (g)</dt>
                  <dd className="text-text-body font-mono">
                    {detail.data.totalWeightGrams ?? '—'}
                  </dd>
                  <dt className="text-text-muted">Package</dt>
                  <dd className="text-text-body uppercase">
                    {detail.data.packageType}
                  </dd>
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

          <Section title={`Items (${detail.data.items.length})`}>
            <Card>
              <table className="w-full text-sm">
                <thead className="text-text-muted text-[11px] uppercase tracking-wide bg-surface-raised border-b border-border">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">SKU</th>
                    <th className="text-left px-3 py-2 font-medium">Product</th>
                    <th className="text-right px-3 py-2 font-medium">Qty</th>
                    <th className="text-right px-3 py-2 font-medium">Weight (g)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {detail.data.items.map((item) => (
                    <tr key={item.id}>
                      <td className="px-3 py-2 font-mono text-xs text-text-body">
                        {item.skuCode}
                      </td>
                      <td className="px-3 py-2 text-text-body">
                        {item.productName}
                        {item.variantLabel && (
                          <span className="text-text-muted ml-1">
                            · {item.variantLabel}
                          </span>
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
              </table>
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

          <Section title="Timeline">
            <OrderTimelineSection
              loading={events.isLoading}
              error={events.error?.message ?? null}
              events={events.data ?? null}
            />
          </Section>

          <div className="text-text-faint text-xs text-center mt-8">
            Placed{' '}
            {new Date(detail.data.placedAt).toISOString().replace('T', ' ').slice(0, 16)}{' '}
            · Updated{' '}
            {new Date(detail.data.updatedAt).toISOString().replace('T', ' ').slice(0, 16)}
          </div>
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
  if (error)
    return <ErrorState message={`Failed to load timeline: ${error}`} />;
  if (!events || events.length === 0) {
    return (
      <Card>
        <CardBody>
          <p className="text-text-muted text-sm">
            No seller-visible events yet.
          </p>
        </CardBody>
      </Card>
    );
  }
  return <OrderTimeline events={events} />;
}
