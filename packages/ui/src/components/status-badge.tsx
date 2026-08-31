import type {
  EarlyReservationReviewStatus,
  InboundFreightStatus,
  OrderStatus,
  ShipmentStatus,
  StockUnitStatus,
  TicketStatus,
  WithdrawalRequestStatus,
} from '@skydrop/db';
import {
  earlyReviewStatusKind,
  inboundFreightStatusKind,
  kindTokens,
  orderStatusKind,
  shipmentStatusKind,
  statusLabel,
  withdrawalStatusLabel,
  stockUnitStatusKind,
  ticketStatusKind,
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

/** R7 scrap/damage + seller-issue ticket. */
export function TicketStatusBadge({ status }: { readonly status: TicketStatus }): ReactElement {
  return <StatusBadge kind={ticketStatusKind(status)} label={statusLabel(status)} />;
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
