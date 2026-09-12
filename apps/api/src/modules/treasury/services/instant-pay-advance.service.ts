import { Injectable } from '@nestjs/common';
import {
  BankEntryType,
  BankOwnerKind,
  OrderStatus,
  Prisma,
  WalletEntryDirection,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

const ZERO = new Prisma.Decimal(0);
const DAY_MS = 86_400_000;

/**
 * The deductions a COD credit carries, and what gives them back. Netted
 * with the credit itself to give what actually reached the seller.
 */
const DEDUCTIONS = [
  WalletEntryDirection.GST_WITHHOLDING,
  WalletEntryDirection.COD_COLLECTION_FEE,
  WalletEntryDirection.INSTANT_PAY_FEE,
] as const;

export interface InstantPayAdvanceRow {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly sellerId: string;
  readonly sellerName: string;
  /**
   * Where the order is NOW. Usually DELIVERED; an RTO status means it
   * was returned after delivery and the courier has neither paid nor
   * reversed it — our cash is still out.
   */
  readonly currentStatus: OrderStatus;
  /** First DELIVERED order event. Null only for an order forced there with no event. */
  readonly deliveredAt: string | null;
  /** The unreversed COD credit that advanced the money. */
  readonly creditedAt: string;
  readonly codInr: string;
  /** COD − tax − fees (net of any deduction given back on an earlier reversal). */
  readonly netCreditedInr: string;
  /**
   * Cash we moved from capital to the seller for it. Below the credit when
   * part of the COD repaid a debt they already owed (TRE-8) — that part
   * needed no cash, it cleared a receivable. Zero when all of it did.
   */
  readonly frontedInr: string;
  readonly frontAccountId: string | null;
  readonly frontAccountLabel: string | null;
  readonly courierCode: string | null;
  readonly courierAccountId: string | null;
  readonly courierAccountLabel: string | null;
  /** Whole days since delivery (or the credit, if no delivery event exists). */
  readonly ageDays: number;
}

export interface InstantPayAdvanceGroup {
  readonly key: string | null;
  readonly label: string;
  readonly count: number;
  readonly codInr: string;
  readonly frontedInr: string;
}

export interface InstantPayAdvanceReport {
  readonly rows: readonly InstantPayAdvanceRow[];
  readonly count: number;
  readonly totalCodInr: string;
  readonly totalNetCreditedInr: string;
  readonly totalFrontedInr: string;
  readonly bySeller: readonly InstantPayAdvanceGroup[];
  readonly byCourierAccount: readonly InstantPayAdvanceGroup[];
}

export interface InstantPayAdvanceFilter {
  readonly sellerId?: string | undefined;
  readonly courierAccountId?: string | undefined;
}

/**
 * Money we have ADVANCED to sellers under Instant Pay and are still
 * waiting for the courier to pay us back.
 *
 * Instant Pay credits a seller's COD at delivery (WAL-5) and fronts the
 * cash out of capital (WAL-6); the courier's payout later repays capital.
 * Until it does, that money is ours and it is sitting with the courier.
 * The courier float on the liabilities page already counts it, mixed with
 * COD nobody has credited yet — this is the half that is OUR money at risk.
 *
 * ── WHICH orders ─────────────────────────────────────────────────────
 * Delivered, carrying a COD, with NO courier payout line, and credited:
 * more COD_COLLECTION than COD_REVERSAL entries (the same count
 * `CodCreditService.isCredited` uses). That combination is structural,
 * not a reading of a note: a settlement-mode credit is written INSIDE the
 * payout that pays the order, so it always has a line; the only path that
 * credits a COD with no payout behind it is Instant Pay. Neither the
 * INSTANT_PAY_FEE entry (absent at a 0% fee) nor the front pair (absent
 * when the whole COD repaid a debt) is present on every Instant Pay order,
 * so neither could be the test.
 *
 * The "no line" predicate is exactly the liabilities float's, so the
 * Instant Pay sub-line there is a SUBSET of the float by construction and
 * the two halves add up to it.
 *
 * ── EVER delivered, not delivered NOW ────────────────────────────────
 * DELIVERED → RTO_INITIATED is a real edge. Selected on the CURRENT
 * status, an Instant Pay order returned before the courier paid dropped
 * out of this list and out of the float at once, and the cash we fronted
 * was reported nowhere. So an order qualifies once it has EVER reached
 * DELIVERED (an `order_events` row) and stays until a payout line or a
 * COD reversal closes it: the credit stands and our cash is out whether
 * the courier eventually pays, or reverses it on a later payout.
 * `notDeliveredNow` names those orders so the liabilities float can
 * include exactly them (see `LiabilitiesService`).
 *
 * Derived on every read from append-only ledgers; nothing is stored.
 */
@Injectable()
export class InstantPayAdvanceService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The liabilities sub-line: how much, and on how many orders — and the
   * part of it on orders no longer DELIVERED (returned after delivery),
   * which the float's own delivered-now aggregate cannot see.
   */
  async summary(): Promise<{
    amount: Prisma.Decimal;
    count: number;
    notDeliveredNow: { amount: Prisma.Decimal; count: number };
  }> {
    const ids = await this.outstandingOrderIds(undefined);
    if (ids.length === 0) {
      return { amount: ZERO, count: 0, notDeliveredNow: { amount: ZERO, count: 0 } };
    }
    const [agg, moved] = await Promise.all([
      this.prisma.client.order.aggregate({
        where: { id: { in: ids } },
        _sum: { codAmountInr: true },
        _count: { _all: true },
      }),
      this.prisma.client.order.aggregate({
        where: { id: { in: ids }, status: { not: OrderStatus.DELIVERED } },
        _sum: { codAmountInr: true },
        _count: { _all: true },
      }),
    ]);
    return {
      amount: agg._sum.codAmountInr ?? ZERO,
      count: agg._count._all,
      notDeliveredNow: { amount: moved._sum.codAmountInr ?? ZERO, count: moved._count._all },
    };
  }

  async report(
    filter: InstantPayAdvanceFilter = {},
    now: Date = new Date(),
  ): Promise<InstantPayAdvanceReport> {
    const ids = await this.outstandingOrderIds(filter.sellerId);
    const all = ids.length === 0 ? [] : await this.rows(ids, now);
    const rows = (
      filter.courierAccountId === undefined
        ? all
        : all.filter((r) => r.courierAccountId === filter.courierAccountId)
    ).sort((a, b) => b.ageDays - a.ageDays || a.orderNumber.localeCompare(b.orderNumber));

    const sum = (pick: (r: InstantPayAdvanceRow) => string): Prisma.Decimal =>
      rows.reduce((acc, r) => acc.add(new Prisma.Decimal(pick(r))), ZERO);

    return {
      rows,
      count: rows.length,
      totalCodInr: sum((r) => r.codInr).toFixed(2),
      totalNetCreditedInr: sum((r) => r.netCreditedInr).toFixed(2),
      totalFrontedInr: sum((r) => r.frontedInr).toFixed(2),
      bySeller: group(rows, (r) => [r.sellerId, r.sellerName]),
      byCourierAccount: group(rows, (r) => [
        r.courierAccountId,
        r.courierAccountLabel ??
          (r.courierCode === null ? 'No courier recorded' : `${r.courierCode} (no account)`),
      ]),
    };
  }

  /**
   * Orders credited with no courier payout behind them. Grouped in the
   * database, so the set pulled back is only the credited ones.
   */
  private async outstandingOrderIds(sellerId: string | undefined): Promise<string[]> {
    const counts = await this.prisma.client.sellerWalletEntry.groupBy({
      by: ['linkedOrderId', 'direction'],
      where: {
        direction: { in: [WalletEntryDirection.COD_COLLECTION, WalletEntryDirection.COD_REVERSAL] },
        ...(sellerId === undefined ? {} : { sellerId }),
        linkedOrder: {
          // EVER delivered — see the class comment. The payout-line
          // predicate is the float's, unchanged.
          events: { some: { toStatus: OrderStatus.DELIVERED } },
          codAmountInr: { gt: 0 },
          courierSettlementLines: { none: {} },
        },
      },
      _count: { _all: true },
    });
    const net = new Map<string, number>();
    for (const c of counts) {
      if (c.linkedOrderId === null) continue;
      const delta = c.direction === WalletEntryDirection.COD_COLLECTION ? 1 : -1;
      net.set(c.linkedOrderId, (net.get(c.linkedOrderId) ?? 0) + delta * c._count._all);
    }
    return [...net].filter(([, n]) => n > 0).map(([id]) => id);
  }

  private async rows(ids: string[], now: Date): Promise<InstantPayAdvanceRow[]> {
    const [orders, entries, fronts, delivered] = await Promise.all([
      this.prisma.client.order.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          orderNumber: true,
          sellerId: true,
          status: true,
          codAmountInr: true,
          seller: { select: { companyName: true } },
          orderShipments: {
            select: {
              shipment: {
                select: {
                  courierCode: true,
                  courierAccountId: true,
                  awbNumber: true,
                  supersededAt: true,
                  deletedAt: true,
                  createdAt: true,
                  courierAccount: { select: { label: true } },
                },
              },
            },
          },
        },
      }),
      this.prisma.client.sellerWalletEntry.findMany({
        where: {
          linkedOrderId: { in: ids },
          direction: {
            in: [
              WalletEntryDirection.COD_COLLECTION,
              WalletEntryDirection.COD_REVERSAL,
              WalletEntryDirection.COD_DEDUCTION_REFUND,
              ...DEDUCTIONS,
            ],
          },
        },
        select: { linkedOrderId: true, direction: true, amount: true, createdAt: true },
      }),
      // The front is the SELLER half of the capital→seller pair
      // `SellerCashAttributionService.front` posts at delivery, referenced
      // by the order id — the one pair referenced by an order rather than
      // a wallet entry.
      this.prisma.client.bankEntry.findMany({
        where: {
          reference: { in: ids },
          type: BankEntryType.RECLASSIFICATION,
          ownerKind: BankOwnerKind.SELLER,
          signedAmount: { gt: 0 },
        },
        select: {
          reference: true,
          sellerId: true,
          signedAmount: true,
          accountId: true,
          account: { select: { label: true } },
        },
      }),
      this.prisma.client.orderEvent.findMany({
        where: { orderId: { in: ids }, toStatus: OrderStatus.DELIVERED },
        select: { orderId: true, createdAt: true },
      }),
    ]);

    const entriesBy = new Map<string, typeof entries>();
    for (const e of entries) {
      if (e.linkedOrderId === null) continue;
      entriesBy.set(e.linkedOrderId, [...(entriesBy.get(e.linkedOrderId) ?? []), e]);
    }
    const deliveredBy = new Map<string, Date>();
    for (const ev of delivered) {
      const prev = deliveredBy.get(ev.orderId);
      if (prev === undefined || ev.createdAt < prev) deliveredBy.set(ev.orderId, ev.createdAt);
    }

    return orders.map((o) => {
      const own = entriesBy.get(o.id) ?? [];
      let net = ZERO;
      let creditedAt: Date | null = null;
      for (const e of own) {
        switch (e.direction) {
          case WalletEntryDirection.COD_COLLECTION:
            net = net.add(e.amount);
            if (creditedAt === null || e.createdAt > creditedAt) creditedAt = e.createdAt;
            break;
          case WalletEntryDirection.COD_DEDUCTION_REFUND:
            net = net.add(e.amount);
            break;
          default:
            // COD_REVERSAL and the three deductions.
            net = net.sub(e.amount);
        }
      }

      const myFronts = fronts.filter((f) => f.reference === o.id && f.sellerId === o.sellerId);
      const fronted = myFronts.reduce((acc, f) => acc.add(f.signedAmount), ZERO);
      const frontAccount = myFronts[0] ?? null;

      const shipments = o.orderShipments
        .map((os) => os.shipment)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      const live =
        shipments.find(
          (s) => s.awbNumber !== null && s.supersededAt === null && s.deletedAt === null,
        ) ??
        shipments[0] ??
        null;

      const deliveredAt = deliveredBy.get(o.id) ?? null;
      const since = deliveredAt ?? creditedAt ?? now;
      return {
        orderId: o.id,
        orderNumber: o.orderNumber,
        sellerId: o.sellerId,
        sellerName: o.seller.companyName,
        currentStatus: o.status,
        deliveredAt: deliveredAt?.toISOString() ?? null,
        creditedAt: (creditedAt ?? now).toISOString(),
        codInr: (o.codAmountInr ?? ZERO).toFixed(2),
        netCreditedInr: net.toFixed(2),
        frontedInr: fronted.toFixed(2),
        frontAccountId: frontAccount?.accountId ?? null,
        frontAccountLabel: frontAccount?.account.label ?? null,
        courierCode: live?.courierCode ?? null,
        courierAccountId: live?.courierAccountId ?? null,
        courierAccountLabel: live?.courierAccount?.label ?? null,
        ageDays: Math.max(0, Math.floor((now.getTime() - since.getTime()) / DAY_MS)),
      };
    });
  }
}

function group(
  rows: readonly InstantPayAdvanceRow[],
  keyOf: (r: InstantPayAdvanceRow) => readonly [string | null, string],
): InstantPayAdvanceGroup[] {
  const out = new Map<
    string,
    { key: string | null; label: string; count: number; cod: Prisma.Decimal; front: Prisma.Decimal }
  >();
  for (const r of rows) {
    const [key, label] = keyOf(r);
    const g = out.get(key ?? '') ?? { key, label, count: 0, cod: ZERO, front: ZERO };
    g.count += 1;
    g.cod = g.cod.add(new Prisma.Decimal(r.codInr));
    g.front = g.front.add(new Prisma.Decimal(r.frontedInr));
    out.set(key ?? '', g);
  }
  return [...out.values()]
    .map((g) => ({
      key: g.key,
      label: g.label,
      count: g.count,
      codInr: g.cod.toFixed(2),
      frontedInr: g.front.toFixed(2),
    }))
    .sort((a, b) => Number(b.codInr) - Number(a.codInr));
}
