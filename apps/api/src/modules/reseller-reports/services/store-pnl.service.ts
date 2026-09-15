import { Injectable } from '@nestjs/common';
import { Prisma } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  buildStorePnl,
  expenseInstant,
  type LinkedEntryIn,
  type OrderSnapshotIn,
  type StorePnlReport,
} from './store-pnl-lines';

type Db = Prisma.TransactionClient;

const ZERO = new Prisma.Decimal(0);
const DAY_MS = 24 * 60 * 60 * 1000;
const IST_OFFSET_MS = 330 * 60_000;

/** UTC midnight of the Indian calendar day `d` falls on — how a `@db.Date` reads back. */
function istDateAsUtcMidnight(d: Date): Date {
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()));
}

/**
 * A reseller store's P&L over `[from, to)` (RS-8) — the loading half of
 * `store-pnl-lines.ts`, which does all the arithmetic.
 *
 * Every query carries the store id: a store reads only its own ledger,
 * its own expenses and the orders its own entries name. Reads the order
 * tables directly, as the platform P&L does — a report, never a
 * decision (ORD-3 governs writes).
 */
@Injectable()
export class StorePnlService {
  constructor(private readonly prisma: PrismaService) {}

  /** `db` — pass a transaction when the read happens inside one (a month close). */
  async report(storeId: string, from: Date, to: Date, db?: Db): Promise<StorePnlReport> {
    const client = db ?? this.prisma.client;
    // An expense is a calendar DAY; the date column is compared on day
    // bounds a little wider than the window and cut exactly below, so the
    // database never has to compare a date with an instant (whose meaning
    // would depend on the session's time zone).
    const lo = new Date(istDateAsUtcMidnight(from).getTime() - DAY_MS);
    const hi = new Date(istDateAsUtcMidnight(to).getTime() + DAY_MS);
    const [entries, expenses] = await Promise.all([
      client.storeWalletEntry.findMany({
        where: { storeId, createdAt: { gte: from, lt: to } },
        select: {
          id: true,
          direction: true,
          amount: true,
          shareOf: true,
          linkedOrderId: true,
          linkedEntryId: true,
          createdAt: true,
        },
        orderBy: { id: 'asc' },
      }),
      client.storeExpense.findMany({
        where: { storeId, deletedAt: null, expenseDate: { gte: lo, lt: hi } },
        select: { id: true, category: true, amountInr: true, expenseDate: true, description: true },
        orderBy: { id: 'asc' },
      }),
    ]);

    const linkedIds = [
      ...new Set(entries.map((e) => e.linkedEntryId).filter((x): x is string => x !== null)),
    ];
    const orderIds = [
      ...new Set(entries.map((e) => e.linkedOrderId).filter((x): x is string => x !== null)),
    ];
    const [linked, orders, items] = await Promise.all([
      linkedIds.length === 0
        ? Promise.resolve([])
        : client.storeWalletEntry.findMany({
            where: { id: { in: linkedIds }, storeId },
            select: { id: true, direction: true, shareOf: true },
          }),
      orderIds.length === 0
        ? Promise.resolve([])
        : client.order.findMany({
            where: { id: { in: orderIds }, storeId },
            select: { id: true, orderNumber: true },
          }),
      orderIds.length === 0
        ? Promise.resolve([])
        : client.orderItem.findMany({
            where: { orderId: { in: orderIds } },
            select: {
              orderId: true,
              quantity: true,
              resellerRetailUnitInr: true,
              resellerTransferPriceInr: true,
            },
          }),
    ]);

    const totals = new Map<string, { retail: Prisma.Decimal; transfer: Prisma.Decimal }>();
    for (const i of items) {
      const t = totals.get(i.orderId) ?? { retail: ZERO, transfer: ZERO };
      totals.set(i.orderId, {
        retail: t.retail.add((i.resellerRetailUnitInr ?? ZERO).mul(i.quantity)),
        transfer: t.transfer.add((i.resellerTransferPriceInr ?? ZERO).mul(i.quantity)),
      });
    }
    const orderMap = new Map<string, OrderSnapshotIn>(
      orders.map((o) => {
        const t = totals.get(o.id) ?? { retail: ZERO, transfer: ZERO };
        return [
          o.id,
          { id: o.id, orderNumber: o.orderNumber, retailInr: t.retail, transferInr: t.transfer },
        ];
      }),
    );
    const linkedMap = new Map<string, LinkedEntryIn>(linked.map((l) => [l.id, l]));

    return buildStorePnl({
      from,
      to,
      entries,
      linked: linkedMap,
      orders: orderMap,
      expenses: expenses.filter((x) => {
        const at = expenseInstant(x.expenseDate);
        return at >= from && at < to;
      }),
    });
  }
}
