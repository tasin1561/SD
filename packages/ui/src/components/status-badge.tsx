import type {
  BulkUploadStatus,
  DeliveryActionStatus,
  EarlyReservationReviewStatus,
  InboundFreightStatus,
  OrderStatus,
  ResellerStoreStatus,
  ShipmentStatus,
  StockUnitStatus,
  StoreAddressChangeStatus,
  TicketStatus,
  TopupRequestStatus,
  WithdrawalRequestStatus,
} from '@skydrop/db';
import {
  deliveryActionStatusKind,
  deliveryActionStatusLabel,
  earlyReviewStatusKind,
  inboundFreightStatusKind,
  kindTokens,
  orderStatusKind,
  resellerStoreStatusKind,
  resellerStoreStatusLabel,
  shipmentStatusKind,
  statusLabel,
  withdrawalStatusLabel,
  stockUnitStatusKind,
  storeAddressChangeStatusKind,
  storeAddressChangeStatusLabel,
  ticketStatusKind,
  ticketStatusLabel,
  topupStatusKind,
  uploadStatusKind,
  uploadStatusLabel,
  topupStatusLabel,
  withdrawalStatusKind,
  type StatusKind,
} from '@skydrop/ui/status';
import type { ReactElement } from 'react';

/**
 * The canonical status pill. Reads ONLY from @skydrop/ui/status — the
 * single source of truth for the 8 semantic kinds + their CSS-variable
 * triples. NEVER hardcode a color here; if a status renders the wrong
 * color, the fix lives in @skydrop/ui/src/status/index.ts.
 *
 * Three convenience constructors so the consumer doesn't have to call
 * the mapper inline:
 *   - <OrderStatusBadge status={order.status} />
 *   - <ShipmentStatusBadge status={shipment.status} />
 *   - <StatusBadge kind="..." label="..." />  (for raw kinds, e.g.,
 *     a seller status mapped manually)
 *
 * Extraction-ready: when apps/seller forces the packages/ui
 * extraction, this component lifts unchanged — it has NO admin-app
 * dependencies (no `@/...` imports).
 */

interface StatusBadgeProps {
  readonly kind: StatusKind;
  readonly label: string;
  readonly variant?: 'soft' | 'solid';
}

export function StatusBadge({ kind, label, variant = 'soft' }: StatusBadgeProps): ReactElement {
  const tokens = kindTokens(kind);
  const baseStyle =
    variant === 'soft'
      ? { background: tokens.bgVar, color: tokens.fgVar }
      : { background: tokens.fgVar, color: 'var(--color-bg)' };
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded-[3px] text-xs font-medium tracking-wide uppercase whitespace-nowrap"
      style={baseStyle}
      data-status-kind={kind}
    >
      {label}
    </span>
  );
}

export function OrderStatusBadge({ status }: { status: OrderStatus }): ReactElement {
  return <StatusBadge kind={orderStatusKind(status)} label={statusLabel(status)} />;
}

export function ShipmentStatusBadge({ status }: { status: ShipmentStatus }): ReactElement {
  return <StatusBadge kind={shipmentStatusKind(status)} label={statusLabel(status)} />;
}

/** Seller status maps to our kinds manually — sellers have their own
 *  PENDING/APPROVED/REJECTED/SUSPENDED vocabulary, not OrderStatus. */
export function SellerStatusBadge({
  status,
}: {
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';
}): ReactElement {
  const kind: StatusKind =
    status === 'APPROVED'
      ? 'delivered' // green — active/healthy
      : status === 'PENDING'
        ? 'pending' // amber — waiting
        : status === 'SUSPENDED'
          ? 'rto' // orange — needs attention but not failed
          : 'failed'; // REJECTED — red
  return <StatusBadge kind={kind} label={status.toLowerCase()} />;
}

/** RS-1 reseller store — the same words on the seller, admin and reseller screens. */
export function ResellerStoreStatusBadge({
  status,
}: {
  readonly status: ResellerStoreStatus;
}): ReactElement {
  return (
    <StatusBadge kind={resellerStoreStatusKind(status)} label={resellerStoreStatusLabel(status)} />
  );
}

/** R7 scrap/damage + seller-issue ticket. */
export function TicketStatusBadge({ status }: { readonly status: TicketStatus }): ReactElement {
  return <StatusBadge kind={ticketStatusKind(status)} label={ticketStatusLabel(status)} />;
}

/** 2026-09-16 — what became of something a reseller store asked for. */
export function DeliveryActionStatusBadge({
  status,
}: {
  readonly status: DeliveryActionStatus;
}): ReactElement {
  return (
    <StatusBadge
      kind={deliveryActionStatusKind(status)}
      label={deliveryActionStatusLabel(status)}
    />
  );
}

/** 2026-09-16 — what became of a reseller store's address correction. */
export function StoreAddressChangeStatusBadge({
  status,
}: {
  readonly status: StoreAddressChangeStatus;
}): ReactElement {
  return (
    <StatusBadge
      kind={storeAddressChangeStatusKind(status)}
      label={storeAddressChangeStatusLabel(status)}
    />
  );
}

/** R3 inbound (BD→India) freight bill. */
export function FreightStatusBadge({
  status,
}: {
  readonly status: InboundFreightStatus;
}): ReactElement {
  return <StatusBadge kind={inboundFreightStatusKind(status)} label={statusLabel(status)} />;
}

/** R2 seller withdrawal request. */
export function WithdrawalStatusBadge({
  status,
  audience = 'staff',
}: {
  readonly status: WithdrawalRequestStatus;
  /** Sellers read a different vocabulary — see `withdrawalStatusLabel`. */
  readonly audience?: 'staff' | 'seller';
}): ReactElement {
  return (
    <StatusBadge
      kind={withdrawalStatusKind(status)}
      label={withdrawalStatusLabel(status, audience)}
    />
  );
}

/** WAL-2 / RS-6 top-up claim. */
export function TopupStatusBadge({
  status,
  audience = 'staff',
}: {
  readonly status: TopupRequestStatus;
  /** The payer reads a different vocabulary — see `topupStatusLabel`. */
  readonly audience?: 'staff' | 'payer';
}): ReactElement {
  return <StatusBadge kind={topupStatusKind(status)} label={topupStatusLabel(status, audience)} />;
}

/** ORD-9 CSV upload (orders, products). */
export function UploadStatusBadge({ status }: { readonly status: BulkUploadStatus }): ReactElement {
  return <StatusBadge kind={uploadStatusKind(status)} label={uploadStatusLabel(status)} />;
}

/** R5 early-reservation (at-placement hold) review. */
export function EarlyReviewStatusBadge({
  status,
}: {
  readonly status: EarlyReservationReviewStatus;
}): ReactElement {
  return <StatusBadge kind={earlyReviewStatusKind(status)} label={statusLabel(status)} />;
}

/** R4 serialized stock unit. */
export function StockUnitStatusBadge({
  status,
}: {
  readonly status: StockUnitStatus;
}): ReactElement {
  return <StatusBadge kind={stockUnitStatusKind(status)} label={statusLabel(status)} />;
}
