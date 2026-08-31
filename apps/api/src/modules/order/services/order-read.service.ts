import { Injectable, NotFoundException } from '@nestjs/common';
import { OrderSource, OrderStatus, PaymentMode, Prisma, WalletEntryDirection } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

export interface ResolvedOrderItem {
  readonly orderItemId: string;
  readonly variantId: string;
  readonly skuCode: string;
  readonly productName: string;
  readonly variantLabel: string | null;
  readonly imageUrl: string | null;
  readonly quantity: number;
  readonly unitWeightGrams: number | null;
  readonly unitDeclaredValueInr: Prisma.Decimal | null;
  readonly unitPriceInr: Prisma.Decimal | null;
  // Fulfillment progress (owned by Modules 5/8; read-through here).
  readonly qtyReserved: number;
  readonly qtyPicked: number;
  readonly qtyPacked: number;
  readonly qtyShipped: number;
  readonly qtyDelivered: number;
  readonly qtyReturned: number;
}

export interface ResolvedOrder {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly sellerId: string;
  readonly customerId: string | null;
  readonly sellerOrderRef: string | null;
  readonly source: OrderSource;
  readonly status: OrderStatus;
  readonly isUrgent: boolean;
  readonly isHighRisk: boolean;
  readonly hasAdminOverride: boolean;
  // Immutable recipient snapshot (ORD-6).
  readonly recipient: {
    readonly name: string;
    readonly phoneE164: string;
    readonly altPhoneE164: string | null;
    readonly email: string | null;
    readonly addressLine1: string;
    readonly addressLine2: string | null;
    readonly landmark: string | null;
    readonly city: string;
    readonly stateProvince: string;
    readonly postalCode: string;
    readonly countryCode: string;
  };
  readonly paymentMode: PaymentMode;
  readonly codAmountInr: Prisma.Decimal | null;
  readonly declaredValueInr: Prisma.Decimal;
  readonly totalWeightGrams: number | null;
  readonly placedAt: Date;
  readonly confirmedAt: Date | null;
  readonly cancelledAt: Date | null;
  readonly items: ReadonlyArray<ResolvedOrderItem>;
}

const ORDER_SELECT = {
  id: true,
  orderNumber: true,
  sellerId: true,
  customerId: true,
  sellerOrderRef: true,
  source: true,
  status: true,
  isUrgent: true,
  isHighRisk: true,
  hasAdminOverride: true,
  recipientName: true,
  recipientPhoneE164: true,
  recipientAltPhoneE164: true,
  recipientEmail: true,
  recipientAddressLine1: true,
  recipientAddressLine2: true,
  recipientLandmark: true,
  recipientCity: true,
  recipientStateProvince: true,
  recipientPostalCode: true,
  recipientCountryCode: true,
  paymentMode: true,
  codAmountInr: true,
  declaredValueInr: true,
  totalWeightGrams: true,
  placedAt: true,
  confirmedAt: true,
  cancelledAt: true,
  items: {
    select: {
      id: true,
      variantId: true,
      skuCode: true,
      productName: true,
      variantLabel: true,
      imageUrl: true,
      quantity: true,
      unitWeightGrams: true,
      unitDeclaredValueInr: true,
      unitPriceInr: true,
      qtyReserved: true,
      qtyPicked: true,
      qtyPacked: true,
      qtyShipped: true,
      qtyDelivered: true,
      qtyReturned: true,
    },
  },
} as const;

type OrderRow = Prisma.OrderGetPayload<{ select: typeof ORDER_SELECT }>;

/**
 * The ONLY sanctioned cross-module entry point for reading orders.
 * Modules 7 (call centre) and 8 (warehouse ops) consume this instead of
 * querying `orders` / `order_items` directly — exactly the boundary
 * pattern of `CatalogReadService` (variants) and `StockReadService`
 * (stock). Pure read: no method writes; returns are frozen; the order's
 * own immutable snapshot is authoritative (consumers must NOT re-resolve
 * line data from the live catalog — ORD-6).
 *
 * Soft-deleted orders are absent (null / not in the map).
 *
 * ── SANCTIONED CROSS-MODULE API (Modules 7 / 8) ────────────────────────
 *
 * getById(orderId): ResolvedOrder | null
 *   Single order resolved to a deep-frozen snapshot (recipient block +
 *   per-line SKU snapshot + fulfillment-progress quantities). null when
 *   missing or soft-deleted.
 *
 * requireById(orderId): ResolvedOrder
 *   As getById but throws 404 instead of returning null — the ergonomic
 *   default for Module 7/8 call sites that need the order to exist.
 *
 * getManyByIds(orderIds): ReadonlyMap<orderId, ResolvedOrder>
 *   Batch resolve, deduped, ONE query (no N+1). Missing/soft-deleted ids
 *   are simply absent from the map; [] in → empty map (no query).
 * ───────────────────────────────────────────────────────────────────────
 */
/**
 * Confirmed, not delivered, and still going forwards. Declared once so
 * the dashboard figure and anything later that asks the same question
 * cannot answer it differently.
 */
const IN_TRANSIT_STATUSES = [
  OrderStatus.CONFIRMED,
  OrderStatus.PENDING_PICK,
  OrderStatus.PICKED,
  OrderStatus.PACKED,
  OrderStatus.PACK_FAILED,
  OrderStatus.PENDING_DISPATCH,
  OrderStatus.PENDING_MANUAL_PLACEMENT,
  OrderStatus.DISPATCHED,
  OrderStatus.IN_TRANSIT,
  OrderStatus.OUT_FOR_DELIVERY,
  // A failed attempt is still forward motion: the courier re-attempts.
  OrderStatus.DELIVERY_FAILED,
] as const;

@Injectable()
export class OrderReadService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The two figures a seller wants on a dashboard: what is still coming
   * to them, and what has arrived but not yet reached their wallet.
   *
   * Both are the COD the customer pays — the gross figure, with our
   * fees and the GST we withhold still inside it. That is what the
   * seller thinks in, and stating it gross with the deduction named is
   * honest in a way that a silently netted number is not: a net figure
   * would be smaller than anything they can check against the courier.
   *
   * IN TRANSIT is the FORWARD journey only. RTO_* and LOST_IN_TRANSIT
   * are also "confirmed and not delivered" by the letter of it, but a
   * parcel coming back or gone missing is not money on its way, and
   * counting it here would promise a seller cash that is not coming.
   *
   * PROCESSING is delivered with no COD credit yet. On the default
   * SETTLEMENT tier that is the normal state — the courier has not paid
   * us — so this is the seller's own view of the float, the same money
   * the admin float report counts from our side.
   *
   * PREPAID orders are excluded from both: nothing is owed on an order
   * whose money the seller already has.
   */
  async moneyInFlight(sellerId: string): Promise<{
    inTransit: { count: number; codInr: string };
    processing: { count: number; codInr: string };
  }> {
    const [moving, delivered] = await Promise.all([
      this.prisma.client.order.findMany({
        where: {
          sellerId,
          deletedAt: null,
          paymentMode: PaymentMode.COD,
          status: { in: [...IN_TRANSIT_STATUSES] },
        },
        select: { codAmountInr: true },
      }),
      this.prisma.client.order.findMany({
        where: {
          sellerId,
          deletedAt: null,
          paymentMode: PaymentMode.COD,
          status: OrderStatus.DELIVERED,
          // Not yet credited. The wallet entry is the evidence the money
          // reached them; its absence is what "processing" means.
          walletEntries: { none: { direction: WalletEntryDirection.COD_COLLECTION } },
        },
        select: { codAmountInr: true },
      }),
    ]);

    const sum = (rows: Array<{ codAmountInr: Prisma.Decimal | null }>): string =>
      rows.reduce((t, r) => t.add(r.codAmountInr ?? 0), new Prisma.Decimal(0)).toFixed(2);

    return {
      inTransit: { count: moving.length, codInr: sum(moving) },
      processing: { count: delivered.length, codInr: sum(delivered) },
    };
  }

  async getById(orderId: string): Promise<ResolvedOrder | null> {
    const row = await this.prisma.client.order.findFirst({
      where: { id: orderId, deletedAt: null },
      select: ORDER_SELECT,
    });
    return row ? this.resolve(row) : null;
  }

  /** Convenience for Modules 7/8: throws 404 instead of returning null. */
  async requireById(orderId: string): Promise<ResolvedOrder> {
    const order = await this.getById(orderId);
    if (!order) {
      throw new NotFoundException(`Order ${orderId} not found`);
    }
    return order;
  }

  /** Batch resolve — one query, no N+1. Missing/soft-deleted ids are
   *  simply absent from the returned map. */
  async getManyByIds(orderIds: string[]): Promise<ReadonlyMap<string, ResolvedOrder>> {
    const ids = [...new Set(orderIds)];
    const out = new Map<string, ResolvedOrder>();
    if (ids.length === 0) return out;
    const rows = await this.prisma.client.order.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: ORDER_SELECT,
    });
    for (const row of rows) out.set(row.id, this.resolve(row));
    return out;
  }

  private resolve(row: OrderRow): ResolvedOrder {
    return Object.freeze({
      orderId: row.id,
      orderNumber: row.orderNumber,
      sellerId: row.sellerId,
      customerId: row.customerId,
      sellerOrderRef: row.sellerOrderRef,
      source: row.source,
      status: row.status,
      isUrgent: row.isUrgent,
      isHighRisk: row.isHighRisk,
      hasAdminOverride: row.hasAdminOverride,
      recipient: Object.freeze({
        name: row.recipientName,
        phoneE164: row.recipientPhoneE164,
        altPhoneE164: row.recipientAltPhoneE164,
        email: row.recipientEmail,
        addressLine1: row.recipientAddressLine1,
        addressLine2: row.recipientAddressLine2,
        landmark: row.recipientLandmark,
        city: row.recipientCity,
        stateProvince: row.recipientStateProvince,
        postalCode: row.recipientPostalCode,
        countryCode: row.recipientCountryCode,
      }),
      paymentMode: row.paymentMode,
      codAmountInr: row.codAmountInr,
      declaredValueInr: row.declaredValueInr,
      totalWeightGrams: row.totalWeightGrams,
      placedAt: row.placedAt,
      confirmedAt: row.confirmedAt,
      cancelledAt: row.cancelledAt,
      items: Object.freeze(
        row.items.map((i) =>
          Object.freeze({
            orderItemId: i.id,
            variantId: i.variantId,
            skuCode: i.skuCode,
            productName: i.productName,
            variantLabel: i.variantLabel,
            imageUrl: i.imageUrl,
            quantity: i.quantity,
            unitWeightGrams: i.unitWeightGrams,
            unitDeclaredValueInr: i.unitDeclaredValueInr,
            unitPriceInr: i.unitPriceInr,
            qtyReserved: i.qtyReserved,
            qtyPicked: i.qtyPicked,
            qtyPacked: i.qtyPacked,
            qtyShipped: i.qtyShipped,
            qtyDelivered: i.qtyDelivered,
            qtyReturned: i.qtyReturned,
          }),
        ),
      ),
    });
  }
}
