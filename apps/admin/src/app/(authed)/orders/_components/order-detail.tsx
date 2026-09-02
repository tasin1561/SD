'use client';

import Link from 'next/link';
import { CustomerRiskStrip } from '../../call-center/_components/customer-risk-strip';
import { ArrowLeft } from 'lucide-react';
import type { ReactElement } from 'react';
import { useOrderDetail } from '@/lib/api-hooks';
import {
  Card,
  CardBody,
  CardHeader,
  ErrorState,
  HasOverrideBadge,
  LoadingState,
  OrderStatusBadge,
  PageHeader,
  Section,
  Table,
  OrderJourneyPanels,
  SkeletonRows,
  ErrorNote,
} from '@skydrop/ui/components';
import { OrderActionsPanel } from './order-actions-panel';
import { OrderChargesSection } from './order-charges';
import { OrderShipmentsSection } from './order-shipments-section';
import { StuckOrderRecovery } from './stuck-order-recovery';
import { useOrderJourney } from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { ConsigneePanel } from './consignee-panel';

/**
 * Order detail. Single-fetch (admin /orders/:id). Renders:
 *   - Header (order number + status badge + override badge if set)
 *   - Recipient (immutable ORD-6 snapshot)
 *   - Payment + physical
 *   - Items table
 *   - Notes
 *   - Action panel (sane admin cancel here; god-mode in CP2.10)
 *   - Timeline (full admin events incl. internal-only — uses
 *     the merged Skydrop + courier journey)
 */
export function OrderDetailView({ orderId }: { orderId: string }): ReactElement {
  const detail = useOrderDetail(orderId);

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
                  Seller ref: <span className="font-mono">{detail.data.sellerOrderRef}</span>
                </span>
              ) : undefined
            }
            action={
              <div className="flex items-center gap-2">
                {detail.data.hasAdminOverride && <HasOverrideBadge />}
                <OrderStatusBadge status={detail.data.status} />
              </div>
            }
          />

          <Section title="Recipient">
            {/* The same strip the call agent sees. On this page it is
                the answer to "why did this one come back?" — a customer
                who returns a third of what they order was never a
                surprise, and the RTO investigation should start there. */}
            <CustomerRiskStrip orderId={detail.data.id} />
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
                    {detail.data.isUrgent || detail.data.isHighRisk ? (
                      <div className="flex items-center gap-1.5">
                        {detail.data.isUrgent && (
                          <span className="text-pending text-xs uppercase tracking-wide">
                            Urgent
                          </span>
                        )}
                        {detail.data.isHighRisk && (
                          <span className="text-critical text-xs uppercase tracking-wide">
                            High risk
                          </span>
                        )}
                      </div>
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
                    <th className="text-left px-3 py-2 font-medium">SKU</th>
                    <th className="text-left px-3 py-2 font-medium">Product</th>
                    <th className="text-right px-3 py-2 font-medium">Qty</th>
                    <th className="text-right px-3 py-2 font-medium">Reserved</th>
                    <th className="text-right px-3 py-2 font-medium">Weight (g)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {detail.data.items.map((item) => (
                    <tr key={item.id}>
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
                        {item.qtyReserved}
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

          {(detail.data.sellerNotes || detail.data.internalNotes || detail.data.callNotes) && (
            <Section title="Notes">
              <Card>
                <CardBody className="space-y-3">
                  {detail.data.sellerNotes && (
                    <div>
                      <div className="text-text-faint text-xs uppercase tracking-wide mb-0.5">
                        From seller
                      </div>
                      <p className="text-text-body text-sm whitespace-pre-wrap">
                        {detail.data.sellerNotes}
                      </p>
                    </div>
                  )}
                  {detail.data.callNotes && (
                    <div>
                      <div className="text-text-faint text-xs uppercase tracking-wide mb-0.5">
                        Call center
                      </div>
                      <p className="text-text-body text-sm whitespace-pre-wrap">
                        {detail.data.callNotes}
                      </p>
                    </div>
                  )}
                  {detail.data.internalNotes && (
                    <div>
                      <div className="text-text-faint text-xs uppercase tracking-wide mb-0.5">
                        Internal
                      </div>
                      <p className="text-text-body text-sm whitespace-pre-wrap">
                        {detail.data.internalNotes}
                      </p>
                    </div>
                  )}
                </CardBody>
              </Card>
            </Section>
          )}

          <Section title="Charges">
            <OrderChargesSection orderId={orderId} />
          </Section>

          <Section title="Shipments">
            {/* Renders nothing unless the order is actually stuck. */}
            <StuckOrderRecovery orderId={orderId} orderStatus={detail.data.status} />

            <OrderShipmentsSection orderId={orderId} orderStatus={detail.data.status} />
            {/* Correcting the consignee sits with the parcel: it is only
                ever done while looking at a delivery about to go wrong. */}
            <ConsigneePanel orderId={orderId} />
          </Section>

          {/* The whole journey — the stage ladder, what the courier
              says the parcel weighs and will collect, and our handling
              merged with their scans. Staff also see the courier's own
              NSL codes: an agent explaining a delay needs the code the
              courier will quote back at them. */}
          <OrderJourneySection orderId={orderId} />

          <Section title="Actions">
            <OrderActionsPanel order={detail.data} />
          </Section>

          <div className="text-text-faint text-xs text-center mt-8">
            Placed {new Date(detail.data.placedAt).toISOString().replace('T', ' ').slice(0, 16)} ·{' '}
            Updated {new Date(detail.data.updatedAt).toISOString().replace('T', ' ').slice(0, 16)}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * The journey panels, with its own failure surface.
 *
 * Separate from the order body on purpose: the journey reads courier
 * data, and a courier read that is briefly unavailable must not blank
 * the recipient and the items an agent has the customer on the phone
 * about.
 */
function OrderJourneySection({ orderId }: { readonly orderId: string }): ReactElement {
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
      showCourierCodes
    />
  );
}
