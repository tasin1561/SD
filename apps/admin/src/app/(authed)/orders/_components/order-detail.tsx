'use client';

import Link from 'next/link';
import { CustomerRiskStrip } from '../../call-center/_components/customer-risk-strip';
import { ArrowLeft, Route, ShieldAlert } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import type { OrderStatus } from '@skydrop/db';
import { useLocale, useT } from '@/i18n/client';
import type { MessageKey } from '@/i18n/catalog';
import type { Translate } from '@skydrop/ui/app/i18n';
import { useOrderDetail } from '@/lib/api-hooks';
import {
  JourneyTimeline,
  ParcelFacts,
  type JourneyMilestoneView,
  type JourneyParcelView,
  type JourneyEntryView,
} from '@skydrop/ui/components';
import { journeyOwnerLabel, orderStatusKind, statusLabel } from '@skydrop/ui/status';
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
  const t = useT();
  const locale = useLocale();
  const detail = useOrderDetail(orderId);

  return (
    <div className="oo-page">
      <BackLink href="/orders" icon={<ArrowLeft size={14} aria-hidden />}>
        {t('orderDetail.back')}
      </BackLink>

      {detail.isLoading ? (
        <div className="oo-stack" aria-busy="true">
          <Skeleton height={36} width="40%" />
          <SkeletonRows rows={6} cols={2} label={t('orderDetail.loading')} />
        </div>
      ) : detail.isError ? (
        <ErrorState
          message={detail.error?.message ?? t('orderDetail.loadFailed')}
          retry={() => void detail.refetch()}
        />
      ) : !detail.data ? (
        <ErrorState message={t('orderDetail.notFound')} />
      ) : (
        <>
          <PageHeader
            breadcrumbs={[
              { label: t('orderDetail.crumb.operations') },
              { label: t('orderDetail.crumb.orders'), href: '/orders' },
              { label: detail.data.orderNumber },
            ]}
            Link={Link}
            title={<span className="sk-ident">{detail.data.orderNumber}</span>}
            subtitle={
              detail.data.sellerOrderRef ? (
                <span>
                  {t('orderDetail.clientRef')}{' '}
                  <span className="sk-ident">{detail.data.sellerOrderRef}</span>
                </span>
              ) : undefined
            }
            action={
              <div className="oc-head-chips">
                {detail.data.hasAdminOverride && (
                  <span className="oc-override" title={t('orderDetail.override.title')}>
                    <ShieldAlert size={12} aria-hidden />
                    {t('orderDetail.override.chip')}
                  </span>
                )}
                <StatusChip
                  kind={orderStatusKind(detail.data.status)}
                  label={statusLabel(detail.data.status, locale)}
                />
              </div>
            }
          />

          <OoSection title={t('orderDetail.recipient')}>
            {/* The same strip the call agent sees. On this page it is
                the answer to "why did this one come back?" — a customer
                who returns a third of what they order was never a
                surprise, and the RTO investigation should start there. */}
            <CustomerRiskStrip orderId={detail.data.id} />
            <Facts
              items={[
                { label: t('orderDetail.name'), value: detail.data.recipientName },
                {
                  label: t('orderDetail.phone'),
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
                  ? [{ label: t('orderDetail.email'), value: detail.data.recipientEmail }]
                  : []),
                {
                  label: t('orderDetail.address'),
                  value: (
                    <>
                      <span className="oo-sub oo-body">{detail.data.recipientAddressLine1}</span>
                      {detail.data.recipientAddressLine2 && (
                        <span className="oo-sub oo-body">{detail.data.recipientAddressLine2}</span>
                      )}
                      {detail.data.recipientLandmark && (
                        <span className="oo-sub">
                          {t('orderDetail.landmark')} {detail.data.recipientLandmark}
                        </span>
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
            <OoSection title={t('orderDetail.payment')}>
              <Facts
                items={[
                  { label: t('orderDetail.mode'), value: detail.data.paymentMode },
                  {
                    label: t('orderDetail.cod'),
                    value: <span className="sk-figure">{detail.data.codAmountInr ?? '—'}</span>,
                  },
                  {
                    label: t('orderDetail.declared'),
                    value: <span className="sk-figure">{detail.data.declaredValueInr ?? '—'}</span>,
                  },
                ]}
              />
            </OoSection>
            <OoSection title={t('orderDetail.physical')}>
              <Facts
                items={[
                  {
                    label: t('orderDetail.weight'),
                    value: <span className="sk-figure">{detail.data.totalWeightGrams ?? '—'}</span>,
                  },
                  { label: t('orderDetail.package'), value: detail.data.packageType },
                  {
                    label: t('orderDetail.flags'),
                    value:
                      detail.data.isUrgent || detail.data.isHighRisk ? (
                        <span className="oo-row">
                          {detail.data.isUrgent && (
                            <span className="oc-flag" data-tone="warn">
                              {t('orderDetail.urgent')}
                            </span>
                          )}
                          {detail.data.isHighRisk && (
                            <span className="oc-flag" data-tone="bad">
                              {t('orderDetail.highRisk')}
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

          <OoSection title={t('orderDetail.items', { count: detail.data.items.length })} flush>
            <Table caption={t('orderDetail.itemsCaption')}>
              <THead>
                <Tr>
                  <Th>{t('orderDetail.col.sku')}</Th>
                  <Th>{t('orderDetail.col.product')}</Th>
                  <Th align="right">{t('orderDetail.col.qty')}</Th>
                  <Th align="right">{t('orderDetail.col.reserved')}</Th>
                  <Th align="right">{t('orderDetail.col.weight')}</Th>
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
            <OoSection title={t('orderDetail.notes')}>
              {detail.data.sellerNotes && (
                <NoteBlock label={t('orderDetail.note.client')}>
                  {detail.data.sellerNotes}
                </NoteBlock>
              )}
              {detail.data.callNotes && (
                <NoteBlock label={t('orderDetail.note.call')}>{detail.data.callNotes}</NoteBlock>
              )}
              {detail.data.internalNotes && (
                <NoteBlock label={t('orderDetail.note.internal')}>
                  {detail.data.internalNotes}
                </NoteBlock>
              )}
            </OoSection>
          )}

          <section className="oo-section">
            <SectionHeading title={t('orderDetail.charges')} />
            <OrderChargesSection orderId={orderId} orderNumber={detail.data.orderNumber} />
          </section>

          <section className="oo-section">
            <SectionHeading title={t('orderDetail.shipments')} />
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
            <SectionHeading title={t('orderDetail.actions')} />
            <OrderActionsPanel order={detail.data} />
          </section>

          <div className="oc-footnote sk-figure">
            {t('orderDetail.placed')}{' '}
            {new Date(detail.data.placedAt).toISOString().replace('T', ' ').slice(0, 16)} ·{' '}
            {t('orderDetail.updated')}{' '}
            {new Date(detail.data.updatedAt).toISOString().replace('T', ' ').slice(0, 16)}
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
function milestoneSteps(
  milestones: readonly JourneyMilestoneView[],
  t: Translate<MessageKey>,
): TimelineStep[] {
  return milestones.map((m) => {
    const owner = journeyOwnerLabel(m.owner);
    const description: ReactNode = (
      <>
        <span>{owner}</span>
        {m.state === 'SKIPPED' && <span>{t('orderDetail.notNeeded')}</span>}
        {m.detail !== null && <span className="oo-sub">{m.detail}</span>}
      </>
    );
    return {
      id: m.key,
      label: m.label,
      state: STEP_STATE[m.state],
      description,
      ...(m.at === null
        ? {}
        : { time: m.estimated ? t('orderDetail.estimated', { date: fmtDate(m.at) }) : fmt(m.at) }),
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
  const t = useT();
  const locale = useLocale();
  // The latest parcel, as the shared panels chose it.
  const parcel = parcels[parcels.length - 1] ?? null;
  return (
    <div className="oo-stack">
      <div className={parcel === null ? 'oo-stack' : 'oo-split'}>
        <OoSection title={t('orderDetail.tracker')}>
          <Timeline
            label={t('orderDetail.tracker')}
            steps={milestoneSteps(milestones, t)}
            header={{
              icon: <Route size={16} />,
              title: t('orderDetail.trackerOrder'),
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
        </OoSection>
        {parcel !== null && (
          <OoSection title={t('orderDetail.parcel')}>
            <ParcelFacts parcel={parcel} />
          </OoSection>
        )}
      </div>
      <OoSection title={t('orderDetail.fullHistory')}>
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
  const t = useT();
  const journey = useOrderJourney(orderId);
  if (journey.isPending)
    return <SkeletonRows rows={4} cols={1} label={t('orderDetail.journeyLoading')} />;
  if (journey.isError || journey.data === undefined) {
    return (
      <OoSection title={t('orderDetail.tracker')}>
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
