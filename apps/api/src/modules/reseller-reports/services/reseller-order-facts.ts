import type { PaymentMode, ResellerCreditTrigger } from '@skydrop/db';
import { OrderStatus, Prisma } from '@skydrop/db';
import { orderFate } from '../../treasury/services/pnl.service';

type Db = Prisma.TransactionClient;

const ZERO = new Prisma.Decimal(0);
/** IN-list size per query — keeps a big store's report from one giant statement. */
const CHUNK = 1000;

/**
 * What the reseller analyses need to know about an order, read in a few
 * flat queries (orders, their lines, the handful of status events that
 * date a fate). A report, never a decision: it reads the order tables
 * directly, as the platform P&L does, and every caller scopes the WHERE
 * by the store or seller it is answering for.
 */
export interface OrderFactLine {
  readonly variantId: string;
  readonly skuCode: string;
  readonly productName: string;
  readonly quantity: number;
  readonly retailInr: Prisma.Decimal | null;
  readonly transferInr: Prisma.Decimal | null;
  readonly pickedBatchId: string | null;
}

export interface OrderFact {
  readonly id: string;
  readonly orderNumber: string;
  readonly storeId: string;
  readonly sellerId: string;
  readonly status: OrderStatus;
  readonly createdAt: Date;
  readonly confirmedAt: Date | null;
  readonly paymentMode: PaymentMode;
  readonly codAmountInr: Prisma.Decimal | null;
  readonly postalCode: string;
  readonly phoneE164: string;
  readonly storeCreditTrigger: ResellerCreditTrigger | null;
  readonly storeCreditDays: number | null;
  readonly everConfirmed: boolean;
  /** First DELIVERED event — when the parcel reached the customer. */
  readonly deliveredAt: Date | null;
  /** First received-back event. */
  readonly returnedAt: Date | null;
  /** Reached a courier: a DISPATCHED event, or a delivered / returned fate. */
  readonly dispatched: boolean;
  readonly lines: readonly OrderFactLine[];
  readonly retailInr: Prisma.Decimal;
  readonly transferInr: Prisma.Decimal;
}

const RETURNED_STATUSES: readonly OrderStatus[] = [
  OrderStatus.RTO_RECEIVED,
  OrderStatus.RTO_RESTOCKED,
  OrderStatus.RTO_DAMAGED,
];

const EVENT_STATUSES: readonly OrderStatus[] = [
  OrderStatus.CONFIRMED,
  OrderStatus.DISPATCHED,
  OrderStatus.DELIVERED,
  ...RETURNED_STATUSES,
];

export function chunks<T>(items: readonly T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function loadOrderFacts(db: Db, where: Prisma.OrderWhereInput): Promise<OrderFact[]> {
  const orders = await db.order.findMany({
    where,
    select: {
      id: true,
      orderNumber: true,
      storeId: true,
      sellerId: true,
      status: true,
      createdAt: true,
      confirmedAt: true,
      paymentMode: true,
      codAmountInr: true,
      recipientPostalCode: true,
      recipientPhoneE164: true,
      resellerStoreCreditTrigger: true,
      resellerStoreCreditDays: true,
    },
    orderBy: { createdAt: 'asc' },
  });
  if (orders.length === 0) return [];
  const ids = orders.map((o) => o.id);
  const items: Array<{
    orderId: string;
    variantId: string;
    skuCode: string;
    productName: string;
    quantity: number;
    resellerRetailUnitInr: Prisma.Decimal | null;
    resellerTransferPriceInr: Prisma.Decimal | null;
    pickedBatchId: string | null;
  }> = [];
  const events: Array<{ orderId: string; toStatus: OrderStatus | null; createdAt: Date }> = [];
  for (const part of chunks(ids)) {
    const [i, e] = await Promise.all([
      db.orderItem.findMany({
        where: { orderId: { in: part } },
        select: {
          orderId: true,
          variantId: true,
          skuCode: true,
          productName: true,
          quantity: true,
          resellerRetailUnitInr: true,
          resellerTransferPriceInr: true,
          pickedBatchId: true,
        },
      }),
      db.orderEvent.findMany({
        where: { orderId: { in: part }, toStatus: { in: [...EVENT_STATUSES] } },
        select: { orderId: true, toStatus: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    items.push(...i);
    events.push(...e);
  }
  const linesBy = new Map<string, OrderFactLine[]>();
  for (const i of items) {
    const list = linesBy.get(i.orderId) ?? [];
    list.push({
      variantId: i.variantId,
      skuCode: i.skuCode,
      productName: i.productName,
      quantity: i.quantity,
      retailInr: i.resellerRetailUnitInr,
      transferInr: i.resellerTransferPriceInr,
      pickedBatchId: i.pickedBatchId,
    });
    linesBy.set(i.orderId, list);
  }
  const firstAt = new Map<string, Date>();
  const seen = new Map<string, Set<OrderStatus>>();
  for (const e of events) {
    if (e.toStatus === null) continue;
    const s = seen.get(e.orderId) ?? new Set<OrderStatus>();
    s.add(e.toStatus);
    seen.set(e.orderId, s);
    const key = `${e.orderId}|${RETURNED_STATUSES.includes(e.toStatus) ? 'RETURNED' : e.toStatus}`;
    if (!firstAt.has(key)) firstAt.set(key, e.createdAt);
  }
  return orders.map((o) => {
    const lines = linesBy.get(o.id) ?? [];
    const statuses = seen.get(o.id) ?? new Set<OrderStatus>();
    const fate = orderFate(o.status);
    return {
      id: o.id,
      orderNumber: o.orderNumber,
      storeId: o.storeId,
      sellerId: o.sellerId,
      status: o.status,
      createdAt: o.createdAt,
      confirmedAt: o.confirmedAt,
      paymentMode: o.paymentMode,
      codAmountInr: o.codAmountInr,
      postalCode: o.recipientPostalCode,
      phoneE164: o.recipientPhoneE164,
      storeCreditTrigger: o.resellerStoreCreditTrigger,
      storeCreditDays: o.resellerStoreCreditDays,
      everConfirmed: o.confirmedAt !== null || statuses.has(OrderStatus.CONFIRMED),
      deliveredAt: firstAt.get(`${o.id}|${OrderStatus.DELIVERED}`) ?? null,
      returnedAt: firstAt.get(`${o.id}|RETURNED`) ?? null,
      dispatched:
        statuses.has(OrderStatus.DISPATCHED) ||
        fate === 'returned' ||
        (fate === 'delivered' && o.status !== OrderStatus.LOST_IN_TRANSIT) ||
        o.status === OrderStatus.LOST_IN_TRANSIT,
      lines,
      retailInr: lines.reduce((t, l) => t.add((l.retailInr ?? ZERO).mul(l.quantity)), ZERO),
      transferInr: lines.reduce((t, l) => t.add((l.transferInr ?? ZERO).mul(l.quantity)), ZERO),
    };
  });
}

/**
 * The seller's unit cost of what was sold (RS-9 margin): the batch the
 * line was PICKED from when that is known, else the seller's latest batch
 * of the variant that carries a cost. Reads `stock_batches` directly, as
 * the seller credit valuation does — a report, never a stock write. A
 * line with neither is left unknown, never zero (TRE-6).
 */
export async function loadUnitCosts(
  db: Db,
  sellerId: string,
  lines: readonly OrderFactLine[],
): Promise<(line: OrderFactLine) => Prisma.Decimal | null> {
  const batchIds = [
    ...new Set(lines.map((l) => l.pickedBatchId).filter((x): x is string => x !== null)),
  ];
  const variantIds = [...new Set(lines.map((l) => l.variantId))];
  const byBatch = new Map<string, Prisma.Decimal>();
  const byVariant = new Map<string, Prisma.Decimal>();
  for (const part of chunks(batchIds)) {
    const rows = await db.stockBatch.findMany({
      where: { id: { in: part }, sellerId },
      select: { id: true, unitCostInr: true },
    });
    for (const r of rows) if (r.unitCostInr !== null) byBatch.set(r.id, r.unitCostInr);
  }
  for (const part of chunks(variantIds)) {
    const rows = await db.stockBatch.findMany({
      where: { sellerId, variantId: { in: part }, unitCostInr: { not: null } },
      select: { variantId: true, unitCostInr: true, receivedAt: true },
      orderBy: { receivedAt: 'desc' },
    });
    for (const r of rows) {
      if (r.unitCostInr !== null && !byVariant.has(r.variantId))
        byVariant.set(r.variantId, r.unitCostInr);
    }
  }
  return (line) =>
    (line.pickedBatchId === null ? undefined : byBatch.get(line.pickedBatchId)) ??
    byVariant.get(line.variantId) ??
    null;
}
