'use client';

import Link from 'next/link';
import { CustomerRiskStrip } from '../../call-center/_components/customer-risk-strip';
import { ArrowLeft, Route, ShieldAlert } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import type { OrderStatus } from '@skydrop/db';
import { useOrderDetail } from '@/lib/api-hooks';
import {
  JourneyTimeline,
  ParcelFacts,
  type JourneyMilestoneView,
  type JourneyParcelView,
  type JourneyEntryView,
} from '@skydrop/ui/components';
import { orderStatusKind, statusLabel } from '@skydrop/ui/status';
import { PageHeader, SectionHeading } from '@skydrop/ui/app/page-header';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { Table, TBody, THead, Td, Th, Tr } from '@skydrop/ui/app/data-table';
import { ErrorState } from '@skydrop/ui/app/empty-state';
import { Skeleton, SkeletonRows } from '@skydrop/ui/app/skeleton';
import { Timeline, type TimelineStep, type TimelineStepState } from '@skydrop/ui/app/timeline';
import { OrderActionsPanel } from './order-actions-panel';
import { OrderChargesSection } from './order-charges';
import { OrderShipmentsSection } from './order-shipments-section';
import { StuckOrderRecovery } from './stuck-order-recovery';
import { useOrderJourney } from '@/lib/ops-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { ConsigneePanel } from './consignee-panel';
import { ResellerOrderPanel } from './reseller-order-panel';
import { ResellerMoneyPanel } from './reseller-money-panel';
import { BackLink, Facts, OoSection } from './order-ops-parts';
import './order-core.css';

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
    <div className="oo-page">
      <BackLink href="/orders" icon={<ArrowLeft size={14} aria-hidden />}>
        Orders
      </BackLink>

      {detail.isLoading ? (
        <div className="oo-stack" aria-busy="true">
          <Skeleton height={36} width="40%" />
          <SkeletonRows rows={6} cols={2} label="Loading order…" />
        </div>
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
              { label: 'Operations' },
              { label: 'Orders', href: '/orders' },
              { label: detail.data.orderNumber },
            ]}
            Link={Link}
            title={<span className="sk-ident">{detail.data.orderNumber}</span>}
            subtitle={
              detail.data.sellerOrderRef ? (
                <span>
                  Seller ref: <span className="sk-ident">{detail.data.sellerOrderRef}</span>
                </span>
              ) : undefined
            }
            action={
              <div className="oc-head-chips">
                {detail.data.hasAdminOverride && (
                  <span
                    className="oc-override"
                    title="This order was modified via god-mode (ORD-2). The flag is set-once and never cleared — it permanently records that admin override was used."
                  >
                    <ShieldAlert size={12} aria-hidden />
                    Override
                  </span>
                )}
                <StatusChip
                  kind={orderStatusKind(detail.data.status)}
                  label={statusLabel(detail.data.status)}
                />
              </div>
            }
          />

          <OoSection title="Recipient">
            {/* The same strip the call agent sees. On this page it is
                the answer to "why did this one come back?" — a customer
                who returns a third of what they order was never a
                surprise, and the RTO investigation should start there. */}
            <CustomerRiskStrip orderId={detail.data.id} />
            <Facts
              items={[
                { label: 'Name', value: detail.data.recipientName },
                {
                  label: 'Phone',
                  value: (
                    <span className="sk-figure">
                      {detail.data.recipientPhoneE164}
                      {detail.data.recipientAltPhoneE164 && (
                        <span className="oo-faint"> / {detail.data.recipientAltPhoneE164}</span>
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
                      <span className="oo-sub oo-body">{detail.data.recipientAddressLine1}</span>
                      {detail.data.recipientAddressLine2 && (
                        <span className="oo-sub oo-body">{detail.data.recipientAddressLine2}</span>
                      )}
                      {detail.data.recipientLandmark && (
                        <span className="oo-sub">Landmark: {detail.data.recipientLandmark}</span>
                      )}
                      <span className="oo-sub oo-body">
                        {[detail.data.recipientCity, detail.data.recipientStateProvince]
                          .filter(Boolean)
                          .join(', ')}{' '}
                        <span className="sk-figure">{detail.data.recipientPostalCode}</span>{' '}
                        <span className="oo-muted">{detail.data.recipientCountryCode}</span>
                      </span>
                    </>
                  ),
                },
              ]}
            />
          </OoSection>

          {/* RS-5 — a reseller store's order: the store and the terms
              snapshot it was placed under. Nothing for a channel order. */}
          <ResellerOrderPanel order={detail.data} />
          {/* RS-6 phase 3c — the full split: both parties, both wallets. */}
          <ResellerMoneyPanel orderId={orderId} enabled={detail.data.storeKind === 'RESELLER'} />

          <div className="oo-grid-2">
            <OoSection title="Payment">
              <Facts
                items={[
                  { label: 'Mode', value: detail.data.paymentMode },
                  {
                    label: 'COD (INR)',
                    value: <span className="sk-figure">{detail.data.codAmountInr ?? '—'}</span>,
                  },
                  {
                    label: 'Declared (INR)',
                    value: <span className="sk-figure">{detail.data.declaredValueInr ?? '—'}</span>,
                  },
                ]}
              />
            </OoSection>
            <OoSection title="Physical">
              <Facts
                items={[
                  {
                    label: 'Weight (g)',
                    value: <span className="sk-figure">{detail.data.totalWeightGrams ?? '—'}</span>,
                  },
                  { label: 'Package', value: detail.data.packageType },
                  {
                    label: 'Flags',
                    value:
                      detail.data.isUrgent || detail.data.isHighRisk ? (
                        <span className="oo-row">
                          {detail.data.isUrgent && (
                            <span className="oc-flag" data-tone="warn">
                              Urgent
                            </span>
                          )}
                          {detail.data.isHighRisk && (
                            <span className="oc-flag" data-tone="bad">
                              High risk
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="oo-muted">—</span>
                      ),
                  },
                ]}
              />
            </OoSection>
          </div>

          <OoSection title={`Items (${detail.data.items.length})`} flush>
            <Table caption="Items">
              <THead>
                <Tr>
                  <Th>SKU</Th>
                  <Th>Product</Th>
                  <Th align="right">Qty</Th>
                  <Th align="right">Reserved</Th>
                  <Th align="right">Weight (g)</Th>
                </Tr>
              </THead>
              <TBody>
                {detail.data.items.map((item) => (
                  <Tr key={item.id}>
                    <Td>
                      <span className="sk-ident">{item.skuCode}</span>
                    </Td>
                    <Td>
                      {item.productName}
                      {item.variantLabel && (
                        <span className="oo-muted"> · {item.variantLabel}</span>
                      )}
                    </Td>
                    <Td align="right">
                      <span className="sk-figure">{item.quantity}</span>
                    </Td>
                    <Td align="right">
                      <span className="sk-figure oo-muted">{item.qtyReserved}</span>
                    </Td>
                    <Td align="right">
                      <span className="sk-figure oo-muted">{item.unitWeightGrams ?? '—'}</span>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </OoSection>

          {(detail.data.sellerNotes || detail.data.internalNotes || detail.data.callNotes) && (
            <OoSection title="Notes">
              {detail.data.sellerNotes && (
                <NoteBlock label="From seller">{detail.data.sellerNotes}</NoteBlock>
              )}
              {detail.data.callNotes && (
                <NoteBlock label="Call center">{detail.data.callNotes}</NoteBlock>
              )}
              {detail.data.internalNotes && (
                <NoteBlock label="Internal">{detail.data.internalNotes}</NoteBlock>
              )}
            </OoSection>
          )}

          <section className="oo-section">
            <SectionHeading title="Charges" />
            <OrderChargesSection orderId={orderId} orderNumber={detail.data.orderNumber} />
          </section>

          <section className="oo-section">
            <SectionHeading title="Shipments" />
            <div className="oo-stack">
              {/* Renders nothing unless the order is actually stuck. */}
              <StuckOrderRecovery
                orderId={orderId}
                orderStatus={detail.data.status}
                orderNumber={detail.data.orderNumber}
              />

              <OrderShipmentsSection orderId={orderId} orderStatus={detail.data.status} />
              {/* Correcting the consignee sits with the parcel: it is only
                  ever done while looking at a delivery about to go wrong. */}
              <ConsigneePanel orderId={orderId} />
            </div>
          </section>

          {/* The whole journey — the stage ladder, what the courier
              says the parcel weighs and will collect, and our handling
              merged with their scans. Staff also see the courier's own
              NSL codes: an agent explaining a delay needs the code the
              courier will quote back at them. */}
          <OrderJourneySection
            orderId={orderId}
            orderNumber={detail.data.orderNumber}
            status={detail.data.status}
          />

          <section className="oo-section">
            <SectionHeading title="Actions" />
            <OrderActionsPanel order={detail.data} />
          </section>

          <div className="oc-footnote sk-figure">
            Placed {new Date(detail.data.placedAt).toISOString().replace('T', ' ').slice(0, 16)} ·{' '}
            Updated {new Date(detail.data.updatedAt).toISOString().replace('T', ' ').slice(0, 16)}
          </div>
        </>
      )}
    </div>
  );
}

function NoteBlock({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <div className="oc-note-block">
      <span className="oc-note-block__label">{label}</span>
      <p className="oo-body">{children}</p>
    </div>
  );
}

/** The ladder's own time format, unchanged. */
function fmt(at: string | null): string {
  if (at === null) return '—';
  return new Date(at).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** An estimated date carries no time. */
function fmtDate(at: string | null): string {
  if (at === null) return '—';
  return new Date(at).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

const STEP_STATE: Record<JourneyMilestoneView['state'], TimelineStepState> = {
  DONE: 'done',
  CURRENT: 'current',
  PENDING: 'todo',
  SKIPPED: 'skipped',
};

/** Milestones → u17 timeline steps. Same labels, same owner word, same times. */
function milestoneSteps(milestones: readonly JourneyMilestoneView[]): TimelineStep[] {
  return milestones.map((m) => {
    const owner = m.owner === 'SKYDROP' ? 'Skydrop' : 'Courier';
    const description: ReactNode = (
      <>
        <span>{owner}</span>
        {m.state === 'SKIPPED' && <span> · not needed</span>}
        {m.detail !== null && <span className="oo-sub">{m.detail}</span>}
      </>
    );
    return {
      id: m.key,
      label: m.label,
      state: STEP_STATE[m.state],
      description,
      ...(m.at === null ? {} : { time: m.estimated ? `Estimated ${fmtDate(m.at)}` : fmt(m.at) }),
    };
  });
}

function OrderJourney({
  orderNumber,
  status,
  milestones,
  parcels,
  entries,
}: {
  readonly orderNumber: string;
  readonly status: OrderStatus;
  readonly milestones: readonly JourneyMilestoneView[];
  readonly parcels: readonly JourneyParcelView[];
  readonly entries: readonly JourneyEntryView[];
}): ReactElement {
  // The latest parcel, as the shared panels chose it.
  const parcel = parcels[parcels.length - 1] ?? null;
  return (
    <div className="oo-stack">
      <div className={parcel === null ? 'oo-stack' : 'oo-split'}>
        <OoSection title="Order tracker">
          <Timeline
            label="Order tracker"
            steps={milestoneSteps(milestones)}
            header={{
              icon: <Route size={16} />,
              title: 'Order',
              id: orderNumber,
              status: (
                <StatusChip kind={orderStatusKind(status)} label={statusLabel(status)} size="sm" />
              ),
            }}
          />
        </OoSection>
        {parcel !== null && (
          <OoSection title="Parcel">
            <ParcelFacts parcel={parcel} />
          </OoSection>
        )}
      </div>
      <OoSection title="Full history">
        <JourneyTimeline entries={entries} showCourierCodes />
      </OoSection>
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
function OrderJourneySection({
  orderId,
  orderNumber,
  status,
}: {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly status: OrderStatus;
}): ReactElement {
  const journey = useOrderJourney(orderId);
  if (journey.isPending) return <SkeletonRows rows={4} cols={1} label="Loading the journey…" />;
  if (journey.isError || journey.data === undefined) {
    return (
      <OoSection title="Order tracker">
        <ErrorState message={serverVerdict(journey.error)} retry={() => void journey.refetch()} />
      </OoSection>
    );
  }
  return (
    <OrderJourney
      orderNumber={orderNumber}
      status={status}
      milestones={journey.data.milestones}
      parcels={journey.data.parcels}
      entries={journey.data.timeline}
    />
  );
}
