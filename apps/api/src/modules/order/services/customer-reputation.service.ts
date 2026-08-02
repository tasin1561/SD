import { Injectable } from '@nestjs/common';
import { CustomerRiskLevel, OrderStatus } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

/**
 * What we know about a phone number before shipping to it.
 *
 * COD is the whole economic problem here: a refused parcel costs a round
 * trip and the return fee, and the only cheap defence is knowing that
 * this customer has refused before.
 *
 * ── The counts are PLATFORM-WIDE, the orders are not ──────────────────
 * Refusal risk is a property of the CUSTOMER, not of the seller-customer
 * pair. A serial refuser who has burned four sellers is exactly who the
 * fifth needs warning about, and per-seller history tells them nothing
 * until they have been burned themselves.
 *
 * So the aggregate spans every seller, and the ORDER LIST is filtered to
 * the asking seller's own. The seller learns the risk without learning
 * who else sells to this person, what they bought, or for how much.
 * That line — counts shared, orders private — is deliberate, and it
 * knowingly narrows ORD-7's per-seller customer isolation to exactly
 * that aggregate.
 *
 * ── Computed, never counted ───────────────────────────────────────────
 * `customers` carries `rtoCount`, `successfulOrdersCount` and friends.
 * Nothing ever wrote them — they were zero for every customer in the
 * system — and rather than start maintaining increments on every
 * lifecycle transition, this derives the numbers from `orders` on each
 * lookup. One query per order entry is nothing, and a figure that is
 * recomputed cannot drift. Maintained counters can, and the two worst
 * bugs found this week were both drift.
 *
 * `riskLevel` and `riskNotes` DO survive: those are human judgements,
 * not derived facts.
 */

/**
 * A parcel that physically came back, or is on its way back.
 *
 * `DELIVERY_FAILED` is deliberately NOT here — a failed attempt is not
 * yet a return; the courier usually tries again, and counting it would
 * inflate every customer who was once out when the van came.
 */
const RETURNED_STATUSES: readonly OrderStatus[] = [
  OrderStatus.RTO_INITIATED,
  OrderStatus.RTO_IN_TRANSIT,
  OrderStatus.RTO_RECEIVED,
  OrderStatus.RTO_RESTOCKED,
  OrderStatus.RTO_DAMAGED,
];

/**
 * Refused before the parcel ever moved — the call centre caught it.
 *
 * Kept apart from a door refusal on purpose: this one costs nothing but
 * a phone call, and folding the two together hides the only number with
 * money attached to it.
 */
const REFUSED_ON_CALL_STATUSES: readonly OrderStatus[] = [
  OrderStatus.REJECTED_BY_CUSTOMER,
  OrderStatus.REJECTED_NDR,
];

/**
 * Statuses where a second order for the same customer is worth
 * flagging: the parcel has not been packed yet, so the two could still
 * be consolidated or one cancelled.
 *
 * Once PACKED the box is physically made up and a warning is just
 * noise. Cancelled and rejected orders are dead, not pending, and
 * warning about them would be worse than noise — it would be wrong.
 */
export const UNPACKED_OPEN_STATUSES: readonly OrderStatus[] = [
  OrderStatus.DRAFT,
  OrderStatus.PENDING_CONFIRMATION,
  OrderStatus.CALL_NO_RESPONSE,
  OrderStatus.CALL_RESCHEDULED,
  OrderStatus.AWAITING_SELLER_DECISION,
  OrderStatus.CONFIRMED,
  OrderStatus.OUT_OF_STOCK,
  OrderStatus.PENDING_PICK,
  OrderStatus.PICKED,
];

export interface CustomerOrderSummary {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly status: OrderStatus;
  readonly placedAt: Date;
  readonly valueInr: string | null;
  readonly itemCount: number;
}

export interface CustomerReputation {
  readonly phoneE164: string;
  /** Counts across EVERY seller. The risk belongs to the customer. */
  readonly platform: {
    readonly totalOrders: number;
    readonly delivered: number;
    /** Came back, or coming back. */
    readonly returned: number;
    /** Said no on the phone — costs a call, not a van. */
    readonly refusedOnCall: number;
    /** returned / (delivered + returned), 1dp. Null under 3 orders,
     *  because a rate off one parcel is not a rate. */
    readonly returnRatePercent: string | null;
    readonly firstOrderAt: Date | null;
    readonly lastOrderAt: Date | null;
  };
  /** This seller's own history. Detail stays private to its owner. */
  readonly yours: {
    readonly totalOrders: number;
    readonly delivered: number;
    readonly returned: number;
    readonly recentOrders: readonly CustomerOrderSummary[];
    /** Not yet packed — the ones a new order might duplicate. */
    readonly openOrders: readonly CustomerOrderSummary[];
  };
  /** A human's verdict, if one has been recorded. Never derived. */
  readonly riskLevel: CustomerRiskLevel;
  readonly riskNotes: string | null;
  readonly customerName: string | null;
}

@Injectable()
export class CustomerReputationService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Look a number up.
   *
   * `phoneE164` must already be normalised — the DTO enforces E.164 at
   * the boundary. A seller typing a local format and silently matching
   * nothing is the failure mode to avoid, so normalisation belongs
   * before this, not inside it.
   */
  async lookup(sellerId: string, phoneE164: string): Promise<CustomerReputation> {
    const [platformRows, ownOrders, customer] = await Promise.all([
      // Grouped counts across every seller. Soft-deleted orders excluded
      // — a deleted order is not history, it is a mistake we removed.
      this.prisma.client.order.groupBy({
        by: ['status'],
        where: { recipientPhoneE164: phoneE164, deletedAt: null },
        _count: { _all: true },
        _min: { createdAt: true },
        _max: { createdAt: true },
      }),
      this.prisma.client.order.findMany({
        where: { sellerId, recipientPhoneE164: phoneE164, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          orderNumber: true,
          status: true,
          createdAt: true,
          declaredValueInr: true,
          _count: { select: { items: true } },
        },
      }),
      this.prisma.client.customer.findFirst({
        where: { sellerId, phoneE164, deletedAt: null },
        select: { name: true, riskLevel: true, riskNotes: true },
      }),
    ]);

    const countOf = (statuses: readonly OrderStatus[]): number =>
      platformRows
        .filter((r) => statuses.includes(r.status))
        .reduce((n, r) => n + r._count._all, 0);

    const totalOrders = platformRows.reduce((n, r) => n + r._count._all, 0);
    const delivered = countOf([OrderStatus.DELIVERED]);
    const returned = countOf(RETURNED_STATUSES);
    const refusedOnCall = countOf(REFUSED_ON_CALL_STATUSES);

    // The denominator is orders that REACHED a doorstep, not every order
    // ever placed: a customer with nine pending orders and one return is
    // not a 10% risk, and dividing by everything would say so.
    const concluded = delivered + returned;
    const returnRatePercent = concluded >= 3 ? ((returned / concluded) * 100).toFixed(1) : null;

    const firstOrderAt = platformRows.reduce<Date | null>(
      (min, r) => (r._min.createdAt && (!min || r._min.createdAt < min) ? r._min.createdAt : min),
      null,
    );
    const lastOrderAt = platformRows.reduce<Date | null>(
      (max, r) => (r._max.createdAt && (!max || r._max.createdAt > max) ? r._max.createdAt : max),
      null,
    );

    const summarise = (o: (typeof ownOrders)[number]): CustomerOrderSummary => ({
      orderId: o.id,
      orderNumber: o.orderNumber,
      status: o.status,
      placedAt: o.createdAt,
      valueInr: o.declaredValueInr?.toFixed(2) ?? null,
      itemCount: o._count.items,
    });

    return {
      phoneE164,
      platform: {
        totalOrders,
        delivered,
        returned,
        refusedOnCall,
        returnRatePercent,
        firstOrderAt,
        lastOrderAt,
      },
      yours: {
        totalOrders: ownOrders.length,
        delivered: ownOrders.filter((o) => o.status === OrderStatus.DELIVERED).length,
        returned: ownOrders.filter((o) => RETURNED_STATUSES.includes(o.status)).length,
        recentOrders: ownOrders.map(summarise),
        openOrders: ownOrders
          .filter((o) => UNPACKED_OPEN_STATUSES.includes(o.status))
          .map(summarise),
      },
      riskLevel: customer?.riskLevel ?? CustomerRiskLevel.NONE,
      riskNotes: customer?.riskNotes ?? null,
      customerName: customer?.name ?? null,
    };
  }

  /**
   * The seller's own unpacked orders for this number — what a new order
   * would be duplicating.
   *
   * Seller-scoped by construction, which is the whole reason seller A's
   * pending order cannot warn seller B: B's query never sees it.
   */
  async findOpenOrdersForPhone(
    sellerId: string,
    phoneE164: string,
    variantIds: readonly string[] = [],
  ): Promise<
    Array<CustomerOrderSummary & { readonly sharesItems: boolean; readonly recipientName: string }>
  > {
    const orders = await this.prisma.client.order.findMany({
      where: {
        sellerId,
        recipientPhoneE164: phoneE164,
        deletedAt: null,
        status: { in: [...UNPACKED_OPEN_STATUSES] },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        orderNumber: true,
        status: true,
        createdAt: true,
        declaredValueInr: true,
        recipientName: true,
        items: { select: { variantId: true } },
      },
    });

    const wanted = new Set(variantIds);
    return orders.map((o) => ({
      orderId: o.id,
      orderNumber: o.orderNumber,
      status: o.status,
      placedAt: o.createdAt,
      valueInr: o.declaredValueInr?.toFixed(2) ?? null,
      itemCount: o.items.length,
      recipientName: o.recipientName,
      // Same SKUs is almost certainly a double-entry; different SKUs is
      // usually a real second purchase. Same warning either way, but the
      // seller can tell them apart without opening both.
      sharesItems: wanted.size > 0 && o.items.some((i) => wanted.has(i.variantId)),
    }));
  }
}
