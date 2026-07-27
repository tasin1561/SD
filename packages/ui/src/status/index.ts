/**
 * Semantic status → kind mapping. The SINGLE SOURCE OF TRUTH for how
 * the UI buckets the 28-value OrderStatus + 16-value ShipmentStatus
 * vocabularies into 8 visual kinds (see `tokens.css` for the
 * mapping rationale).
 *
 * F2 discipline (mirrors NOTIF-4 / TRK-5 / CC-2):
 *   - Pure logic. No DOM access, no React, no runtime deps beyond
 *     the @skydrop/db enum re-exports.
 *   - The order/shipment-status mappers below are EXHAUSTIVE switches
 *     over every enum value — a future enum addition fails to compile
 *     until the author consciously assigns a kind. Drift in the enum
 *     vocabulary cannot silently break the UI status legend.
 *   - The kind list itself is a const tuple; every bucket has a token
 *     triple (bg/fg/ring) in tokens.css under the same kebab-case key.
 *
 * Consumers (apps/admin status badges, future apps/seller + apps/track
 * timelines) IMPORT the mapper, NEVER hardcode a kind per status code.
 * If a status renders the "wrong" color, you fix it HERE — one place,
 * every surface updates.
 */
import {
  EarlyReservationReviewStatus,
  InboundFreightStatus,
  OrderStatus,
  ShipmentStatus,
  StockUnitStatus,
  TicketStatus,
  WithdrawalRequestStatus,
} from '@skydrop/db';

export const STATUS_KINDS = [
  'draft',
  'pending',
  'confirmed',
  'in-transit',
  'delivered',
  'rto',
  'failed',
  'cancelled',
] as const;
export type StatusKind = (typeof STATUS_KINDS)[number];

/** The CSS-variable token triple a kind exposes. Components read these
 *  via `var(--status-{kind}-{slot})` — apps NEVER hardcode the hex. */
export interface StatusKindTokens {
  readonly kind: StatusKind;
  readonly bgVar: string;
  readonly fgVar: string;
  readonly ringVar: string;
}

export function kindTokens(kind: StatusKind): StatusKindTokens {
  return {
    kind,
    bgVar: `var(--status-${kind}-bg)`,
    fgVar: `var(--status-${kind}-fg)`,
    ringVar: `var(--status-${kind}-ring)`,
  };
}

/**
 * Map an OrderStatus to its visual kind. Exhaustive — a missing case
 * is a compile error (the `never` return below catches it). When a
 * new OrderStatus lands in schema.prisma, add it here CONSCIOUSLY.
 */
export function orderStatusKind(status: OrderStatus): StatusKind {
  switch (status) {
    case OrderStatus.DRAFT:
      return 'draft';

    case OrderStatus.PENDING_CONFIRMATION:
    case OrderStatus.CALL_NO_RESPONSE:
    case OrderStatus.CALL_RESCHEDULED:
    case OrderStatus.PENDING_PICK:
    case OrderStatus.PENDING_DISPATCH:
    case OrderStatus.PENDING_MANUAL_PLACEMENT:
      return 'pending';

    case OrderStatus.CONFIRMED:
    case OrderStatus.PICKED:
    case OrderStatus.PACKED:
      return 'confirmed';

    case OrderStatus.DISPATCHED:
    case OrderStatus.IN_TRANSIT:
    case OrderStatus.OUT_FOR_DELIVERY:
      return 'in-transit';

    case OrderStatus.DELIVERED:
      return 'delivered';

    case OrderStatus.RTO_INITIATED:
    case OrderStatus.RTO_IN_TRANSIT:
    case OrderStatus.RTO_RECEIVED:
    case OrderStatus.RTO_RESTOCKED:
      return 'rto';

    case OrderStatus.OUT_OF_STOCK:
    case OrderStatus.REJECTED:
    case OrderStatus.REJECTED_BY_CUSTOMER:
    case OrderStatus.REJECTED_NDR:
    case OrderStatus.PACK_FAILED:
    case OrderStatus.DELIVERY_FAILED:
    case OrderStatus.LOST_IN_TRANSIT:
    case OrderStatus.RTO_DAMAGED:
      return 'failed';

    case OrderStatus.CANCELLED:
    case OrderStatus.CANCELLED_BY_ADMIN:
      return 'cancelled';

    // R5b — a PAUSE waiting on the seller, not a failure. 'pending' is the
    // honest kind: the order is alive and needs someone to act.
    case OrderStatus.AWAITING_SELLER_DECISION:
      return 'pending';

    default: {
      const exhaustive: never = status;
      throw new Error(`Unhandled OrderStatus: ${String(exhaustive)}`);
    }
  }
}

/**
 * Map a ShipmentStatus to its visual kind. Same exhaustiveness
 * contract.
 */
export function shipmentStatusKind(status: ShipmentStatus): StatusKind {
  switch (status) {
    case ShipmentStatus.CREATED:
      return 'draft';

    case ShipmentStatus.AWB_PENDING:
      return 'pending';

    case ShipmentStatus.AWB_GENERATED:
    case ShipmentStatus.HANDED_TO_COURIER:
    case ShipmentStatus.AT_HUB:
      return 'confirmed';

    case ShipmentStatus.IN_TRANSIT:
    case ShipmentStatus.OUT_FOR_DELIVERY:
    case ShipmentStatus.DELIVERY_ATTEMPTED:
      return 'in-transit';

    case ShipmentStatus.DELIVERED:
      return 'delivered';

    case ShipmentStatus.RTO_INITIATED:
    case ShipmentStatus.RTO_IN_TRANSIT:
    case ShipmentStatus.RTO_DELIVERED:
      return 'rto';

    case ShipmentStatus.FAILED_AT_CREATION:
    case ShipmentStatus.LOST:
    case ShipmentStatus.DAMAGED:
      return 'failed';

    case ShipmentStatus.CANCELLED:
      return 'cancelled';

    default: {
      const exhaustive: never = status;
      throw new Error(`Unhandled ShipmentStatus: ${String(exhaustive)}`);
    }
  }
}

/**
 * R7 ticket lifecycle → kind.
 *
 * The three RESOLVED_* terminals deliberately do NOT share a colour:
 * a refund moved money, a return moved goods, a write-off moved
 * neither. An operator scanning the queue needs to see which without
 * reading the label.
 */
export function ticketStatusKind(status: TicketStatus): StatusKind {
  switch (status) {
    case TicketStatus.OPEN:
      return 'pending';
    case TicketStatus.NEGOTIATING:
      return 'in-transit';
    case TicketStatus.RESOLVED_REFUND:
      return 'delivered';
    case TicketStatus.RESOLVED_RETURNED:
      return 'rto';
    case TicketStatus.RESOLVED_WRITE_OFF_ACCEPTED:
      return 'cancelled';
    case TicketStatus.REJECTED:
      return 'failed';
    default: {
      const exhaustive: never = status;
      throw new Error(`Unhandled TicketStatus: ${String(exhaustive)}`);
    }
  }
}

/**
 * R3 inbound-freight bill → kind.
 *
 * WAIVED is `cancelled`, not `delivered` — money we chose not to
 * collect should never look like money we collected.
 */
export function inboundFreightStatusKind(status: InboundFreightStatus): StatusKind {
  switch (status) {
    case InboundFreightStatus.PENDING:
      return 'pending';
    case InboundFreightStatus.PARTIALLY_SETTLED:
      return 'in-transit';
    case InboundFreightStatus.SETTLED:
      return 'delivered';
    case InboundFreightStatus.WAIVED:
      return 'cancelled';
    default: {
      const exhaustive: never = status;
      throw new Error(`Unhandled InboundFreightStatus: ${String(exhaustive)}`);
    }
  }
}

/** R2 seller withdrawal request → kind. */
export function withdrawalStatusKind(status: WithdrawalRequestStatus): StatusKind {
  switch (status) {
    case WithdrawalRequestStatus.PENDING:
      return 'pending';
    case WithdrawalRequestStatus.APPROVED:
      return 'confirmed';
    case WithdrawalRequestStatus.PAID:
      return 'delivered';
    case WithdrawalRequestStatus.REJECTED:
      return 'failed';
    default: {
      const exhaustive: never = status;
      throw new Error(`Unhandled WithdrawalRequestStatus: ${String(exhaustive)}`);
    }
  }
}

/** R5 early-reservation review → kind. */
export function earlyReviewStatusKind(
  status: EarlyReservationReviewStatus,
): StatusKind {
  switch (status) {
    case EarlyReservationReviewStatus.OPEN:
      return 'pending';
    case EarlyReservationReviewStatus.SELLER_RELEASED:
      return 'cancelled';
    case EarlyReservationReviewStatus.SELLER_REQUESTED_MORE_ATTEMPTS:
      return 'in-transit';
    case EarlyReservationReviewStatus.AUTO_RELEASED:
      return 'cancelled';
    default: {
      const exhaustive: never = status;
      throw new Error(`Unhandled EarlyReservationReviewStatus: ${String(exhaustive)}`);
    }
  }
}

/** R4 serialized unit → kind. */
export function stockUnitStatusKind(status: StockUnitStatus): StatusKind {
  switch (status) {
    case StockUnitStatus.IN_STOCK:
      return 'confirmed';
    case StockUnitStatus.PICKED:
    case StockUnitStatus.PACKED:
      return 'pending';
    case StockUnitStatus.DISPATCHED:
      return 'in-transit';
    case StockUnitStatus.RTO_RECEIVED:
      return 'rto';
    case StockUnitStatus.WRITTEN_OFF:
      return 'cancelled';
    case StockUnitStatus.LOST:
      return 'failed';
    default: {
      const exhaustive: never = status;
      throw new Error(`Unhandled StockUnitStatus: ${String(exhaustive)}`);
    }
  }
}

/**
 * Short human label for a status. Defaults to the enum name with
 * underscores → spaces + title case; overrides for the few statuses
 * where the enum name reads awkwardly. UI calls this when it needs
 * a one-line display string; for richer copy the consumer composes
 * its own (we don't ship i18n in M12 — that's M16/i18n package).
 */
export function statusLabel(
  status:
    | OrderStatus
    | ShipmentStatus
    | TicketStatus
    | InboundFreightStatus
    | WithdrawalRequestStatus
    | EarlyReservationReviewStatus
    | StockUnitStatus,
): string {
  return String(status)
    .toLowerCase()
    .split('_')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ');
}
