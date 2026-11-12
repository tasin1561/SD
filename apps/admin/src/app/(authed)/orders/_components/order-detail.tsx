'use client';

import { Truck, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import type { OrderView } from '@skydrop/api-client';
import { useT } from '@/i18n/client';
import { useAdminOrderShipments, useOrderDetail } from '@/lib/api-hooks';
import { useOrderAddressCheck } from '@/lib/address-check-hooks';
import { useConsignee, useOrderJourney } from '@/lib/ops-hooks';
import { usePermission } from '@/lib/use-permission';
import { serverVerdict } from '@/lib/server-verdict';
import { ErrorState } from '@skydrop/ui/app/empty-state';
import { Skeleton, SkeletonRows } from '@skydrop/ui/app/skeleton';
import { ActivityCard } from './activity-card';
import { DetailCard } from './detail-card';
import { ItemsChargesCard } from './items-charges-card';
import { useOrderActions } from './order-actions-panel';
import { useOrderChargesPanel } from './order-charges';
import { useOrderDetailUi } from './order-detail-ui-state';
import { OrderHeader, type HeaderPrimary } from './order-header';
import { buildMoreEntries } from './order-more-menu';
import {
  OrderShipmentsSection,
  courierActionsAvailable,
  useShipmentDialogState,
} from './order-shipments-section';
import { OrderStepper } from './order-stepper';
import { RecipientCard } from './recipient-card';
import { ResellerMoneyPanel } from './reseller-money-panel';
import { ResellerOrderPanel } from './reseller-order-panel';
import { StuckOrderRecovery } from './stuck-order-recovery';
import './order-core.css';
import './order-detail.css';

/**
 * Order detail — a dense, two-column working page.
 *
 *   sticky header   number, status, AWB, the facts, and the actions (More)
 *   stepper         where the parcel is
 *   main            Recipient & address · Items & charges · member-store
 *                   panels · Activity
 *   sidebar         Shipment · Payment & package · Notes
 *
 * Single fetch of the order (admin /orders/:id) plus the same reads the old
 * page made — shipments, journey, consignee, address check, charges, parcel
 * activity. Nothing is fetched that was not before, and every action is the
 * same dialog with the same gating; only where it lives changed.
 */
export function OrderDetailView({ orderId }: { orderId: string }): ReactElement {
  const t = useT();
  const detail = useOrderDetail(orderId);

  if (detail.isLoading) {
    return (
      <div className="od-page">
        <div className="oo-stack" aria-busy="true">
          <Skeleton height={36} width="40%" />
          <SkeletonRows rows={6} cols={2} label={t('orderDetail.loading')} />
        </div>
      </div>
    );
  }
  if (detail.isError) {
    return (
      <div className="od-page">
        <ErrorState
          message={detail.error?.message ?? t('orderDetail.loadFailed')}
          retry={() => void detail.refetch()}
        />
      </div>
    );
  }
  if (!detail.data) {
    return (
      <div className="od-page">
        <ErrorState message={t('orderDetail.notFound')} />
      </div>
    );
  }
  return <OrderDetailBody order={detail.data} />;
}

function scrollToId(id: string): void {
  window.requestAnimationFrame(() => {
    const el = document.getElementById(id);
    if (el === null) return;
    const reduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' });
  });
}

function OrderDetailBody({ order }: { readonly order: OrderView }): ReactElement {
  const t = useT();
  const orderId = order.id;
  // Same query the shipments card runs, so React Query serves both from one
  // request rather than asking twice.
  const shipments = useAdminOrderShipments(orderId);
  const journey = useOrderJourney(orderId);
  const consignee = useConsignee(orderId);
  const addressCheck = useOrderAddressCheck(orderId);
  const canWriteCourier = usePermission('courier.ops.write');
  const canCost = usePermission('money.treasury.manage');
  const actions = useOrderActions(order);
  const charges = useOrderChargesPanel(orderId, order.orderNumber);
  const dialogs = useShipmentDialogState();
  const ui = useOrderDetailUi();
  const side = useRef<HTMLElement>(null);
  const [stickySide, setStickySide] = useState(false);
  const [editing, setEditing] = useState(false);
  const [notesOpen, setNotesOpen] = useState(true);

  const rows = shipments.data ?? [];
  const awbs = orderAwbs(rows);
  const target = rows[rows.length - 1] ?? null;
  const check = addressCheck.data ?? null;
  // "Edit" exists only when the form does: the courier still allows the
  // change AND this person may make it.
  const editAvailable = canWriteCourier && consignee.data?.editable === true;
  const eta =
    journey.data?.milestones.find((m) => m.estimated && m.at !== null)?.at ??
    journey.data?.parcels[journey.data.parcels.length - 1]?.expectedDeliveryAt ??
    order.expectedDeliveryAt;

  // The sidebar sticks only when ALL of it fits under the header — a
  // sticky column taller than the viewport would hide its own bottom.
  useEffect(() => {
    const el = side.current;
    if (el === null) return undefined;
    const measure = (): void => {
      const reserved = 56 + 52 + 12 + 16; // top bar + header + gaps
      setStickySide(el.offsetHeight + reserved <= window.innerHeight);
    };
    measure();
    window.addEventListener('resize', measure);
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    ro?.observe(el);
    return () => {
      window.removeEventListener('resize', measure);
      ro?.disconnect();
    };
  }, []);

  function fixAddress(): void {
    ui.setOpen('recipient', true);
    setEditing(true);
    scrollToId('od-recipient');
  }
  function openCourier(id: string): void {
    ui.setOpen('shipment', true);
    dialogs.setCourierFor(id);
    scrollToId(`od-ship-${id}`);
  }

  // Display-only: which one contextual button the header offers. No new
  // rule — it reads what the cards below already know.
  const liveCourier = [...rows].reverse().find(courierActionsAvailable) ?? null;
  const primary: HeaderPrimary | null =
    check !== null && check.issues.length > 0 && editAvailable
      ? {
          label: t('orderDetail.action.fixAddress'),
          icon: <TriangleAlert size={14} />,
          onClick: fixAddress,
        }
      : liveCourier !== null
        ? {
            label: t('ordersCourierOpsPanel.courierActionsCosts'),
            icon: <Truck size={14} />,
            onClick: () => openCourier(liveCourier.id),
          }
        : null;

  const entries = buildMoreEntries({
    t,
    orderStatus: order.status,
    canOverride: actions.canOverride,
    canCancel: actions.canCancel,
    inTerminalState: actions.inTerminalState,
    cancelPending: actions.cancelPending,
    canRequestReturn: actions.canRequestReturn,
    canRecordScan: target !== null,
    canRecordCost: target !== null && canCost,
    canCompute:
      charges.canView &&
      charges.canCompute &&
      !charges.charges.isLoading &&
      !charges.charges.isError,
    open: {
      cancel: actions.open.cancel,
      override: actions.open.override,
      release: actions.open.release,
      restore: actions.open.restore,
      requestReturn: actions.open.requestReturn,
      recordScan: () => {
        if (target !== null) dialogs.setScanFor(target.id);
      },
      recordCost: () => {
        if (target !== null) dialogs.setCostFor(target.id);
      },
      compute: charges.openCompute,
    },
  });

  return (
    <div className="od-page">
      <OrderHeader order={order} awbs={awbs} eta={eta} primary={primary} entries={entries} />

      {actions.results}

      <section className="od-stepper-wrap" aria-label={t('orderDetail.tracker')}>
        {journey.isPending ? (
          <Skeleton height={40} />
        ) : journey.isError || journey.data === undefined ? (
          <ErrorState message={serverVerdict(journey.error)} retry={() => void journey.refetch()} />
        ) : (
          <OrderStepper milestones={journey.data.milestones} />
        )}
      </section>

      <div className="od-grid">
        <div className="od-main">
          <div className="od-slot" data-slot="recipient">
            <RecipientCard
              order={order}
              check={check}
              consignee={consignee.data}
              editAvailable={editAvailable}
              editing={editing}
              onEditingChange={setEditing}
              open={ui.state.open.recipient}
              onOpenChange={(o) => ui.setOpen('recipient', o)}
              parsedOpen={ui.state.open.parsed}
              onParsedOpenChange={(o) => ui.setOpen('parsed', o)}
            />
          </div>

          <div className="od-slot" data-slot="items">
            <ItemsChargesCard
              order={order}
              panel={charges}
              open={ui.state.open.items}
              onOpenChange={(o) => ui.setOpen('items', o)}
            />
          </div>

          {/* RS-5 — a reseller store's order: the store and the terms
              snapshot it was placed under. Nothing for a channel order. */}
          <div className="od-slot" data-slot="reseller">
            <ResellerOrderPanel order={order} />
            {/* RS-6 phase 3c — the full split: both parties, both wallets. */}
            <ResellerMoneyPanel orderId={orderId} enabled={order.storeKind === 'RESELLER'} />
          </div>

          <div className="od-slot" data-slot="activity">
            <ActivityCard
              orderId={orderId}
              milestones={journey.data?.milestones ?? []}
              entries={journey.data?.timeline ?? []}
              journeyPending={journey.isPending}
              journeyError={journey.isError ? serverVerdict(journey.error) : null}
              onRetryJourney={() => void journey.refetch()}
              open={ui.state.open.activity}
              onOpenChange={(o) => ui.setOpen('activity', o)}
              filter={ui.state.filter}
              onFilterChange={ui.setFilter}
            />
          </div>
        </div>

        <aside className="od-side" ref={side} data-sticky={stickySide ? '1' : undefined}>
          <div className="od-slot" data-slot="shipment">
            {/* Renders nothing unless the order is actually stuck. */}
            <StuckOrderRecovery
              orderId={orderId}
              orderStatus={order.status}
              orderNumber={order.orderNumber}
            />
            <OrderShipmentsSection
              orderId={orderId}
              orderStatus={order.status}
              parcels={journey.data?.parcels ?? []}
              open={ui.state.open.shipment}
              onOpenChange={(o) => ui.setOpen('shipment', o)}
              dialogState={dialogs}
            />
          </div>

          <div className="od-slot" data-slot="payment">
            <DetailCard
              id="od-payment"
              title={t('orderDetail.card.paymentPackage')}
              titleText={t('orderDetail.card.paymentPackage')}
              open={ui.state.open.payment}
              onOpenChange={(o) => ui.setOpen('payment', o)}
            >
              <PaymentPackage order={order} />
            </DetailCard>
            {(order.sellerNotes || order.internalNotes || order.callNotes) && (
              <DetailCard
                id="od-notes"
                title={t('orderDetail.notes')}
                titleText={t('orderDetail.notes')}
                open={notesOpen}
                onOpenChange={setNotesOpen}
              >
                {order.sellerNotes && (
                  <NoteBlock label={t('orderDetail.note.client')}>{order.sellerNotes}</NoteBlock>
                )}
                {order.callNotes && (
                  <NoteBlock label={t('orderDetail.note.call')}>{order.callNotes}</NoteBlock>
                )}
                {order.internalNotes && (
                  <NoteBlock label={t('orderDetail.note.internal')}>
                    {order.internalNotes}
                  </NoteBlock>
                )}
              </DetailCard>
            )}
          </div>
        </aside>
      </div>

      {actions.dialogs}
    </div>
  );
}

function PaymentPackage({ order }: { readonly order: OrderView }): ReactElement {
  const t = useT();
  const rows: ReadonlyArray<{
    readonly key: string;
    readonly label: string;
    readonly value: ReactNode;
  }> = [
    { key: 'mode', label: t('orderDetail.mode'), value: order.paymentMode },
    {
      key: 'cod',
      label: t('orderDetail.cod'),
      value: <span className="sk-figure">{order.codAmountInr ?? '—'}</span>,
    },
    {
      key: 'declared',
      label: t('orderDetail.declared'),
      value: <span className="sk-figure">{order.declaredValueInr ?? '—'}</span>,
    },
    {
      key: 'weight',
      label: t('orderDetail.weight'),
      value: <span className="sk-figure">{order.totalWeightGrams ?? '—'}</span>,
    },
    { key: 'package', label: t('orderDetail.package'), value: order.packageType },
    {
      key: 'flags',
      label: t('orderDetail.flags'),
      value:
        order.isUrgent || order.isHighRisk ? (
          <span className="oo-row">
            {order.isUrgent && (
              <span className="oc-flag" data-tone="warn">
                {t('orderDetail.urgent')}
              </span>
            )}
            {order.isHighRisk && (
              <span className="oc-flag" data-tone="bad">
                {t('orderDetail.highRisk')}
              </span>
            )}
          </span>
        ) : (
          <span className="oo-muted">—</span>
        ),
    },
  ];
  return (
    <dl className="od-dl">
      {rows.map((r) => (
        <div key={r.key} className="od-dl__row">
          <dt>{r.label}</dt>
          <dd>{r.value}</dd>
        </div>
      ))}
    </dl>
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

/**
 * Every AWB an order carries, each once, in the order the shipments come.
 *
 * A split order has more than one parcel and so more than one AWB, and a
 * reissue can repeat one, so this de-duplicates rather than taking the
 * first. A shipment not booked yet has no AWB and contributes nothing —
 * never an empty entry, which would print "AWB:" with nothing after it.
 */
export function orderAwbs(
  shipments: ReadonlyArray<{ readonly awbNumber?: string | null }>,
): string[] {
  return [
    ...new Set(
      shipments
        .map((s) => s.awbNumber)
        .filter((a): a is string => typeof a === 'string' && a.trim() !== ''),
    ),
  ];
}
