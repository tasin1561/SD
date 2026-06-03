import { Injectable } from '@nestjs/common';
import { OrderStatus, Prisma, WalletEntryDirection } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

/**
 * Phase 1B #3 — admin operational reports.
 *
 * Each metric is a single SQL aggregate over a date range. No
 * materialised views; the Phase-1A volume is small enough that
 * an on-demand aggregate is cheap. If query times grow >2s the
 * remediation is daily-cron rollups into a `report_daily_rollups`
 * table — out of scope for this batch.
 *
 * Range semantics: `from` inclusive, `to` exclusive (UTC).
 * If callers want "last 7 days" they pass (today-7d, today+1d).
 */

export interface DateRange {
  readonly from: Date;
  readonly to: Date;
}

export interface ReportSummary {
  readonly range: { readonly from: string; readonly to: string };
  readonly orders: {
    readonly created: number;
    readonly confirmed: number;
    readonly delivered: number;
    readonly rtoInitiated: number;
    readonly cancelled: number;
    readonly rejectedNdr: number;
    readonly confirmRate: number; // confirmed / created
    readonly ndrRate: number; // rejected_ndr / confirmed
    readonly rtoRate: number; // rto_initiated / dispatched
    readonly deliveryRate: number; // delivered / dispatched
  };
  readonly shipments: {
    readonly dispatched: number;
    readonly avgDispatchHoursFromConfirm: number | null;
    readonly avgDeliveryDaysFromDispatch: number | null;
  };
  readonly wallet: {
    readonly codCollected: string;
    readonly chargesDebited: string;
    readonly remittancesPaid: string;
    readonly netOutstanding: string;
  };
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(range: DateRange): Promise<ReportSummary> {
    const orders = await this.ordersBlock(range);
    const shipments = await this.shipmentsBlock(range);
    const wallet = await this.walletBlock(range);
    return {
      range: { from: range.from.toISOString(), to: range.to.toISOString() },
      orders,
      shipments,
      wallet,
    };
  }

  private async ordersBlock(
    range: DateRange,
  ): Promise<ReportSummary['orders']> {
    // Count by current status at end of window. For confirmRate we
    // want "of orders created in this window, how many reached
    // CONFIRMED at some point" — using current status as a proxy
    // (good enough at Phase 1A volume; an order_events query would
    // be more precise).
    const groups = await this.prisma.client.order.groupBy({
      by: ['status'],
      where: {
        createdAt: { gte: range.from, lt: range.to },
        deletedAt: null,
      },
      _count: { _all: true },
    });
    const map = new Map<OrderStatus, number>();
    for (const g of groups) map.set(g.status, g._count._all);

    const created = Array.from(map.values()).reduce((a, b) => a + b, 0);
    const get = (s: OrderStatus): number => map.get(s) ?? 0;

    // Confirmed = any order whose lifecycle reached or passed CONFIRMED.
    // Rough heuristic: count anything past pre-confirmation states.
    const postConfirmation =
      get(OrderStatus.CONFIRMED) +
      get(OrderStatus.PENDING_PICK) +
      get(OrderStatus.PICKED) +
      get(OrderStatus.PACKED) +
      get(OrderStatus.PACK_FAILED) +
      get(OrderStatus.PENDING_DISPATCH) +
      get(OrderStatus.PENDING_MANUAL_PLACEMENT) +
      get(OrderStatus.DISPATCHED) +
      get(OrderStatus.IN_TRANSIT) +
      get(OrderStatus.OUT_FOR_DELIVERY) +
      get(OrderStatus.DELIVERY_FAILED) +
      get(OrderStatus.DELIVERED) +
      get(OrderStatus.RTO_INITIATED) +
      get(OrderStatus.RTO_IN_TRANSIT) +
      get(OrderStatus.RTO_RECEIVED) +
      get(OrderStatus.RTO_RESTOCKED) +
      get(OrderStatus.RTO_DAMAGED) +
      get(OrderStatus.LOST_IN_TRANSIT);

    const dispatched =
      get(OrderStatus.DISPATCHED) +
      get(OrderStatus.IN_TRANSIT) +
      get(OrderStatus.OUT_FOR_DELIVERY) +
      get(OrderStatus.DELIVERY_FAILED) +
      get(OrderStatus.DELIVERED) +
      get(OrderStatus.RTO_INITIATED) +
      get(OrderStatus.RTO_IN_TRANSIT) +
      get(OrderStatus.RTO_RECEIVED) +
      get(OrderStatus.RTO_RESTOCKED) +
      get(OrderStatus.RTO_DAMAGED) +
      get(OrderStatus.LOST_IN_TRANSIT);

    const delivered = get(OrderStatus.DELIVERED);
    const rtoInitiated =
      get(OrderStatus.RTO_INITIATED) +
      get(OrderStatus.RTO_IN_TRANSIT) +
      get(OrderStatus.RTO_RECEIVED) +
      get(OrderStatus.RTO_RESTOCKED) +
      get(OrderStatus.RTO_DAMAGED);

    return {
      created,
      confirmed: postConfirmation,
      delivered,
      rtoInitiated,
      cancelled:
        get(OrderStatus.CANCELLED) + get(OrderStatus.CANCELLED_BY_ADMIN),
      rejectedNdr: get(OrderStatus.REJECTED_NDR),
      confirmRate: created > 0 ? postConfirmation / created : 0,
      ndrRate:
        postConfirmation > 0
          ? get(OrderStatus.REJECTED_NDR) / postConfirmation
          : 0,
      rtoRate: dispatched > 0 ? rtoInitiated / dispatched : 0,
      deliveryRate: dispatched > 0 ? delivered / dispatched : 0,
    };
  }

  private async shipmentsBlock(
    range: DateRange,
  ): Promise<ReportSummary['shipments']> {
    // Dispatch count + average dispatch / delivery times via raw SQL
    // — the AVG(EXTRACT EPOCH FROM ...) is cleaner as SQL than a
    // groupBy. Phase 1A volume keeps this fast.
    const result = await this.prisma.client.$queryRaw<
      Array<{
        dispatched: bigint;
        avg_dispatch_hours: number | null;
        avg_delivery_days: number | null;
      }>
    >(Prisma.sql`
      SELECT
        COUNT(*)::bigint AS dispatched,
        AVG(EXTRACT(EPOCH FROM (o.updated_at - o.confirmed_at)) / 3600.0)
          FILTER (
            WHERE o.confirmed_at IS NOT NULL
            AND o.status IN ('dispatched','in_transit','out_for_delivery','delivered','delivery_failed','rto_initiated','rto_in_transit','rto_received','rto_restocked')
          )::float AS avg_dispatch_hours,
        AVG(EXTRACT(EPOCH FROM (o.updated_at - o.confirmed_at)) / 86400.0)
          FILTER (WHERE o.status = 'delivered')::float AS avg_delivery_days
      FROM orders o
      WHERE o.created_at >= ${range.from}
        AND o.created_at < ${range.to}
        AND o.deleted_at IS NULL
    `);
    const row = result[0] ?? {
      dispatched: BigInt(0),
      avg_dispatch_hours: null,
      avg_delivery_days: null,
    };
    return {
      dispatched: Number(row.dispatched),
      avgDispatchHoursFromConfirm:
        row.avg_dispatch_hours === null
          ? null
          : Number(row.avg_dispatch_hours.toFixed(1)),
      avgDeliveryDaysFromDispatch:
        row.avg_delivery_days === null
          ? null
          : Number(row.avg_delivery_days.toFixed(1)),
    };
  }

  private async walletBlock(
    range: DateRange,
  ): Promise<ReportSummary['wallet']> {
    const entries = await this.prisma.client.sellerWalletEntry.groupBy({
      by: ['direction'],
      where: {
        createdAt: { gte: range.from, lt: range.to },
      },
      _sum: { amount: true },
    });
    const sum = (d: WalletEntryDirection): Prisma.Decimal => {
      const row = entries.find((e) => e.direction === d);
      return row?._sum.amount ?? new Prisma.Decimal(0);
    };
    const codCollected = sum(WalletEntryDirection.COD_COLLECTION);
    const chargesDebited = sum(WalletEntryDirection.ORDER_CHARGES);
    const remittancesPaid = sum(WalletEntryDirection.REMITTANCE_OUT);
    // Net outstanding = COD collected − charges − remittances (per
    // currency, but we sum INR here; the page can break this out
    // by currency in a future iteration).
    const netOutstanding = codCollected.sub(chargesDebited).sub(remittancesPaid);
    return {
      codCollected: codCollected.toFixed(2),
      chargesDebited: chargesDebited.toFixed(2),
      remittancesPaid: remittancesPaid.toFixed(2),
      netOutstanding: netOutstanding.toFixed(2),
    };
  }
}
