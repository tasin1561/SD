import {
  Logger,
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Currency,
  ActorType,
  OrderStatus,
  Prisma,
  BankEntryType,
  BankOwnerKind,
} from '@skydrop/db';
import { CodCreditService } from '../../seller-wallet-accrual/services/cod-credit.service';
import { WalletService } from '../../seller-wallet/services/wallet.service';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import type { ClientContext } from '../../seller-auth/seller-auth.service';
import { BankLedgerService } from '../../treasury/services/bank-ledger.service';

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
  private readonly logger = new Logger(CourierSettlementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly codCredit: CodCreditService,
    private readonly wallet: WalletService,
    private readonly bank: BankLedgerService,
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
      select: {
        id: true,
        // Which of OUR accounts this courier's cash lands in, read in
        // the same query that proves the courier exists.
        payoutBankAccount: {
          select: { id: true, currency: true, isActive: true, deletedAt: true },
        },
      },
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

    const creditedSellers = new Set<string>();
    const shortfalls: Array<{
      orderId: string;
      expected: string;
      settled: string;
      shortfall: string;
    }> = [];

    let allocated = ZERO;
    const creditedBySeller = new Map<string, Prisma.Decimal>();
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

    // Which of these orders belong to a seller waiting on settlement to
    // be paid, and which were already paid at delivery under Instant Pay.
    const sellerByOrder = await this.prisma.client.order.findMany({
      where: { id: { in: input.lines.map((l) => l.orderId) } },
      select: { id: true, sellerId: true, codAmountInr: true },
    });

    // Which of OUR accounts the money landed in. A settlement with no
    // bank behind it is a number with no cash, and the coverage page
    // would read it as money we hold. Refused rather than skipped: the
    // fix is one link on the courier account, and a silently missing
    // bank entry is the exact failure this ledger exists to prevent.
    //
    // Read off the COURIER, which owns a single nullable FK, so "which
    // account" has exactly one answer. This used to search the bank
    // accounts for one naming this courier — an unordered `findFirst`
    // over a column whose cardinality was backwards, which meant one
    // account could serve only one courier AND two accounts naming the
    // same courier would send the cash to whichever row came back
    // first.
    const linked = account.payoutBankAccount;
    // Stated rather than filtered in the query: a link pointing at a
    // retired or foreign-currency account is a CONFIGURATION mistake,
    // and treating it as "no link" would send the operator to make one
    // that is already there.
    const receivingAccount =
      linked !== null &&
      linked.deletedAt === null &&
      linked.isActive &&
      linked.currency === Currency.INR
        ? linked
        : null;
    if (!receivingAccount) {
      throw new BadRequestException({
        code: 'SETTLEMENT_NO_RECEIVING_ACCOUNT',
        message:
          'No active INR bank account is linked to this courier account. ' +
          'Link one under Network → Bank accounts before recording what it paid.',
      });
    }

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

      // ── The credit ───────────────────────────────────────────────
      //
      // This REVERSES what SETL-1 originally said — that the settlement
      // ledger never writes a wallet entry. That rule was written when
      // sellers were paid at DELIVERED, i.e. BEFORE the settlement, so
      // its concern was not clawing back money already given. Now the
      // seller is paid FROM the settlement, so the settlement is the
      // trigger and the reasoning inverts.
      //
      // The seller is credited what the ORDER WAS WORTH, not what the
      // courier actually remitted. A short payment is our dispute with
      // the courier — the seller has no visibility into them and no
      // leverage, and absorbing that risk is the service. The
      // circuit breaker below is what stops us quietly funding a
      // systematic shortfall rather than an occasional error.
      for (const line of lineData) {
        const order = sellerByOrder.find((o) => o.id === line.orderId);
        if (!order) continue;
        const mode = await this.codCredit.resolveMode(order.sellerId);
        if (mode !== 'SETTLEMENT') continue; // already paid at delivery
        await this.codCredit.creditForOrder(tx, {
          orderId: order.id,
          sellerId: order.sellerId,
          grossInr: line.expectedInr,
          mode,
        });
        creditedSellers.add(order.sellerId);
        // What the bank now holds ON THEIR BEHALF is what we credited
        // them, not what the courier remitted — the difference is
        // absorbed below, out of capital.
        creditedBySeller.set(
          order.sellerId,
          (creditedBySeller.get(order.sellerId) ?? ZERO).add(line.expectedInr),
        );

        const shortfall = line.expectedInr.sub(line.settledInr);
        if (shortfall.gt(0)) {
          shortfalls.push({
            orderId: order.id,
            expected: line.expectedInr.toString(),
            settled: line.settledInr.toString(),
            shortfall: shortfall.toString(),
          });
        }
      }

      // ── The cash ─────────────────────────────────────────────────
      //
      // The wallet says what the seller is OWED; the bank book says
      // where the money actually is. Both are written here, in one
      // transaction, because a settlement that credits a wallet without
      // recording the cash behind it is how the coverage page comes to
      // report money we do not hold.
      //
      // Attribution: each seller is held what we CREDITED them. The
      // remainder goes to capital — positive when the courier paid for
      // Instant-Pay orders we already funded (a reimbursement), negative
      // when they short-paid and we absorbed it (SETL-1 / WAL-6). That
      // split is what keeps seller-held cash equal to wallet liability
      // and leaves the dispute sitting visibly against our own money.
      let attributed = ZERO;
      for (const [sellerId, held] of creditedBySeller) {
        attributed = attributed.add(held);
        await this.bank.post(
          {
            accountId: receivingAccount.id,
            type: BankEntryType.COURIER_SETTLEMENT,
            signedAmount: held,
            amountCurrency: Currency.INR,
            owner: { kind: BankOwnerKind.SELLER, sellerId },
            occurredAt: receivedAt,
            reference,
            settlementId: row.id,
            staffId,
            note: `COD settled by courier — ${reference}`,
          },
          tx,
        );
      }
      const toCapital = amount.sub(attributed);
      if (!toCapital.isZero()) {
        await this.bank.post(
          {
            accountId: receivingAccount.id,
            type: BankEntryType.COURIER_SETTLEMENT,
            signedAmount: toCapital,
            amountCurrency: Currency.INR,
            owner: { kind: BankOwnerKind.CAPITAL },
            occurredAt: receivedAt,
            reference,
            settlementId: row.id,
            staffId,
            note: toCapital.isNegative()
              ? `Shortfall absorbed on ${reference}`
              : `Ours from ${reference} — instant-pay reimbursement or unallocated`,
          },
          tx,
        );
      }

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

    // Balances are cached; the credits above changed them.
    for (const sellerId of creditedSellers) {
      await this.wallet.recomputeCacheAfterCommit(sellerId, Currency.INR, 'post-settlement-credit');
    }

    // ── The circuit breaker ──────────────────────────────────────────
    //
    // We pay sellers what their orders were worth and absorb the
    // difference. That is right for the occasional error and ruinous for
    // a systematic one: at ₹200 a parcel, a standing 5% shortfall eats a
    // quarter of the delivery fee. So a payout short by more than the
    // threshold audits CRITICAL and asks for a human, rather than
    // quietly funding it.
    //
    // The alternative — refusing to credit — would punish sellers for a
    // dispute they cannot see and have no leverage in.
    if (shortfalls.length > 0) {
      const totalShort = shortfalls.reduce((n, sf) => n + Number(sf.shortfall), 0);
      const totalExpected = shortfalls.reduce((n, sf) => n + Number(sf.expected), 0);
      const pct = totalExpected > 0 ? (totalShort / totalExpected) * 100 : 0;
      const threshold = await this.shortfallAlertPercent();
      await this.audit.log({
        actorType: ActorType.STAFF,
        staffUserId: staffId,
        action:
          pct > threshold
            ? 'wallet.courier_settlement.shortfall_breach'
            : 'wallet.courier_settlement.shortfall',
        entityType: 'courier_settlement',
        entityId: created.id,
        severity: pct > threshold ? 'CRITICAL' : 'MEDIUM',
        metadata: {
          reference,
          shortPaidOrders: shortfalls.length,
          totalShortfallInr: totalShort.toFixed(2),
          shortfallPercent: pct.toFixed(2),
          thresholdPercent: threshold.toFixed(2),
          // Sellers were credited in full regardless — this is our
          // exposure to recover from the courier, not theirs to absorb.
          absorbedByUs: true,
          lines: shortfalls.slice(0, 50),
        },
      });
      if (pct > threshold) {
        this.logger.error(
          { reference, totalShort, pct, threshold },
          'Courier settlement short by more than the alert threshold — sellers were paid in full; recover this from the courier',
        );
      }
    }

    return this.toView(created);
  }

  /** The point at which absorbing a shortfall stops being a rounding error. */
  private async shortfallAlertPercent(): Promise<number> {
    const row = await this.prisma.client.systemSetting.findUnique({
      where: { key: 'wallet.settlement_shortfall_alert_percent' },
      select: { valueDecimal: true },
    });
    return Number(row?.valueDecimal ?? 5);
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
