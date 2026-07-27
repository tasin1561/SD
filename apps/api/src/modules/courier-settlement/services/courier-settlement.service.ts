import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ActorType, OrderStatus, Prisma } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import type { ClientContext } from '../../seller-auth/seller-auth.service';

export interface SettlementLineInput {
  readonly orderId: string;
  readonly settledInr: string;
  readonly note?: string | null;
}

export interface RecordSettlementInput {
  readonly courierAccountId: string;
  readonly reference: string;
  readonly amountInr: string;
  readonly receivedAt: string;
  readonly lines: readonly SettlementLineInput[];
  readonly note?: string | null;
}

export interface SettlementLineView {
  readonly orderId: string;
  readonly orderNumber: string | null;
  readonly expectedInr: string;
  readonly settledInr: string;
  /** settled − expected. Negative ⇒ the courier short-paid this order. */
  readonly varianceInr: string;
}

export interface SettlementView {
  readonly id: string;
  readonly courierAccountId: string;
  readonly reference: string;
  readonly amountInr: string;
  readonly allocatedInr: string;
  /** amount − allocated. Non-zero ⇒ the payout isn't fully explained. */
  readonly unallocatedInr: string;
  readonly receivedAt: Date;
  readonly note: string | null;
  readonly lines: readonly SettlementLineView[];
  readonly createdAt: Date;
}

export interface UnsettledOrderRow {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly sellerId: string;
  readonly deliveredAt: Date | null;
  readonly ageDays: number;
  readonly expectedInr: string;
  readonly settledInr: string;
  readonly shortfallInr: string;
}

export interface ReconciliationReport {
  readonly generatedAt: Date;
  readonly overdueAfterDays: number;
  /** COD we are owed on delivered orders that no payout covers yet. */
  readonly outstandingFloatInr: string;
  /** Of that, the part already past the expected settlement window. */
  readonly overdueInr: string;
  readonly overdueOrders: readonly UnsettledOrderRow[];
  /** Orders a payout touched but under-paid. */
  readonly shortPaidOrders: readonly UnsettledOrderRow[];
}

const ZERO = new Prisma.Decimal(0);

/**
 * R2c — the courier settlement ledger.
 *
 * Delhivery collects the customer's cash at delivery and pays Skydrop
 * 5-10 days later. Sellers are credited from OUR balance in the meantime,
 * so until this existed the business had no way to answer the only
 * question that matters about that gap: have we actually been paid for
 * what we already paid out?
 *
 * Three failure modes this makes visible, none of which were detectable
 * before:
 *  - The courier pays LESS than the COD they collected (weight disputes,
 *    their own deductions). `settledInr - expectedInr` per order.
 *  - A payout never arrives at all. The reconciliation report ages
 *    delivered-but-unsettled orders.
 *  - A payout arrives that we cannot fully explain. `amountInr` vs
 *    `allocatedInr` on the settlement itself.
 *
 * Recording is APPEND-MOSTLY: a settlement is a historical fact about a
 * bank credit. A mistake is corrected by recording an adjusting
 * settlement, never by editing a past one — the same discipline the wallet
 * ledger uses.
 */
@Injectable()
export class CourierSettlementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  /**
   * Record one payout and allocate it across the orders it covers.
   *
   * Idempotent on `(courierAccountId, reference)` — the courier's own
   * payout reference — so re-submitting the same bank credit is a 409, not
   * a second row that would double-count what we have been paid.
   */
  async record(
    staffId: string,
    input: RecordSettlementInput,
    ctx?: ClientContext,
  ): Promise<SettlementView> {
    const amount = this.parseMoney(input.amountInr, 'amountInr');
    const receivedAt = new Date(input.receivedAt);
    if (Number.isNaN(receivedAt.getTime())) {
      throw new BadRequestException({
        code: 'SETTLEMENT_RECEIVED_AT_INVALID',
        message: `'${input.receivedAt}' is not a valid date`,
      });
    }
    const reference = input.reference.trim();
    if (reference.length === 0) {
      throw new BadRequestException({
        code: 'SETTLEMENT_REFERENCE_REQUIRED',
        message:
          "The courier's payout reference is required — it is what makes recording idempotent",
      });
    }

    const account = await this.prisma.client.courierAccount.findFirst({
      where: { id: input.courierAccountId, deletedAt: null },
      select: { id: true },
    });
    if (!account) {
      throw new NotFoundException({
        code: 'COURIER_ACCOUNT_NOT_FOUND',
        message: `Courier account ${input.courierAccountId} not found`,
      });
    }

    const duplicate = await this.prisma.client.courierSettlement.findUnique({
      where: {
        courierAccountId_reference: {
          courierAccountId: input.courierAccountId,
          reference,
        },
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new ConflictException({
        code: 'SETTLEMENT_ALREADY_RECORDED',
        message: `Payout '${reference}' is already recorded for this courier account`,
        cause: { settlementId: duplicate.id },
      });
    }

    const dupOrders = input.lines
      .map((l) => l.orderId)
      .filter((id, i, all) => all.indexOf(id) !== i);
    if (dupOrders.length > 0) {
      throw new BadRequestException({
        code: 'SETTLEMENT_ORDER_REPEATED',
        message: `Order(s) listed twice in one payout: ${[...new Set(dupOrders)].join(', ')}`,
      });
    }

    // Snapshot each order's expected COD now, so the variance stays a
    // permanent fact about this payout even if the order changes later.
    const orders = await this.prisma.client.order.findMany({
      where: { id: { in: input.lines.map((l) => l.orderId) } },
      select: { id: true, orderNumber: true, codAmountInr: true },
    });
    const byId = new Map(orders.map((o) => [o.id, o]));
    const missing = input.lines.filter((l) => !byId.has(l.orderId));
    if (missing.length > 0) {
      throw new NotFoundException({
        code: 'SETTLEMENT_ORDER_NOT_FOUND',
        message: `${missing.length} order(s) in this payout do not exist`,
        cause: missing.map((l) => l.orderId),
      });
    }

    let allocated = ZERO;
    const lineData = input.lines.map((line) => {
      const settled = this.parseMoney(line.settledInr, `line ${line.orderId}`);
      allocated = allocated.add(settled);
      return {
        orderId: line.orderId,
        expectedInr: byId.get(line.orderId)?.codAmountInr ?? ZERO,
        settledInr: settled,
        note: line.note ?? null,
      };
    });

    const created = await this.prisma.client.$transaction(async (tx) => {
      const row = await tx.courierSettlement.create({
        data: {
          courierAccountId: input.courierAccountId,
          reference,
          amountInr: amount,
          allocatedInr: allocated,
          receivedAt,
          recordedByStaffId: staffId,
          note: input.note ?? null,
          lines: { create: lineData },
        },
        include: {
          lines: { include: { order: { select: { orderNumber: true } } } },
        },
      });

      await this.audit.log(
        {
          actorType: ActorType.STAFF,
          staffUserId: staffId,
          action: 'wallet.courier_settlement.recorded',
          entityType: 'courier_settlement',
          entityId: row.id,
          // MEDIUM normally; HIGH when the payout does not add up, because
          // an unexplained difference between what landed in the bank and
          // what we attributed is exactly what this ledger exists to catch.
          severity: amount.eq(allocated) ? 'MEDIUM' : 'HIGH',
          metadata: {
            courierAccountId: input.courierAccountId,
            reference,
            amountInr: amount.toString(),
            allocatedInr: allocated.toString(),
            unallocatedInr: amount.sub(allocated).toString(),
            orderCount: lineData.length,
            ipAddress: ctx?.ipAddress ?? null,
            userAgent: ctx?.userAgent ?? null,
            requestId: ctx?.requestId ?? null,
          },
        },
        tx,
      );
      return row;
    });

    return this.toView(created);
  }

  async list(query: {
    courierAccountId?: string;
    limit?: number;
  }): Promise<readonly SettlementView[]> {
    const rows = await this.prisma.client.courierSettlement.findMany({
      where:
        query.courierAccountId === undefined ? {} : { courierAccountId: query.courierAccountId },
      include: { lines: { include: { order: { select: { orderNumber: true } } } } },
      orderBy: { receivedAt: 'desc' },
      take: Math.min(query.limit ?? 50, 200),
    });
    return rows.map((r) => this.toView(r));
  }

  async getById(settlementId: string): Promise<SettlementView> {
    const row = await this.prisma.client.courierSettlement.findUnique({
      where: { id: settlementId },
      include: { lines: { include: { order: { select: { orderNumber: true } } } } },
    });
    if (!row) {
      throw new NotFoundException({
        code: 'SETTLEMENT_NOT_FOUND',
        message: `Settlement ${settlementId} not found`,
      });
    }
    return this.toView(row);
  }

  /**
   * The report that makes the float countable: COD we are owed on
   * delivered orders, how much of it is past the expected settlement
   * window, and which orders a payout under-paid.
   *
   * Read-only. It never adjusts a wallet — a short-payment is a
   * conversation with the courier, not something to silently claw back
   * from a seller.
   */
  async reconciliation(opts: { overdueAfterDays?: number } = {}): Promise<ReconciliationReport> {
    const overdueAfterDays = opts.overdueAfterDays ?? 10;
    const now = new Date();
    const cutoff = new Date(now.getTime() - overdueAfterDays * 86_400_000);

    // Delivered COD orders and whatever has been settled against them.
    const delivered = await this.prisma.client.order.findMany({
      where: {
        status: OrderStatus.DELIVERED,
        codAmountInr: { gt: 0 },
        deletedAt: null,
      },
      select: {
        id: true,
        orderNumber: true,
        sellerId: true,
        codAmountInr: true,
        updatedAt: true,
        courierSettlementLines: { select: { settledInr: true } },
      },
      take: 2_000,
    });

    let outstanding = ZERO;
    let overdueTotal = ZERO;
    const overdueOrders: UnsettledOrderRow[] = [];
    const shortPaidOrders: UnsettledOrderRow[] = [];

    for (const order of delivered) {
      const expected = order.codAmountInr ?? ZERO;
      const settled = order.courierSettlementLines.reduce((sum, l) => sum.add(l.settledInr), ZERO);
      const shortfall = expected.sub(settled);
      if (shortfall.lte(0)) continue;

      // `updatedAt` is the best delivered-at proxy available on the order
      // itself; the exact scan time lives in tracking_events, which this
      // report deliberately does not join (it would turn a finance report
      // into a hypertable scan).
      const deliveredAt = order.updatedAt;
      const ageDays = Math.floor((now.getTime() - deliveredAt.getTime()) / 86_400_000);
      const row: UnsettledOrderRow = {
        orderId: order.id,
        orderNumber: order.orderNumber,
        sellerId: order.sellerId,
        deliveredAt,
        ageDays,
        expectedInr: expected.toString(),
        settledInr: settled.toString(),
        shortfallInr: shortfall.toString(),
      };

      outstanding = outstanding.add(shortfall);
      if (settled.gt(0)) {
        // A payout touched it and still left money on the table — chase
        // this one regardless of age.
        shortPaidOrders.push(row);
      }
      if (deliveredAt < cutoff) {
        overdueTotal = overdueTotal.add(shortfall);
        overdueOrders.push(row);
      }
    }

    overdueOrders.sort((a, b) => b.ageDays - a.ageDays);

    return {
      generatedAt: now,
      overdueAfterDays,
      outstandingFloatInr: outstanding.toString(),
      overdueInr: overdueTotal.toString(),
      overdueOrders: overdueOrders.slice(0, 500),
      shortPaidOrders: shortPaidOrders.slice(0, 500),
    };
  }

  // ── internal ──────────────────────────────────────────────────────

  private parseMoney(raw: string, label: string): Prisma.Decimal {
    let value: Prisma.Decimal;
    try {
      value = new Prisma.Decimal(raw);
    } catch {
      throw new BadRequestException({
        code: 'SETTLEMENT_AMOUNT_INVALID',
        message: `${label}: '${raw}' is not a valid amount`,
      });
    }
    if (!value.isFinite() || value.lt(0)) {
      throw new BadRequestException({
        code: 'SETTLEMENT_AMOUNT_INVALID',
        message: `${label}: amount cannot be negative`,
      });
    }
    return value.toDecimalPlaces(2);
  }

  private toView(
    row: Prisma.CourierSettlementGetPayload<{
      include: { lines: { include: { order: { select: { orderNumber: true } } } } };
    }>,
  ): SettlementView {
    return {
      id: row.id,
      courierAccountId: row.courierAccountId,
      reference: row.reference,
      amountInr: row.amountInr.toString(),
      allocatedInr: row.allocatedInr.toString(),
      unallocatedInr: row.amountInr.sub(row.allocatedInr).toString(),
      receivedAt: row.receivedAt,
      note: row.note,
      lines: row.lines.map((l) => ({
        orderId: l.orderId,
        orderNumber: l.order?.orderNumber ?? null,
        expectedInr: l.expectedInr.toString(),
        settledInr: l.settledInr.toString(),
        varianceInr: l.settledInr.sub(l.expectedInr).toString(),
      })),
      createdAt: row.createdAt,
    };
  }
}
