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
  ConsignmentStatus,
  EarlyReservationReviewStatus,
  InboundFreightStatus,
  OrderStatus,
  ShipmentStatus,
  StockUnitStatus,
  TicketStatus,
  WithdrawalRequestStatus,
  InviteLeadStatus,
  WalletEntryDirection,
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
 * Two-leg consignment (BD → India) → kind.
 *
 * AT_BD is 'confirmed', not 'delivered': the goods are counted and safe,
 * but they are in the wrong country to sell from — reading them the same
 * green as arrived-in-India is the one confusion this screen exists to
 * prevent. IN_TRANSIT is deliberately the same 'in-transit' amber as a
 * parcel in a van, because it is the same fact.
 */
export function consignmentStatusKind(status: ConsignmentStatus): StatusKind {
  switch (status) {
    case ConsignmentStatus.PENDING:
      return 'pending';
    case ConsignmentStatus.AT_BD:
      return 'confirmed';
    case ConsignmentStatus.IN_TRANSIT:
      return 'in-transit';
    case ConsignmentStatus.COMPLETED:
      return 'delivered';
    case ConsignmentStatus.CANCELLED:
      return 'cancelled';
    default: {
      const exhaustive: never = status;
      throw new Error(`Unhandled ConsignmentStatus: ${String(exhaustive)}`);
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
export function earlyReviewStatusKind(status: EarlyReservationReviewStatus): StatusKind {
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
    // Sent home with an abandoned consignment. 'cancelled' rather than
    // 'failed': nothing went wrong with the unit, the journey was called
    // off — and somebody knows exactly where it is, which is what
    // separates it from LOST.
    case StockUnitStatus.RETURNED_TO_SELLER:
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

/**
 * A beta invite request → kind.
 *
 * NEW is 'pending' rather than 'draft': somebody is waiting on a reply,
 * and a queue that renders unanswered leads the same grey as an
 * abandoned draft is a queue nobody feels urgency about.
 */
export function inviteLeadStatusKind(status: InviteLeadStatus): StatusKind {
  switch (status) {
    case InviteLeadStatus.NEW:
      return 'pending';
    case InviteLeadStatus.CONTACTED:
      return 'in-transit';
    case InviteLeadStatus.QUALIFIED:
      return 'confirmed';
    case InviteLeadStatus.CONVERTED:
      return 'delivered';
    case InviteLeadStatus.DECLINED:
      return 'cancelled';
    case InviteLeadStatus.SPAM:
      return 'failed';
    default: {
      const exhaustive: never = status;
      throw new Error(`Unhandled InviteLeadStatus: ${String(exhaustive)}`);
    }
  }
}

/**
 * Wallet ledger vocabulary — the label a seller or a member of staff
 * reads, and which way the money went.
 *
 * WAL-1 says every new `WalletEntryDirection` must be registered as a
 * credit or it is treated as a debit. That rule was carried by a
 * hand-maintained `Set` in the API and a second one copied into
 * apps/seller, and its failure mode is the reason both had to be
 * written down: an unregistered direction does not error, it silently
 * takes money from the seller instead of giving it.
 *
 * A Set cannot be checked by the compiler. An exhaustive switch can, so
 * this is one — a new direction fails to BUILD until somebody decides
 * which way it points. That is the same F2 discipline as the status
 * mappers above, applied to the one vocabulary where getting it wrong
 * is a wrong number rather than a wrong colour.
 *
 * apps/admin showed neither: the raw enum, and every figure in the same
 * colour, so a refund and a charge were indistinguishable on the screen
 * staff use to answer "why is my balance this".
 */
export function isWalletCredit(direction: WalletEntryDirection): boolean {
  switch (direction) {
    // Money genuinely arriving, or being handed back.
    case WalletEntryDirection.COD_COLLECTION:
    case WalletEntryDirection.REMITTANCE_FX:
    case WalletEntryDirection.ADJUSTMENT_CREDIT:
    case WalletEntryDirection.OPENING_BALANCE:
    case WalletEntryDirection.SCRAP_REFUND:
    case WalletEntryDirection.TOPUP:
    case WalletEntryDirection.ORDER_CHARGES_REFUND:
      return true;
    // Everything we charge for. REMITTANCE_OUT is money leaving to the
    // seller's bank, so it is a debit against the wallet even though
    // the seller receives it.
    case WalletEntryDirection.ORDER_CHARGES:
    case WalletEntryDirection.REMITTANCE_OUT:
    case WalletEntryDirection.ADJUSTMENT_DEBIT:
    case WalletEntryDirection.INBOUND_FREIGHT:
    case WalletEntryDirection.CUSTOMER_RETURN_FEE:
    case WalletEntryDirection.RTO_FEE:
    case WalletEntryDirection.INSTANT_PAY_FEE:
    case WalletEntryDirection.COD_COLLECTION_FEE:
    // Not a charge — tax held back from a COD collection, which WE
    // file. It leaves the wallet, so it is a debit, but it is a
    // LIABILITY rather than revenue and must never be summed with what
    // we actually charged (WAL-4).
    case WalletEntryDirection.GST_WITHHOLDING:
      return false;
    default: {
      const exhaustive: never = direction;
      throw new Error(`Unhandled WalletEntryDirection: ${String(exhaustive)}`);
    }
  }
}

/** The human label for a ledger row. Same words on both apps. */
export function walletDirectionLabel(direction: WalletEntryDirection): string {
  switch (direction) {
    case WalletEntryDirection.COD_COLLECTION:
      return 'COD collected';
    case WalletEntryDirection.ORDER_CHARGES:
      return 'Order charges';
    case WalletEntryDirection.REMITTANCE_OUT:
      return 'Remittance';
    case WalletEntryDirection.REMITTANCE_FX:
      return 'FX conversion';
    case WalletEntryDirection.ADJUSTMENT_CREDIT:
      return 'Adjustment (credit)';
    case WalletEntryDirection.ADJUSTMENT_DEBIT:
      return 'Adjustment (debit)';
    case WalletEntryDirection.OPENING_BALANCE:
      return 'Opening balance';
    // R7 — a damage/loss ticket settled in the seller's favour.
    case WalletEntryDirection.SCRAP_REFUND:
      return 'Damage settlement';
    // R3 — the BD→India inbound freight bill for a consignment.
    case WalletEntryDirection.INBOUND_FREIGHT:
      return 'Inbound freight';
    // The flat return fee, charged when a parcel physically comes back.
    case WalletEntryDirection.RTO_FEE:
      return 'Return fee';
    // A return the CUSTOMER asked for, priced as the second delivery it
    // is rather than as a failed first attempt — its own line so what
    // customer returns cost is separable from undeliverable parcels.
    case WalletEntryDirection.CUSTOMER_RETURN_FEE:
      return 'Customer return';
    // Money the seller wired in, verified against the bank.
    case WalletEntryDirection.TOPUP:
      return 'Wallet top-up';
    // What Instant Pay costs: credit at delivery rather than waiting
    // for the courier to settle.
    case WalletEntryDirection.INSTANT_PAY_FEE:
      return 'Instant Pay fee';
    // The base charge for handling COD, on both credit modes.
    case WalletEntryDirection.COD_COLLECTION_FEE:
      return 'COD collection fee';
    // The delivery fee given back on an order cancelled before it
    // shipped.
    case WalletEntryDirection.ORDER_CHARGES_REFUND:
      return 'Cancelled order refund';
    case WalletEntryDirection.GST_WITHHOLDING:
      return 'GST withheld';
    default: {
      const exhaustive: never = direction;
      throw new Error(`Unhandled WalletEntryDirection: ${String(exhaustive)}`);
    }
  }
}
