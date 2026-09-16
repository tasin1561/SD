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
  BulkUploadStatus,
  ConsignmentStatus,
  EarlyReservationReviewStatus,
  InboundFreightStatus,
  OrderStatus,
  ShipmentStatus,
  StockUnitStatus,
  TicketStatus,
  TopupRequestStatus,
  WithdrawalRequestStatus,
  LabelReprintRequestStatus,
  InviteLeadStatus,
  WalletEntryDirection,
  ResellerStoreStatus,
  ResellerCreditStatus,
  StoreWalletEntryDirection,
  DeliveryActionStatus,
  StoreAddressChangeStatus,
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

    // Same shape: a PAUSE waiting on an admin to pick the courier, not a
    // failure. The parcel is confirmed, its stock is held, and it moves
    // the moment somebody chooses — or the TTL chooses for them.
    case OrderStatus.AWAITING_COURIER:
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
/**
 * A ticket status, in the three words the screens speak in.
 *
 * The generic `statusLabel` prettifies an enum name, which produced
 * "Resolved Write Off Accepted" — the database's word for it, on a page
 * where the question is only ever open, being looked at, or finished.
 *
 * The four CLOSED statuses stay DISTINGUISHABLE after the "Closed",
 * because they are not interchangeable: one of them paid the seller and
 * one of them refused them, and a badge that flattened those into the
 * same word would hide the outcome on the page where it matters most.
 * So: "Closed" first — the thing being asked — then which kind.
 *
 * F2-exhaustive: a new TicketStatus fails to compile until somebody
 * decides how it reads.
 */
export function ticketStatusLabel(status: TicketStatus): string {
  switch (status) {
    case TicketStatus.OPEN:
      return 'Open';
    case TicketStatus.NEGOTIATING:
      return 'Reviewing';
    case TicketStatus.RESOLVED_REFUND:
      return 'Closed · refunded';
    case TicketStatus.RESOLVED_RETURNED:
      return 'Closed · goods back';
    case TicketStatus.RESOLVED_WRITE_OFF_ACCEPTED:
      return 'Closed · write-off';
    case TicketStatus.REJECTED:
      return 'Closed · not upheld';
    // Says only what happened. The courier finished; we decided nothing,
    // and the seller can reopen it if they disagree with how it was left.
    case TicketStatus.CLOSED_BY_COURIER:
      return 'Closed · by the courier';
    default: {
      const exhaustive: never = status;
      throw new Error(`Unhandled TicketStatus: ${String(exhaustive)}`);
    }
  }
}

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
    // Neutral on purpose: 'delivered' green would read as a win and
    // 'failed' red as a refusal, and it is neither.
    case TicketStatus.CLOSED_BY_COURIER:
      return 'cancelled';
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
/**
 * LBL-5b — a label reprint request. `EXPIRED` is an approval more than 24
 * hours old; the API derives it, so it is not a database value.
 */
export function labelReprintStateKind(state: LabelReprintRequestStatus | 'EXPIRED'): StatusKind {
  switch (state) {
    case LabelReprintRequestStatus.PENDING:
      return 'pending';
    case LabelReprintRequestStatus.APPROVED:
      return 'confirmed';
    case LabelReprintRequestStatus.PRINTED:
      return 'delivered';
    case LabelReprintRequestStatus.REJECTED:
      return 'failed';
    case 'EXPIRED':
      return 'cancelled';
    default: {
      const exhaustive: never = state;
      throw new Error(`Unhandled label reprint state: ${String(exhaustive)}`);
    }
  }
}

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

/** WAL-2 / RS-6 top-up claim (seller or reseller store) → kind. */
export function topupStatusKind(status: TopupRequestStatus): StatusKind {
  switch (status) {
    case TopupRequestStatus.PENDING:
      return 'pending';
    case TopupRequestStatus.ACCEPTED:
      return 'delivered';
    case TopupRequestStatus.REJECTED:
      return 'failed';
    default: {
      const exhaustive: never = status;
      throw new Error(`Unhandled TopupRequestStatus: ${String(exhaustive)}`);
    }
  }
}

/**
 * A CSV upload (orders, products) → kind + words. ORD-9: an import that
 * finished with error rows is NOT a failure — the good rows are orders —
 * so it reads as its own thing rather than green or red.
 */
export function uploadStatusKind(status: BulkUploadStatus): StatusKind {
  switch (status) {
    case BulkUploadStatus.PENDING:
      return 'pending';
    case BulkUploadStatus.PROCESSING:
      return 'in-transit';
    case BulkUploadStatus.COMPLETED:
      return 'delivered';
    case BulkUploadStatus.COMPLETED_WITH_ERRORS:
      return 'rto';
    case BulkUploadStatus.FAILED:
      return 'failed';
    case BulkUploadStatus.CANCELLED:
      return 'cancelled';
    default: {
      const exhaustive: never = status;
      throw new Error(`Unhandled BulkUploadStatus: ${String(exhaustive)}`);
    }
  }
}

export function uploadStatusLabel(status: BulkUploadStatus): string {
  switch (status) {
    case BulkUploadStatus.PENDING:
      return 'Waiting';
    case BulkUploadStatus.PROCESSING:
      return 'Importing';
    case BulkUploadStatus.COMPLETED:
      return 'Done';
    case BulkUploadStatus.COMPLETED_WITH_ERRORS:
      return 'Done, some rows failed';
    case BulkUploadStatus.FAILED:
      return 'Failed';
    case BulkUploadStatus.CANCELLED:
      return 'Cancelled';
    default: {
      const exhaustive: never = status;
      throw new Error(`Unhandled BulkUploadStatus: ${String(exhaustive)}`);
    }
  }
}

/**
 * A top-up claim, in the words of whoever reads it. Staff work a queue
 * ("is it on the statement yet"); the payer is asking whether their
 * money is in the wallet.
 */
export function topupStatusLabel(
  status: TopupRequestStatus,
  audience: 'staff' | 'payer' = 'staff',
): string {
  switch (status) {
    case TopupRequestStatus.PENDING:
      return audience === 'payer' ? 'Waiting for Skydrop to see it' : 'Waiting for review';
    case TopupRequestStatus.ACCEPTED:
      return 'Credited';
    case TopupRequestStatus.REJECTED:
      return audience === 'payer' ? 'Not credited' : 'Rejected';
    default: {
      const exhaustive: never = status;
      throw new Error(`Unhandled TopupRequestStatus: ${String(exhaustive)}`);
    }
  }
}

/**
 * RS-1 reseller store → kind. Read by apps/seller, apps/admin and
 * apps/reseller alike; a new status fails to compile until it is placed.
 */
export function resellerStoreStatusKind(status: ResellerStoreStatus): StatusKind {
  switch (status) {
    case ResellerStoreStatus.PENDING_SELLER_APPROVAL:
      return 'pending';
    case ResellerStoreStatus.ACTIVE:
      return 'delivered';
    case ResellerStoreStatus.PAUSED:
      return 'rto';
    case ResellerStoreStatus.CLOSED:
      return 'cancelled';
    case ResellerStoreStatus.REJECTED:
      return 'failed';
    default: {
      const exhaustive: never = status;
      throw new Error(`Unhandled ResellerStoreStatus: ${String(exhaustive)}`);
    }
  }
}

/** The words a person reads for each reseller store status. */
/**
 * What became of something a reseller store asked for on a live order
 * (2026-09-16) — a call to its customer, another delivery attempt, or
 * the parcel back.
 *
 * Here rather than as a colour map inside the portal's order screen: the
 * same five states are read by the store on its own page and by the
 * seller on their approval queue, and two tables would eventually
 * disagree about which of them is good news.
 */
export function deliveryActionStatusKind(status: DeliveryActionStatus): StatusKind {
  switch (status) {
    // Nothing has happened yet — the seller has not answered.
    case DeliveryActionStatus.PENDING:
      return 'pending';
    // Said yes; the doing of it follows.
    case DeliveryActionStatus.APPROVED:
      return 'confirmed';
    case DeliveryActionStatus.EXECUTED:
      return 'delivered';
    // A person said no. Neutral rather than red: a considered refusal is
    // not a malfunction, and the reason is shown beside it.
    case DeliveryActionStatus.REJECTED:
      return 'cancelled';
    // Somebody said yes and it could not be carried out — the one state
    // here that needs a human, so the one that is red.
    case DeliveryActionStatus.FAILED:
      return 'failed';
    default: {
      const exhaustive: never = status;
      throw new Error(`Unhandled DeliveryActionStatus: ${String(exhaustive)}`);
    }
  }
}

/** The same five states in the words the store and the seller read. */
export function deliveryActionStatusLabel(status: DeliveryActionStatus): string {
  switch (status) {
    case DeliveryActionStatus.PENDING:
      return 'Waiting on the seller';
    case DeliveryActionStatus.APPROVED:
      return 'Approved';
    case DeliveryActionStatus.REJECTED:
      return 'Declined';
    case DeliveryActionStatus.EXECUTED:
      return 'Done';
    case DeliveryActionStatus.FAILED:
      return 'Could not be done';
    default: {
      const exhaustive: never = status;
      throw new Error(`Unhandled DeliveryActionStatus: ${String(exhaustive)}`);
    }
  }
}

/**
 * What became of a reseller store's correction to where its parcel is
 * going (2026-09-16).
 *
 * Its own vocabulary rather than the delivery-action one above, because
 * a correction has a state that an ask does not: APPLIED — seller staff
 * said yes AND the order took it. The two are worth telling apart, since
 * the gap between them is exactly where FAILED lives.
 */
export function storeAddressChangeStatusKind(status: StoreAddressChangeStatus): StatusKind {
  switch (status) {
    // Nobody has answered. The parcel still carries the OLD address.
    case StoreAddressChangeStatus.PENDING:
      return 'pending';
    // Seller staff said yes; writing it onto the order follows.
    case StoreAddressChangeStatus.APPROVED:
      return 'confirmed';
    // The order now carries the corrected details.
    case StoreAddressChangeStatus.APPLIED:
      return 'delivered';
    // A person said no. Neutral rather than red — a considered refusal
    // is not a malfunction, and their reason is shown beside it.
    case StoreAddressChangeStatus.REJECTED:
      return 'cancelled';
    // They agreed and the order had already moved on. The one state here
    // that needs somebody, so the one that is red.
    case StoreAddressChangeStatus.FAILED:
      return 'failed';
    default: {
      const exhaustive: never = status;
      throw new Error(`Unhandled StoreAddressChangeStatus: ${String(exhaustive)}`);
    }
  }
}

/** The same five states in the words the store and seller staff read. */
export function storeAddressChangeStatusLabel(status: StoreAddressChangeStatus): string {
  switch (status) {
    case StoreAddressChangeStatus.PENDING:
      return 'Waiting on seller staff';
    case StoreAddressChangeStatus.APPROVED:
      return 'Approved';
    case StoreAddressChangeStatus.APPLIED:
      return 'Corrected';
    case StoreAddressChangeStatus.REJECTED:
      return 'Declined';
    case StoreAddressChangeStatus.FAILED:
      return 'Could not be applied';
    default: {
      const exhaustive: never = status;
      throw new Error(`Unhandled StoreAddressChangeStatus: ${String(exhaustive)}`);
    }
  }
}

export function resellerStoreStatusLabel(status: ResellerStoreStatus): string {
  switch (status) {
    case ResellerStoreStatus.PENDING_SELLER_APPROVAL:
      return 'awaiting approval';
    case ResellerStoreStatus.ACTIVE:
      return 'active';
    case ResellerStoreStatus.PAUSED:
      return 'paused';
    case ResellerStoreStatus.CLOSED:
      return 'closed';
    case ResellerStoreStatus.REJECTED:
      return 'rejected';
    default: {
      const exhaustive: never = status;
      throw new Error(`Unhandled ResellerStoreStatus: ${String(exhaustive)}`);
    }
  }
}

/**
 * RS-6 phase 3c — one party's credit on a reseller order → kind. Read by
 * the reseller portal, the seller's order detail and the admin order
 * detail alike; a new status fails to compile until it is placed.
 */
export function resellerCreditStatusKind(status: ResellerCreditStatus): StatusKind {
  switch (status) {
    case ResellerCreditStatus.WAITING:
      return 'pending';
    case ResellerCreditStatus.DUE:
      return 'confirmed';
    case ResellerCreditStatus.CREDITED:
      return 'delivered';
    case ResellerCreditStatus.REVERSED:
      return 'rto';
    case ResellerCreditStatus.SKIPPED:
      return 'cancelled';
    default: {
      const exhaustive: never = status;
      throw new Error(`Unhandled ResellerCreditStatus: ${String(exhaustive)}`);
    }
  }
}

/** The words a person reads for a reseller order credit's status. */
export function resellerCreditStatusLabel(status: ResellerCreditStatus): string {
  switch (status) {
    case ResellerCreditStatus.WAITING:
      return 'waiting';
    case ResellerCreditStatus.DUE:
      return 'due';
    case ResellerCreditStatus.CREDITED:
      return 'credited';
    case ResellerCreditStatus.REVERSED:
      return 'taken back';
    case ResellerCreditStatus.SKIPPED:
      return 'not credited';
    default: {
      const exhaustive: never = status;
      throw new Error(`Unhandled ResellerCreditStatus: ${String(exhaustive)}`);
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
 * A withdrawal, in the words of whoever is reading it.
 *
 * The same four states answer two different questions. Staff are
 * working a queue — "has this been decided, does it need paying" — so
 * the enum names are right for them. A seller is asking where their
 * money is, and "Approved" does not answer it: they were approved AND
 * still have nothing. "Payment in process" says what is actually
 * happening.
 *
 * One function rather than a label per app, so the two vocabularies
 * cannot drift into describing the same state differently — which is
 * how a seller and an agent end up disagreeing on the phone.
 */
export function withdrawalStatusLabel(
  status: WithdrawalRequestStatus,
  audience: 'staff' | 'seller' = 'staff',
): string {
  switch (status) {
    case WithdrawalRequestStatus.PENDING:
      return audience === 'seller' ? 'Requested' : 'Pending';
    case WithdrawalRequestStatus.APPROVED:
      // Not "Approved" for the seller: they have been approved and
      // still have no money, so the word answers the wrong question.
      return audience === 'seller' ? 'Payment in process' : 'Approved';
    case WithdrawalRequestStatus.PAID:
      return audience === 'seller' ? 'Paid' : 'Paid';
    case WithdrawalRequestStatus.REJECTED:
      // "Declined" to the person it happened to; "Rejected" is what the
      // queue did.
      return audience === 'seller' ? 'Declined' : 'Rejected';
    default: {
      const exhaustive: never = status;
      throw new Error(`Unhandled WithdrawalRequestStatus: ${String(exhaustive)}`);
    }
  }
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
    // The tax and fee on a COD the courier reversed, given back.
    case WalletEntryDirection.COD_DEDUCTION_REFUND:
    // A member of staff putting our money into the wallet, with a reason.
    case WalletEntryDirection.STAFF_CREDIT:
    // RS-6 — a reseller store the seller manages, paid back off-platform:
    // the store's wallet falls and the seller's rises by the same.
    case WalletEntryDirection.STORE_PAYOUT_IN:
    // RS-6 phase 3c — a reseller store order's transfer price, earned.
    case WalletEntryDirection.RESELLER_TRANSFER_CREDIT:
    case WalletEntryDirection.PREPAID_TRANSFER_CREDIT:
    // RS-7 — a dispute with a reseller store settled in the seller's favour.
    case WalletEntryDirection.STORE_DISPUTE_IN:
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
    // Tax held back from a COD collection. A DEBIT — it leaves the
    // wallet — and kept out of ORDER_CHARGES so "what did sellers pay
    // us in charges" stays answerable without it (WAL-4).
    //
    // It was long described here as a LIABILITY we file. It is not:
    // the courier bills GST on the shipping alongside their charge and
    // remits it, so no return of ours sits behind this deduction. It is
    // revenue, and the P&L reports it as such (2026-09-07).
    case WalletEntryDirection.GST_WITHHOLDING:
    // A COD credit taken back because the courier reversed the COD.
    case WalletEntryDirection.COD_REVERSAL:
    // A member of staff taking money out of the wallet, with a reason.
    case WalletEntryDirection.STAFF_DEBIT:
    // RS-6 — the seller moving money into a reseller store they manage.
    case WalletEntryDirection.STORE_TOPUP_OUT:
    // RS-6 phase 3c — a reseller order's transfer price taken back.
    case WalletEntryDirection.RESELLER_TRANSFER_REVERSAL:
    case WalletEntryDirection.PREPAID_TRANSFER_REVERSAL:
    // RS-7 — a dispute settled in the store's favour: the seller pays it.
    case WalletEntryDirection.STORE_DISPUTE_OUT:
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
      // Not "GST withheld (we file this)". We do not file it, and a
      // label that says we do is a promise to a seller we cannot keep.
      return 'COD tax deduction';
    // The courier took back the COD for a parcel that turned into a return.
    case WalletEntryDirection.COD_REVERSAL:
      return 'COD reversed by courier';
    case WalletEntryDirection.COD_DEDUCTION_REFUND:
      return 'Deduction returned on a reversed COD';
    // Staff wallet transfers. The reason the member of staff gave is the
    // entry's note and is shown beneath this label, so the label only
    // says who moved the money and which way.
    case WalletEntryDirection.STAFF_CREDIT:
      return 'Credited by Skydrop';
    case WalletEntryDirection.STAFF_DEBIT:
      return 'Debited by Skydrop';
    // RS-6 — money between the seller and a reseller store they manage.
    case WalletEntryDirection.STORE_TOPUP_OUT:
      return 'Moved to a reseller store';
    case WalletEntryDirection.STORE_PAYOUT_IN:
      return 'Reseller store paid (recorded)';
    case WalletEntryDirection.RESELLER_TRANSFER_CREDIT:
      return 'Reseller order — your transfer price';
    case WalletEntryDirection.RESELLER_TRANSFER_REVERSAL:
      return 'Reseller order — transfer price taken back';
    case WalletEntryDirection.PREPAID_TRANSFER_CREDIT:
      return 'Prepaid reseller order — your transfer price';
    case WalletEntryDirection.PREPAID_TRANSFER_REVERSAL:
      return 'Prepaid reseller order — transfer price taken back';
    case WalletEntryDirection.STORE_DISPUTE_IN:
      return 'Dispute settled — paid by a reseller store';
    case WalletEntryDirection.STORE_DISPUTE_OUT:
      return 'Dispute settled — paid to a reseller store';
    default: {
      const exhaustive: never = direction;
      throw new Error(`Unhandled WalletEntryDirection: ${String(exhaustive)}`);
    }
  }
}

/**
 * RS-6 — the STORE wallet's ledger vocabulary: which way each direction
 * moves a reseller store's balance. The same F2 discipline as
 * `isWalletCredit`, and for the same reason — an unregistered direction
 * must fail to BUILD, never silently read as a debit. ONE switch for every
 * frontend (the reseller portal, the seller's store page, the admin),
 * compared as a whole set against the API's `STORE_CREDIT_DIRECTIONS` by
 * `store-wallet-directions.spec.ts`.
 */
export function isStoreWalletCredit(direction: StoreWalletEntryDirection): boolean {
  switch (direction) {
    case StoreWalletEntryDirection.SELLER_TOPUP:
    case StoreWalletEntryDirection.TOPUP:
    case StoreWalletEntryDirection.ORDER_CREDIT:
    case StoreWalletEntryDirection.SHARE_REFUND:
    case StoreWalletEntryDirection.PREPAID_REFUND:
    case StoreWalletEntryDirection.TRANSFER_PRICE_REFUND:
    case StoreWalletEntryDirection.DISPUTE_SETTLEMENT_IN:
      return true;
    case StoreWalletEntryDirection.SELLER_PAYOUT:
    case StoreWalletEntryDirection.WITHDRAWAL:
    case StoreWalletEntryDirection.ORDER_CREDIT_REVERSAL:
    case StoreWalletEntryDirection.FEE_SHARE:
    case StoreWalletEntryDirection.COD_TAX_SHARE:
    case StoreWalletEntryDirection.PREPAID_DEBIT:
    case StoreWalletEntryDirection.TRANSFER_PRICE:
    case StoreWalletEntryDirection.DISPUTE_SETTLEMENT_OUT:
      return false;
    default: {
      const exhaustive: never = direction;
      throw new Error(`Unhandled StoreWalletEntryDirection: ${String(exhaustive)}`);
    }
  }
}

/**
 * The label a store user, their seller or a member of staff reads on a
 * store wallet line. `seller` is the seller's company name, so a store
 * reads "Topped up by Dhaka Threads" rather than a word for a role.
 */
export function storeWalletDirectionLabel(
  direction: StoreWalletEntryDirection,
  seller = 'the seller',
): string {
  switch (direction) {
    case StoreWalletEntryDirection.SELLER_TOPUP:
      return `Topped up by ${seller}`;
    case StoreWalletEntryDirection.SELLER_PAYOUT:
      return `Paid by ${seller} (recorded)`;
    case StoreWalletEntryDirection.TOPUP:
      return 'Top-up received';
    case StoreWalletEntryDirection.WITHDRAWAL:
      return 'Withdrawal paid';
    case StoreWalletEntryDirection.ORDER_CREDIT:
      return 'Order margin';
    case StoreWalletEntryDirection.ORDER_CREDIT_REVERSAL:
      return 'Order margin reversed';
    case StoreWalletEntryDirection.FEE_SHARE:
      return 'Share of a Skydrop fee';
    case StoreWalletEntryDirection.COD_TAX_SHARE:
      return 'Share of the COD tax';
    case StoreWalletEntryDirection.SHARE_REFUND:
      return 'Fee share returned';
    case StoreWalletEntryDirection.PREPAID_DEBIT:
      return 'Prepaid order';
    case StoreWalletEntryDirection.PREPAID_REFUND:
      return 'Prepaid order refunded';
    case StoreWalletEntryDirection.TRANSFER_PRICE:
      return `Goods at ${seller}’s transfer price`;
    case StoreWalletEntryDirection.TRANSFER_PRICE_REFUND:
      return 'Transfer price given back';
    case StoreWalletEntryDirection.DISPUTE_SETTLEMENT_IN:
      return `Dispute settled — paid by ${seller}`;
    case StoreWalletEntryDirection.DISPUTE_SETTLEMENT_OUT:
      return `Dispute settled — paid to ${seller}`;
    default: {
      const exhaustive: never = direction;
      throw new Error(`Unhandled StoreWalletEntryDirection: ${String(exhaustive)}`);
    }
  }
}

/**
 * What to CALL the carrier on a screen.
 *
 * A manually-placed parcel carries the literal `courierCode` 'manual'
 * (CUR-8) — that string is a routing fact, not a name, and showing it
 * told a seller their parcel was with a courier called "manual" and told
 * the customer the same on the public tracking page. The carrier's real
 * name lives in `shipments.manual_courier_name`.
 *
 * ONE function rather than a `?? courierCode` at each call site, for the
 * reason CNS-2 and BIN-1 give: four screens each deciding what to show
 * is how they come to disagree, and the one that gets it wrong is
 * whichever nobody re-read. A blank or whitespace-only name falls back
 * to the code — an empty label is worse than an honest ugly one.
 */
export function courierLabel(
  courierCode: string | null | undefined,
  manualCourierName?: string | null,
): string {
  const manual = manualCourierName?.trim() ?? '';
  if (manual !== '') return manual;
  return courierCode ?? '—';
}
