import { OrderEventType, OrderStatus, ShipmentStatus } from '@skydrop/db';
import type { Prisma } from '@skydrop/db';

/**
 * "Did this order's parcel ever leave with a courier?" — the ONE answer,
 * read by the cancel-time refund (`OrderPostCommitHooksService`) and by
 * the delivery-time money (`AccrualExecutionService`, WAL-8).
 *
 * A plain module (no Nest, no Prisma client of its own) so both sides can
 * import it without either module importing the other: the order module
 * already imports seller-wallet-accrual, and the reverse would be a cycle.
 * Two copies of this rule is how the refund and the billing would come to
 * disagree about the same parcel — which is the bug it replaced: billing a
 * forced DELIVERED trusted the forced status while the refund did not.
 */

/** Marks god mode's own STATUS_CHANGED rows and its lifecycle events. */
export const ADMIN_OVERRIDE_SOURCE = 'ADMIN_OVERRIDE' as const;

/** M8 commit 16: the set of "deliberately ending the order" landings
 *  on which the shipment-provision wiring (R3) should void a CREATED
 *  shipment. voidForOrder is idempotent against non-CREATED shipments,
 *  so this list is intentionally generous — post-pick/pack/dispatch
 *  shipments are no longer CREATED and are naturally untouched. */
export const VOIDABLE_TERMINAL_STATES: ReadonlySet<OrderStatus> = new Set([
  OrderStatus.CANCELLED,
  OrderStatus.CANCELLED_BY_ADMIN,
  OrderStatus.REJECTED,
  OrderStatus.REJECTED_BY_CUSTOMER,
  OrderStatus.REJECTED_NDR,
]);

/**
 * States an order can be called off from and honestly say the parcel
 * never went anywhere — so a delivery fee already taken has to go back.
 *
 * An ALLOW-LIST rather than "everything before DISPATCHED", so a status
 * added later is not silently refundable: someone has to decide where
 * it sits relative to the courier having the parcel. The dividing line
 * is exactly that — once DISPATCHED, the courier has been given the
 * goods and the cost of moving them is real whatever happens next.
 * PENDING_DISPATCH is on this side of the line: it is packed and
 * manifested but still on our floor.
 *
 * God mode (ORD-2) draws the SAME line from the other side: its forced
 * `from` proves nothing, so it asks whether the order ever reached a
 * status outside this set and the cancel family through a real
 * transition — see `parcelLeftWithCourier`.
 */
export const REFUNDABLE_FROM_STATES: ReadonlySet<OrderStatus> = new Set([
  OrderStatus.DRAFT,
  OrderStatus.PENDING_CONFIRMATION,
  OrderStatus.CALL_NO_RESPONSE,
  OrderStatus.CALL_RESCHEDULED,
  OrderStatus.AWAITING_SELLER_DECISION,
  // CUR-17 — held for a carrier decision. No waybill exists and
  // nothing has been picked, so this is one of the cheapest points in
  // the lifecycle for a seller to change their mind.
  OrderStatus.AWAITING_COURIER,
  OrderStatus.CONFIRMED,
  OrderStatus.OUT_OF_STOCK,
  OrderStatus.PENDING_PICK,
  OrderStatus.PICKED,
  OrderStatus.PACK_FAILED,
  OrderStatus.PACKED,
  OrderStatus.PENDING_DISPATCH,
  OrderStatus.PENDING_MANUAL_PLACEMENT,
]);

/**
 * Statuses that mean the courier HAD the parcel: everything outside the
 * refundable allow-list and outside the cancel family itself. DERIVED,
 * so a god-mode cancel refunds exactly when a normal cancel would, and a
 * status added later lands on the no-refund side until somebody puts it
 * on the allow-list.
 */
export const PAST_THE_DIVIDING_LINE: readonly OrderStatus[] = Object.values(OrderStatus).filter(
  (s) => !REFUNDABLE_FROM_STATES.has(s) && !VOIDABLE_TERMINAL_STATES.has(s),
);

/** A shipment in one of these was physically with a courier at some point. */
export const SHIPMENT_STATUSES_WITH_COURIER: readonly ShipmentStatus[] = [
  ShipmentStatus.HANDED_TO_COURIER,
  ShipmentStatus.IN_TRANSIT,
  ShipmentStatus.AT_HUB,
  ShipmentStatus.OUT_FOR_DELIVERY,
  ShipmentStatus.DELIVERY_ATTEMPTED,
  ShipmentStatus.DELIVERED,
  ShipmentStatus.RTO_INITIATED,
  ShipmentStatus.RTO_IN_TRANSIT,
  ShipmentStatus.RTO_DELIVERED,
  ShipmentStatus.LOST,
  ShipmentStatus.DAMAGED,
];

export function isAdminOverrideEvent(data: Prisma.JsonValue): boolean {
  return (
    typeof data === 'object' &&
    data !== null &&
    !Array.isArray(data) &&
    (data as Record<string, unknown>).source === ADMIN_OVERRIDE_SOURCE
  );
}

/** The two reads `parcelLeftWithCourier` makes — satisfied by the Prisma
 *  client and by a transaction client alike. */
export interface CarriageReader {
  shipment: { count(args: Prisma.ShipmentCountArgs): Promise<number> };
  orderEvent: {
    findMany(args: {
      where: Prisma.OrderEventWhereInput;
      select: { data: true };
    }): Promise<Array<{ data: Prisma.JsonValue }>>;
  };
}

/**
 * Did this order's parcel ever leave with a courier?
 *
 * Two independent facts, either one enough:
 *  - a shipment on the order was handed over (scanned at the handover
 *    bench, or in any status only a courier puts it in). God mode never
 *    touches shipment status, so this is physical evidence it cannot
 *    fake.
 *  - the order reached a status past the dividing line through a REAL
 *    transition — a STATUS_CHANGED row not stamped `source:
 *    ADMIN_OVERRIDE`. God mode's own rows are skipped: a status it
 *    forced is exactly the claim under suspicion.
 *
 * A real DELIVERED always passes (it arrived through real transitions
 * past the line); only a status god mode forced, with no handover behind
 * it, fails.
 */
export async function parcelLeftWithCourier(db: CarriageReader, orderId: string): Promise<boolean> {
  const handedOver = await db.shipment.count({
    where: {
      orderShipments: { some: { orderId } },
      OR: [
        { handoverScannedAt: { not: null } },
        { status: { in: [...SHIPMENT_STATUSES_WITH_COURIER] } },
      ],
    },
  });
  if (handedOver > 0) return true;

  const reached = await db.orderEvent.findMany({
    where: {
      orderId,
      type: OrderEventType.STATUS_CHANGED,
      toStatus: { in: [...PAST_THE_DIVIDING_LINE] },
    },
    select: { data: true },
  });
  return reached.some((e) => !isAdminOverrideEvent(e.data));
}
