import { Injectable } from '@nestjs/common';
import { Currency, OrderStatus, Prisma, ShipmentStatus, WalletEntryDirection } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { ReportsService } from './reports.service';

export const OPS_METRICS = [
  'orders_created',
  'orders_delivered',
  'orders_returned',
  'orders_failed',
  'cod_collected',
] as const;
export type OpsMetric = (typeof OPS_METRICS)[number];

export const OPS_GROUPINGS = ['none', 'day', 'client', 'courier'] as const;
export type OpsGrouping = (typeof OPS_GROUPINGS)[number];

/** A refusal the tool turns into INVALID_INPUT, with words the model can repeat. */
export class OpsMetricsInputError extends Error {}

export interface OpsMetricsResult {
  readonly metric: OpsMetric;
  readonly from: string;
  readonly to: string;
  readonly groupBy: OpsGrouping;
  /** A count of orders, or rupees for `cod_collected`. */
  readonly unit: 'orders' | 'shipments' | 'INR';
  readonly total: string;
  readonly rows: ReadonlyArray<{ readonly key: string; readonly value: string }>;
  readonly note: string | null;
}

/** The same status groupings `ReportsService.ordersBlock` uses for the Reports page. */
const RETURNED: readonly OrderStatus[] = [
  OrderStatus.RTO_INITIATED,
  OrderStatus.RTO_IN_TRANSIT,
  OrderStatus.RTO_RECEIVED,
  OrderStatus.RTO_RESTOCKED,
  OrderStatus.RTO_DAMAGED,
];
const ORDER_STATUSES: Partial<Record<OpsMetric, readonly OrderStatus[]>> = {
  orders_delivered: [OrderStatus.DELIVERED],
  orders_returned: RETURNED,
  orders_failed: [OrderStatus.REJECTED_NDR],
};
const SHIPMENT_STATUSES: Partial<Record<OpsMetric, readonly ShipmentStatus[]>> = {
  orders_delivered: [ShipmentStatus.DELIVERED],
  orders_returned: [
    ShipmentStatus.RTO_INITIATED,
    ShipmentStatus.RTO_IN_TRANSIT,
    ShipmentStatus.RTO_DELIVERED,
  ],
};

const MAX_DAYS = 92;
const MAX_ROWS = 50_000;
const MAX_GROUPS = 20;
const DAY_MS = 24 * 60 * 60 * 1000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function parseDay(value: string, label: string): Date {
  const v = value.trim();
  const d = ISO_DAY.test(v) ? new Date(`${v}T00:00:00.000Z`) : null;
  if (d === null || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) {
    throw new OpsMetricsInputError(`${label} must be a real date written YYYY-MM-DD.`);
  }
  return d;
}

/**
 * A SMALL, FIXED set of operations numbers for the staff assistant.
 *
 * ── NO FREE QUERY ────────────────────────────────────────────────────
 * The caller names a metric from five, a grouping from four and a date
 * range; every one is checked against a list here. There is no SQL text,
 * no column name and no filter that comes from the model. Staff who hold
 * `reports.view` already see every client on the Reports page, so
 * grouping by client discloses nothing they cannot open; the tool is
 * offered ONLY to holders of that key.
 *
 * ── SAME NUMBERS AS THE PAGE ─────────────────────────────────────────
 * With no grouping the answer is `ReportsService.summary` — the exact call
 * `GET /admin/reports/summary` makes. The groupings count the same status
 * sets the page counts (delivered, the five RTO states, REJECTED_NDR), by
 * the same `created_at` window, so a total here equals the page's.
 * Courier grouping counts SHIPMENTS (an order has no courier of its own),
 * for delivered and returned only; COD collected has no courier and no
 * `orders_failed` shipment meaning, and says so rather than guessing.
 *
 * Range: `from` and `to` are both INCLUSIVE days (UTC), at most 92 days.
 * Read-only. Money is read, never moved.
 */
@Injectable()
export class ReportsAssistantReadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reports: ReportsService,
  ) {}

  async run(input: {
    metric: OpsMetric;
    from: string;
    to: string;
    groupBy: OpsGrouping;
  }): Promise<OpsMetricsResult> {
    const from = parseDay(input.from, 'from');
    const toDay = parseDay(input.to, 'to');
    if (toDay < from) throw new OpsMetricsInputError('to must not be before from.');
    const to = new Date(toDay.getTime() + DAY_MS);
    if ((to.getTime() - from.getTime()) / DAY_MS > MAX_DAYS) {
      throw new OpsMetricsInputError(`Ask for at most ${MAX_DAYS} days at a time.`);
    }
    const head = { metric: input.metric, from: input.from, to: input.to, groupBy: input.groupBy };
    const range = { from, to };

    if (input.groupBy === 'none') return this.ungrouped(head, range);
    if (input.groupBy === 'courier') return this.byCourier(head, range);
    return input.metric === 'cod_collected'
      ? this.codGrouped(head, range)
      : this.ordersGrouped(head, range);
  }

  private async ungrouped(
    head: Pick<OpsMetricsResult, 'metric' | 'from' | 'to' | 'groupBy'>,
    range: { from: Date; to: Date },
  ): Promise<OpsMetricsResult> {
    const s = await this.reports.summary(range);
    const pick: Record<OpsMetric, string> = {
      orders_created: String(s.orders.created),
      orders_delivered: String(s.orders.delivered),
      orders_returned: String(s.orders.rtoInitiated),
      orders_failed: String(s.orders.rejectedNdr),
      cod_collected: s.wallet.codCollected,
    };
    return {
      ...head,
      unit: head.metric === 'cod_collected' ? 'INR' : 'orders',
      total: pick[head.metric],
      rows: [],
      note: null,
    };
  }

  private async ordersGrouped(
    head: Pick<OpsMetricsResult, 'metric' | 'from' | 'to' | 'groupBy'>,
    range: { from: Date; to: Date },
  ): Promise<OpsMetricsResult> {
    const statuses = ORDER_STATUSES[head.metric];
    const where: Prisma.OrderWhereInput = {
      createdAt: { gte: range.from, lt: range.to },
      deletedAt: null,
      ...(statuses === undefined ? {} : { status: { in: [...statuses] } }),
    };
    if (head.groupBy === 'client') {
      const groups = await this.prisma.client.order.groupBy({
        by: ['sellerId'],
        where,
        _count: { _all: true },
      });
      const top = groups.sort((a, b) => b._count._all - a._count._all).slice(0, MAX_GROUPS);
      const names = await this.prisma.client.seller.findMany({
        where: { id: { in: top.map((g) => g.sellerId) } },
        select: { id: true, companyName: true },
      });
      const nameOf = new Map(names.map((n) => [n.id, n.companyName]));
      const total = groups.reduce((a, g) => a + g._count._all, 0);
      return {
        ...head,
        unit: 'orders',
        total: String(total),
        rows: top.map((g) => ({
          key: nameOf.get(g.sellerId) ?? 'Unknown client',
          value: String(g._count._all),
        })),
        note: groups.length > MAX_GROUPS ? `Top ${MAX_GROUPS} clients of ${groups.length}.` : null,
      };
    }
    // day
    const rows = await this.prisma.client.order.findMany({
      where,
      select: { createdAt: true },
      take: MAX_ROWS + 1,
    });
    const capped = rows.length > MAX_ROWS;
    const perDay = new Map<string, number>();
    for (const r of rows.slice(0, MAX_ROWS)) {
      const k = r.createdAt.toISOString().slice(0, 10);
      perDay.set(k, (perDay.get(k) ?? 0) + 1);
    }
    return {
      ...head,
      unit: 'orders',
      total: String(Math.min(rows.length, MAX_ROWS)),
      rows: [...perDay.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, n]) => ({ key, value: String(n) })),
      note: capped ? 'Too many orders to list by day; the figures are cut short.' : null,
    };
  }

  private async byCourier(
    head: Pick<OpsMetricsResult, 'metric' | 'from' | 'to' | 'groupBy'>,
    range: { from: Date; to: Date },
  ): Promise<OpsMetricsResult> {
    if (head.metric === 'cod_collected' || head.metric === 'orders_failed') {
      throw new OpsMetricsInputError(
        'That number cannot be split by courier. Use no grouping, day or client.',
      );
    }
    const statuses = SHIPMENT_STATUSES[head.metric];
    const groups = await this.prisma.client.shipment.groupBy({
      by: ['courierCode'],
      where: {
        createdAt: { gte: range.from, lt: range.to },
        deletedAt: null,
        ...(statuses === undefined ? {} : { status: { in: [...statuses] } }),
      },
      _count: { _all: true },
    });
    return {
      ...head,
      unit: 'shipments',
      total: String(groups.reduce((a, g) => a + g._count._all, 0)),
      rows: groups
        .sort((a, b) => b._count._all - a._count._all)
        .map((g) => ({ key: g.courierCode, value: String(g._count._all) })),
      note: 'Counted in parcels (shipments), by the date each parcel was created.',
    };
  }

  private async codGrouped(
    head: Pick<OpsMetricsResult, 'metric' | 'from' | 'to' | 'groupBy'>,
    range: { from: Date; to: Date },
  ): Promise<OpsMetricsResult> {
    const where: Prisma.SellerWalletEntryWhereInput = {
      createdAt: { gte: range.from, lt: range.to },
      direction: WalletEntryDirection.COD_COLLECTION,
      currency: Currency.INR,
    };
    if (head.groupBy === 'client') {
      const groups = await this.prisma.client.sellerWalletEntry.groupBy({
        by: ['sellerId'],
        where,
        _sum: { amount: true },
      });
      const sum = (g: (typeof groups)[number]): Prisma.Decimal =>
        g._sum.amount ?? new Prisma.Decimal(0);
      const top = groups.sort((a, b) => sum(b).comparedTo(sum(a))).slice(0, MAX_GROUPS);
      const names = await this.prisma.client.seller.findMany({
        where: { id: { in: top.map((g) => g.sellerId) } },
        select: { id: true, companyName: true },
      });
      const nameOf = new Map(names.map((n) => [n.id, n.companyName]));
      return {
        ...head,
        unit: 'INR',
        total: groups.reduce((a, g) => a.add(sum(g)), new Prisma.Decimal(0)).toFixed(2),
        rows: top.map((g) => ({
          key: nameOf.get(g.sellerId) ?? 'Unknown client',
          value: sum(g).toFixed(2),
        })),
        note: groups.length > MAX_GROUPS ? `Top ${MAX_GROUPS} clients of ${groups.length}.` : null,
      };
    }
    const entries = await this.prisma.client.sellerWalletEntry.findMany({
      where,
      select: { createdAt: true, amount: true },
      take: MAX_ROWS + 1,
    });
    const capped = entries.length > MAX_ROWS;
    const perDay = new Map<string, Prisma.Decimal>();
    for (const e of entries.slice(0, MAX_ROWS)) {
      const k = e.createdAt.toISOString().slice(0, 10);
      perDay.set(k, (perDay.get(k) ?? new Prisma.Decimal(0)).add(e.amount));
    }
    const total = [...perDay.values()].reduce((a, v) => a.add(v), new Prisma.Decimal(0));
    return {
      ...head,
      unit: 'INR',
      total: total.toFixed(2),
      rows: [...perDay.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, v]) => ({ key, value: v.toFixed(2) })),
      note: capped ? 'Too many entries to list by day; the figures are cut short.' : null,
    };
  }
}
