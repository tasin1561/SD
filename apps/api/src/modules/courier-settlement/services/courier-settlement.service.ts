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
  CourierRechargeMatch,
} from '@skydrop/db';
import { CodCreditService } from '../../seller-wallet-accrual/services/cod-credit.service';
import { WalletService } from '../../seller-wallet/services/wallet.service';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import type { ClientContext } from '../../seller-auth/seller-auth.service';
import { BankLedgerService } from '../../treasury/services/bank-ledger.service';
import { SellerCashAttributionService } from '../../treasury/services/seller-cash-attribution.service';
import { AdvisoryLock, takeAdvisoryLock } from '../../../common/db/advisory-lock';

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
  /** What the courier kept back from the COD before paying — from its remittance file. */
  readonly deductions?: {
    readonly earlyCodFeeInr?: string | null;
    readonly freightInr?: string | null;
    readonly rtoReversalInr?: string | null;
    /** The orders an RTO reversal takes COD back for — required when there is one. */
    readonly rtoReversals?: ReadonlyArray<{ orderId: string; amountInr: string }> | null;
  } | null;
  readonly note?: string | null;
}

/**
 * The COD shortfall a payout line RECOGNISES: whatever brings the order's
 * total recognised shortfall to what it should now be.
 *
 * That target is how far short of its COD the courier has paid net (0
 * when paid in full or over) — or 0 on a REVERSAL line, because once the
 * COD is taken back the seller's credit goes with it and nothing is lost.
 * So a first short line recognises the whole gap, a later payment making
 * it up recognises a recovery, a reversal of a short-paid order recovers
 * what was absorbed, and a re-payment after a reversal starts afresh.
 * Across an order's lines the recognised amounts always sum to the
 * target, whatever order the lines arrive in.
 */
export function recognisedShortfall(input: {
  readonly expected: Prisma.Decimal;
  readonly priorPaid: Prisma.Decimal;
  readonly priorRecognised: Prisma.Decimal;
  readonly settled: Prisma.Decimal;
  readonly reversal: boolean;
}): Prisma.Decimal {
  const gap = input.expected.sub(input.priorPaid.add(input.settled));
  const target = input.reversal || gap.lessThanOrEqualTo(0) ? ZERO : gap;
  return target.sub(input.priorRecognised);
}

/**
 * The expense category an early-COD fee is booked under. Created on first
 * use (and seeded), so recording a payout never depends on somebody
 * having set up a category first.
 */
export const COD_FEE_EXPENSE_CATEGORY = 'courier_cod_fees';

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
  /** What the courier kept back, by kind, and in total. */
  readonly earlyCodFeeInr: string;
  readonly freightDeductedInr: string;
  readonly rtoReversalInr: string;
  readonly keptBackInr: string;
  /**
   * amount + early-COD fee + freight − allocated. Non-zero ⇒ the payout
   * isn't fully explained. An RTO reversal is not added here: it is a
   * NEGATIVE line, so it is already inside what was allocated.
   */
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
const NO_PRIOR = { paid: ZERO, recognised: ZERO } as const;

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
    private readonly attribution: SellerCashAttributionService,
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
    // What the courier kept back. Blank means none.
    const deduction = (v: string | null | undefined, label: string): Prisma.Decimal =>
      v === undefined || v === null || v.trim() === '' ? ZERO : this.parseMoney(v, label);
    const earlyCodFee = deduction(input.deductions?.earlyCodFeeInr, 'early-COD fee');
    const freightKept = deduction(input.deductions?.freightInr, 'freight kept back');
    // An RTO reversal takes back COD a seller was credited, so it must NAME
    // the orders: each is reversed exactly (the seller debited back, our
    // deductions returned). A total with no orders cannot be booked
    // accurately and is refused rather than absorbed.
    const rtoReversals = (input.deductions?.rtoReversals ?? []).map((r) => ({
      orderId: r.orderId,
      amount: this.parseMoney(r.amountInr, `RTO reversal for order ${r.orderId}`),
    }));
    const rtoNamed = rtoReversals.reduce((t, r) => t.add(r.amount), ZERO);
    const rtoStated = deduction(input.deductions?.rtoReversalInr, 'RTO reversal kept back');
    if (rtoStated.gt(0) && rtoReversals.length === 0) {
      throw new BadRequestException({
        code: 'SETTLEMENT_RTO_REVERSAL_ORDERS_REQUIRED',
        message:
          'An RTO reversal takes back COD a seller was credited — name the order(s) it reverses ' +
          '(their file flags them) so each can be taken back exactly.',
      });
    }
    if (rtoReversals.length > 0 && rtoStated.gt(0) && !rtoStated.equals(rtoNamed)) {
      throw new BadRequestException({
        code: 'SETTLEMENT_RTO_REVERSAL_TOTAL_MISMATCH',
        message: `The RTO reversal is ₹${rtoStated.toFixed(2)} but the orders named add up to ₹${rtoNamed.toFixed(2)}.`,
      });
    }
    const dupReversal = rtoReversals
      .map((r) => r.orderId)
      .filter((id, i, all) => all.indexOf(id) !== i);
    if (dupReversal.length > 0) {
      throw new BadRequestException({
        code: 'SETTLEMENT_ORDER_REPEATED',
        message: `Order(s) reversed twice in one payout: ${[...new Set(dupReversal)].join(', ')}`,
      });
    }
    const rtoKept = rtoNamed;
    // What explains the gap between what landed and the COD the payout
    // covers. The RTO reversal is not in it: it is a NEGATIVE line, so it
    // is already inside what was allocated.
    const keptBack = earlyCodFee.add(freightKept);
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
        courier: { select: { code: true } },
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
    const lineIds = input.lines.map((l) => l.orderId);
    const reversedIds = rtoReversals.map((r) => r.orderId);
    const orders = await this.prisma.client.order.findMany({
      where: { id: { in: [...lineIds, ...reversedIds] } },
      select: { id: true, orderNumber: true, codAmountInr: true, sellerId: true },
    });
    const byId = new Map(orders.map((o) => [o.id, o]));
    const missing = [...lineIds, ...reversedIds].filter((id) => !byId.has(id));
    if (missing.length > 0) {
      throw new NotFoundException({
        code: 'SETTLEMENT_ORDER_NOT_FOUND',
        message: `${missing.length} order(s) in this payout do not exist`,
        cause: missing,
      });
    }
    // A payout cannot both pay for a parcel and take its COD back.
    const both = lineIds.filter((id) => reversedIds.includes(id));
    if (both.length > 0) {
      throw new BadRequestException({
        code: 'SETTLEMENT_ORDER_REPEATED',
        message: `Order(s) both paid and reversed in one payout: ${both.join(', ')}`,
      });
    }
    await this.assertSameCourier(account, [...lineIds, ...reversedIds]);

    const parsedLines = input.lines.map((line) => ({
      orderId: line.orderId,
      settled: this.parseMoney(line.settledInr, `line ${line.orderId}`),
      note: line.note ?? null,
    }));
    // The shortfall alert's base: every COD this payout pays for.
    const expectedTotal = parsedLines.reduce(
      (t, l) => t.add(byId.get(l.orderId)?.codAmountInr ?? ZERO),
      ZERO,
    );

    // Every seller whose wallet this payout moves — a credit OR a reversal.
    // Their cached balance is refreshed after commit: TRE-7's credit block
    // at order create reads the cache, so a seller only reversed would
    // otherwise keep trading on the balance from before.
    const touchedSellers = new Set<string>();
    const shortfalls: Array<{
      orderId: string;
      expected: string;
      settled: string;
      shortfall: string;
    }> = [];

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
      // One payout at a time per order: what an order was paid before is
      // read under its lock, so two payouts recorded together cannot both
      // believe they are its first. Sorted, so they queue, not deadlock.
      const touched = [...new Set([...lineIds, ...reversedIds])].sort();
      for (const id of touched) {
        await takeAdvisoryLock(tx, AdvisoryLock.SETTLEMENT_ORDER, id);
      }
      const prior = await this.priorByOrder(tx, touched);
      // Every seller this payout credits or takes back from, locked UP
      // FRONT and in one sorted order. Taken line by line, two payouts
      // covering the same two sellers in opposite orders each held one
      // wallet and waited for the other — a deadlock Postgres broke by
      // killing one of them (40P01). Still WALLET before any bank
      // reconcile lock, as everywhere.
      const sellers = [
        ...new Set(
          touched.map((id) => byId.get(id)?.sellerId).filter((s): s is string => s !== undefined),
        ),
      ].sort();
      for (const s of sellers) {
        await takeAdvisoryLock(tx, AdvisoryLock.WALLET, `${s}|${Currency.INR}`);
      }

      let allocated = ZERO;
      const lineData = parsedLines.map((line) => {
        allocated = allocated.add(line.settled);
        const expected = byId.get(line.orderId)?.codAmountInr ?? ZERO;
        const p = prior.get(line.orderId) ?? NO_PRIOR;
        return {
          orderId: line.orderId,
          expectedInr: expected,
          settledInr: line.settled,
          shortfallInr: recognisedShortfall({
            expected,
            priorPaid: p.paid,
            priorRecognised: p.recognised,
            settled: line.settled,
            reversal: false,
          }),
          note: line.note,
        };
      });
      // An RTO reversal is a NEGATIVE line: the courier taking back
      // exactly what it paid on that order. Anything else cannot be booked
      // exactly, and is refused naming both figures.
      for (const r of rtoReversals) {
        const p = prior.get(r.orderId) ?? NO_PRIOR;
        if (p.paid.lessThanOrEqualTo(0)) {
          throw new BadRequestException({
            code: 'SETTLEMENT_RTO_REVERSAL_NOT_PAID',
            message:
              `The courier reversed ₹${r.amount.toFixed(2)} on order ${r.orderId}, but no recorded ` +
              'payout paid for it. Record the payout that paid it first.',
          });
        }
        if (!p.paid.equals(r.amount)) {
          throw new BadRequestException({
            code: 'SETTLEMENT_RTO_REVERSAL_AMOUNT_MISMATCH',
            message:
              `The courier reversed ₹${r.amount.toFixed(2)} on order ${r.orderId} but has paid ` +
              `₹${p.paid.toFixed(2)} on it across recorded payouts — a reversal takes back exactly ` +
              'what was paid. Check the remittance file.',
          });
        }
        const expected = byId.get(r.orderId)?.codAmountInr ?? ZERO;
        const settled = r.amount.negated();
        allocated = allocated.add(settled);
        lineData.push({
          orderId: r.orderId,
          expectedInr: expected,
          settledInr: settled,
          shortfallInr: recognisedShortfall({
            expected,
            priorPaid: p.paid,
            priorRecognised: p.recognised,
            settled,
            reversal: true,
          }),
          note: 'RTO reversal — COD taken back by the courier',
        });
      }

      const row = await tx.courierSettlement.create({
        data: {
          courierAccountId: input.courierAccountId,
          reference,
          amountInr: amount,
          allocatedInr: allocated,
          earlyCodFeeInr: earlyCodFee,
          freightDeductedInr: freightKept,
          rtoReversalInr: rtoKept,
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
      let attributed = ZERO;
      for (const line of lineData) {
        if (line.settledInr.isNegative()) continue; // a reversal — below
        // Every COD we credited or fronted (settlement or Instant Pay) and
        // the courier did not pay in full is ours to absorb (WAL-6).
        if (line.shortfallInr.gt(0)) {
          shortfalls.push({
            orderId: line.orderId,
            expected: line.expectedInr.toString(),
            settled: line.settledInr.toString(),
            shortfall: line.shortfallInr.toString(),
          });
        }
        const order = byId.get(line.orderId);
        if (!order) continue;
        // Whatever the seller's CURRENT mode: an order this payout covers
        // and nobody has credited yet (delivered before a switch to Instant
        // Pay, or whose Instant Pay credit never ran) is owed now, as a
        // settlement credit. One Instant Pay already credited at delivery
        // is caught by `isCredited` below, and its cash repays our front.
        if (line.expectedInr.lessThanOrEqualTo(0)) continue; // no COD to credit
        // Held for the seller ONLY when this payout is what credits them.
        // An order already credited on an earlier payout (the rest of a
        // part-payment) was held for them then; that cash repays what we
        // fronted, so it is capital's.
        await takeAdvisoryLock(tx, AdvisoryLock.WALLET, `${order.sellerId}|${Currency.INR}`);
        if (await this.codCredit.isCredited(tx, order.id)) continue;
        // Their cash is posted BEFORE the credit, so the tax and fee the
        // credit takes find cash to make ours (TRE-8) — posted after, they
        // found none and the seller was held the gross. The part that
        // repays what they owe is ours too: it reaches capital through the
        // remainder below.
        const split = await this.attribution.debtSplit(tx, order.sellerId, line.expectedInr);
        if (split.toSeller.gt(0)) {
          await this.bank.post(
            {
              accountId: receivingAccount.id,
              type: BankEntryType.COURIER_SETTLEMENT,
              signedAmount: split.toSeller,
              amountCurrency: Currency.INR,
              owner: { kind: BankOwnerKind.SELLER, sellerId: order.sellerId },
              occurredAt: receivedAt,
              reference,
              settlementId: row.id,
              staffId,
              note: `COD settled by courier — ${reference}`,
            },
            tx,
          );
          attributed = attributed.add(split.toSeller);
        }
        const credit = await this.codCredit.creditForOrder(tx, {
          orderId: order.id,
          sellerId: order.sellerId,
          grossInr: line.expectedInr,
          mode: 'SETTLEMENT',
        });
        if (!credit.credited) {
          // Unreachable under the wallet lock: the gate above is the one
          // creditForOrder applies. If it ever fires the cash just posted
          // is wrong, so the whole payout rolls back rather than keep it.
          throw new ConflictException({
            code: 'SETTLEMENT_CREDIT_RACED',
            message: `Order ${order.id} was credited by another payout meanwhile — record this one again.`,
          });
        }
        touchedSellers.add(order.sellerId);
      }

      // ── RTO reversals ────────────────────────────────────────────
      //
      // COD the courier paid us earlier for a parcel that then came back,
      // taken out of this payout. The seller was never really paid by that
      // customer, so their credit is taken back and our deductions on it
      // returned — exactly, per order. The cash leaving is theirs as far
      // as they still hold any with us; beyond that it is ours, and their
      // wallet shows what they now owe.
      const clawbacks: Array<{
        sellerId: string | null;
        amount: Prisma.Decimal;
        /** The reversed credit's gross. */
        gross: Prisma.Decimal;
        /** Their cash that stops being theirs — see below. */
        take: Prisma.Decimal;
      }> = [];
      for (const r of rtoReversals) {
        const order = byId.get(r.orderId);
        if (!order) continue; // refused before the transaction
        // What they were owed before this reversal, under their wallet lock.
        const before = await this.attribution.walletBalance(tx, order.sellerId);
        const res = await this.codCredit.reverseForOrder(tx, {
          orderId: order.id,
          sellerId: order.sellerId,
          note: `COD reversed by the courier on payout ${reference}`,
        });
        if (res.reason === 'ALREADY_REVERSED') {
          throw new ConflictException({
            code: 'SETTLEMENT_RTO_ALREADY_REVERSED',
            message: `This order's COD was already reversed on an earlier payout (${r.orderId}).`,
          });
        }
        const gross = new Prisma.Decimal(res.grossInr);
        // Across the WHOLE reversal, the cash that stops being theirs is
        //   max(0, before) − max(0, after)
        // where `after` is the wallet once the reversal AND the refunds of
        // its tax and fee have landed. Those refunds are TO_SELLER and have
        // ALREADY moved their share back to the seller as each was written —
        // max(0, after) − max(0, before − G) in all — so what is taken here
        // is the difference of the two:
        //   max(0, before) − max(0, before − G),   never more than G.
        // Taking the whole G after the refunds took the refunds back too:
        // ₹900 held, a ₹1,000 credit reversed with ₹152.54 of tax returned,
        // left them holding ₹0 against a wallet of ₹52.54.
        const take = res.reversed ? positive(before).sub(positive(before.sub(gross))) : ZERO;
        if (res.reversed) touchedSellers.add(order.sellerId);
        clawbacks.push({
          sellerId: res.reversed ? order.sellerId : null,
          amount: r.amount,
          gross,
          take,
        });
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
      // (Each seller was posted their share above, as each credit was
      // written.)
      //
      // An early-COD fee is GROSSED UP: the courier collected that money
      // for us and spent it on its own fee, so the book shows it arriving
      // with the rest and then leaving as a categorised EXPENSE. The two
      // net to exactly what the statement shows, and the fee reaches
      // /expenses and the P&L as the cost it is — rather than a hole in
      // capital labelled "shortfall" that no report ever counts.
      //
      // Freight kept back is Shiprocket POSTPAID: part of the COD goes
      // into our Shiprocket wallet instead of our bank, and the freight is
      // then debited from the wallet like any other (so it is already each
      // parcel's cost). It is a TOP-UP, not a cost: grossed up here, then
      // posted out as a courier-wallet recharge — the same entry a bank
      // transfer into the wallet makes — with its recharge record, so the
      // "paid but never arrived" check sees where it went.
      const gross = amount.add(earlyCodFee).add(freightKept).add(rtoKept);
      const toCapital = gross.sub(attributed);
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
      // The reversed COD leaving again, grossed up above like the rest.
      //
      // Two steps. First, the seller's part stops being theirs: exactly
      // what the reversal took off the wallet net of the refunds (`take`,
      // above), at most the credit's gross G, taken wherever they hold it —
      // their rupees first, then any taka (TRE-8, clamped). Capping at the
      // courier's figure R instead left a short-paid order's gap (G − R)
      // "theirs" while their wallet said nothing was owed. Then the cash
      // itself leaves as OURS: all of R, from the account it was taken out
      // of. Net, capital is charged R − (what the seller gave up), which
      // is positive by the shortfall capital absorbed when the order was
      // first paid short.
      for (const c of clawbacks) {
        const fromSeller =
          c.sellerId === null || c.take.lessThanOrEqualTo(0)
            ? ZERO
            : await this.attribution.takeToCapital(tx, {
                sellerId: c.sellerId,
                amount: c.take,
                reference,
                note: `COD reversed by the courier on ${reference} — the credit is gone, so is their cash`,
              });
        if (c.amount.gt(0)) {
          await this.bank.post(
            {
              accountId: receivingAccount.id,
              type: BankEntryType.COURIER_SETTLEMENT,
              signedAmount: c.amount.negated(),
              amountCurrency: Currency.INR,
              owner: { kind: BankOwnerKind.CAPITAL },
              occurredAt: receivedAt,
              reference,
              settlementId: row.id,
              staffId,
              note:
                c.sellerId === null
                  ? `COD reversed by the courier on ${reference} — an order never credited`
                  : fromSeller.lt(c.gross)
                    ? `COD reversed by the courier on ${reference} — the seller held ${fromSeller.toFixed(2)} of it; their wallet owes the rest`
                    : `COD reversed by the courier on ${reference}`,
            },
            tx,
          );
        }
      }
      if (earlyCodFee.gt(0)) {
        const category = await tx.expenseCategory.upsert({
          where: { code: COD_FEE_EXPENSE_CATEGORY },
          update: {},
          create: {
            code: COD_FEE_EXPENSE_CATEGORY,
            name: 'Courier COD fees',
            hint: 'Early-COD fees a courier kept back from a COD payout. Booked automatically when the payout is recorded — do not file these by hand, or the P&L counts them twice.',
          },
          select: { id: true },
        });
        await this.bank.post(
          {
            accountId: receivingAccount.id,
            type: BankEntryType.EXPENSE,
            signedAmount: earlyCodFee.negated(),
            amountCurrency: Currency.INR,
            owner: { kind: BankOwnerKind.CAPITAL },
            occurredAt: receivedAt,
            reference,
            settlementId: row.id,
            expenseCategoryId: category.id,
            staffId,
            note: `Early-COD fee the courier kept back from payout ${reference}`,
          },
          tx,
        );
      }
      if (freightKept.gt(0)) {
        const topUpRef = `COD-${reference}`;
        const entry = await this.bank.post(
          {
            accountId: receivingAccount.id,
            type: BankEntryType.COURIER_WALLET_RECHARGE,
            signedAmount: freightKept.negated(),
            amountCurrency: Currency.INR,
            owner: { kind: BankOwnerKind.CAPITAL },
            occurredAt: receivedAt,
            reference: topUpRef,
            settlementId: row.id,
            staffId,
            note: `Moved from COD payout ${reference} into the courier wallet (freight from COD)`,
          },
          tx,
        );
        // Its recharge record, already matched: the money provably went
        // to their wallet, because they say so in the payout itself. The
        // wallet sync cross-checks that the credit shows up there.
        await tx.courierWalletRecharge.create({
          data: {
            courierAccountId: input.courierAccountId,
            externalTxnId: topUpRef,
            bankTxnRef: topUpRef,
            amountInr: freightKept,
            status: 'Success',
            occurredAt: receivedAt,
            bankEntryId: entry.id,
            matchState: CourierRechargeMatch.MATCHED,
          },
        });
      }
      const unexplained = amount.add(keptBack).sub(allocated);

      await this.audit.log(
        {
          actorType: ActorType.STAFF,
          staffUserId: staffId,
          action: 'wallet.courier_settlement.recorded',
          entityType: 'courier_settlement',
          entityId: row.id,
          // MEDIUM normally; HIGH when the payout does not add up, because
          // an unexplained difference between what landed in the bank (plus
          // what the courier says it kept) and what we attributed is
          // exactly what this ledger exists to catch.
          severity: unexplained.isZero() ? 'MEDIUM' : 'HIGH',
          metadata: {
            courierAccountId: input.courierAccountId,
            reference,
            amountInr: amount.toString(),
            allocatedInr: allocated.toString(),
            unallocatedInr: unexplained.toString(),
            earlyCodFeeInr: earlyCodFee.toString(),
            freightDeductedInr: freightKept.toString(),
            rtoReversalInr: rtoKept.toString(),
            rtoReversals: rtoReversals.map((r) => ({
              orderId: r.orderId,
              amountInr: r.amount.toString(),
            })),
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

    // Balances are cached; the credits and reversals above changed them.
    for (const sellerId of touchedSellers) {
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
      // Over the WHOLE payout: one ₹50 short line on a hundred-order payout
      // is a rounding error, not the 5% it read as over the short lines.
      const totalExpected = Number(expectedTotal);
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
  /**
   * Attribute MORE of a payout that is already recorded.
   *
   * A courier's statement covers ten orders and only eight are
   * recognised at the time. `record` handles that safely — the bank
   * gets the full credit, the eight sellers are paid, and the remainder
   * sits against CAPITAL labelled "unallocated" with a HIGH audit — but
   * until now nothing could finish the job. There was no amend path,
   * and recording a second settlement was worse than useless: every
   * settlement posts its `amountInr` to the bank, so a second one would
   * book cash that never landed.
   *
   * Meanwhile the two missing orders read as unpaid on the float report
   * while their money sits under capital, so client-money coverage
   * UNDERSTATES what is owed to those sellers.
   *
   * So this changes attribution, never the total. `amountInr` is
   * untouched — it is what the bank statement says and cannot be
   * improved on — and the cash side is a zero-sum PAIR: positive to
   * each newly-credited seller, negative to capital for the same total.
   * The account balance is identical before and after, which is what
   * makes double-counting unrepresentable rather than merely unlikely.
   */
  async allocateMore(
    staffId: string,
    settlementId: string,
    input: { lines: SettlementLineInput[] },
    ctx?: ClientContext,
  ): Promise<SettlementView> {
    if (input.lines.length === 0) {
      throw new BadRequestException({
        code: 'SETTLEMENT_NO_LINES',
        message: 'Name at least one order to allocate.',
      });
    }

    const settlement = await this.prisma.client.courierSettlement.findUnique({
      where: { id: settlementId },
      select: {
        id: true,
        reference: true,
        amountInr: true,
        allocatedInr: true,
        earlyCodFeeInr: true,
        freightDeductedInr: true,
        rtoReversalInr: true,
        receivedAt: true,
        courierAccount: {
          select: {
            id: true,
            courier: { select: { code: true } },
            payoutBankAccount: {
              select: { id: true, currency: true, isActive: true, deletedAt: true },
            },
          },
        },
        lines: { select: { orderId: true } },
      },
    });
    if (!settlement) {
      throw new NotFoundException({
        code: 'SETTLEMENT_NOT_FOUND',
        message: `Settlement ${settlementId} not found`,
      });
    }

    const dupInPayload = input.lines
      .map((l) => l.orderId)
      .filter((id, i, all) => all.indexOf(id) !== i);
    if (dupInPayload.length > 0) {
      throw new BadRequestException({
        code: 'SETTLEMENT_ORDER_REPEATED',
        message: `Order(s) listed twice: ${[...new Set(dupInPayload)].join(', ')}`,
      });
    }
    // Already on THIS payout. The unique index would refuse it anyway;
    // saying so names the orders instead of surfacing a constraint.
    const already = new Set(settlement.lines.map((l) => l.orderId));
    const repeated = input.lines.filter((l) => already.has(l.orderId)).map((l) => l.orderId);
    if (repeated.length > 0) {
      throw new BadRequestException({
        code: 'SETTLEMENT_ORDER_ALREADY_ALLOCATED',
        message: `Already allocated on this payout: ${repeated.join(', ')}`,
      });
    }

    const orders = await this.prisma.client.order.findMany({
      where: { id: { in: input.lines.map((l) => l.orderId) } },
      select: { id: true, sellerId: true, codAmountInr: true },
    });
    const byId = new Map(orders.map((o) => [o.id, o]));
    const missing = input.lines.filter((l) => !byId.has(l.orderId));
    if (missing.length > 0) {
      throw new NotFoundException({
        code: 'SETTLEMENT_ORDER_NOT_FOUND',
        message: `${missing.length} order(s) do not exist`,
        cause: missing.map((l) => l.orderId),
      });
    }

    await this.assertSameCourier(
      settlement.courierAccount,
      input.lines.map((l) => l.orderId),
    );
    const parsedLines = input.lines.map((line) => ({
      orderId: line.orderId,
      settled: this.parseMoney(line.settledInr, `line ${line.orderId}`),
      note: line.note ?? null,
    }));
    const adding = parsedLines.reduce((t, l) => t.add(l.settled), ZERO);

    // The ceiling is the COD this payout covers: the cash that actually
    // arrived plus what the courier says it kept back. Allocating past it
    // would hold sellers more money than the courier collected for them,
    // which is the one thing this operation must not be able to do — it
    // would read on the coverage page as money we hold and do not.
    const remaining = settlement.amountInr
      .add(explainedKeptBackOf(settlement))
      .sub(settlement.allocatedInr);
    if (adding.gt(remaining)) {
      throw new BadRequestException({
        code: 'SETTLEMENT_OVER_ALLOCATED',
        message:
          `This payout has ${remaining.toFixed(2)} left to allocate and you named ` +
          `${adding.toFixed(2)}. Record a separate payout for cash that landed separately.`,
      });
    }

    const linked = settlement.courierAccount.payoutBankAccount;
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
          'Link one under Courier accounts before allocating what it paid.',
      });
    }

    const credited = new Set<string>();
    await this.prisma.client.$transaction(async (tx) => {
      // The payout re-read under ITS lock. What is left to allocate was
      // read above outside any transaction: two operators each saw the
      // same remainder and together allocated past the cash that landed,
      // and each wrote `stale + adding`, so one addition vanished from
      // `allocatedInr` while its lines and credits stayed.
      await takeAdvisoryLock(tx, AdvisoryLock.SETTLEMENT, settlement.id);
      const fresh = await tx.courierSettlement.findUnique({
        where: { id: settlement.id },
        select: {
          amountInr: true,
          allocatedInr: true,
          earlyCodFeeInr: true,
          freightDeductedInr: true,
          lines: { select: { orderId: true } },
        },
      });
      if (!fresh) {
        throw new NotFoundException({
          code: 'SETTLEMENT_NOT_FOUND',
          message: `Settlement ${settlementId} not found`,
        });
      }
      const onPayout = new Set(fresh.lines.map((l) => l.orderId));
      const allocatedMeanwhile = parsedLines
        .filter((l) => onPayout.has(l.orderId))
        .map((l) => l.orderId);
      if (allocatedMeanwhile.length > 0) {
        throw new BadRequestException({
          code: 'SETTLEMENT_ORDER_ALREADY_ALLOCATED',
          message: `Already allocated on this payout: ${allocatedMeanwhile.join(', ')}`,
        });
      }
      const remainingNow = fresh.amountInr.add(explainedKeptBackOf(fresh)).sub(fresh.allocatedInr);
      if (adding.gt(remainingNow)) {
        throw new BadRequestException({
          code: 'SETTLEMENT_OVER_ALLOCATED',
          message:
            `This payout has ${remainingNow.toFixed(2)} left to allocate and you named ` +
            `${adding.toFixed(2)}. Record a separate payout for cash that landed separately.`,
        });
      }

      // Priors read under each order's lock, as in `record`.
      const touched = [...new Set(parsedLines.map((l) => l.orderId))].sort();
      for (const id of touched) {
        await takeAdvisoryLock(tx, AdvisoryLock.SETTLEMENT_ORDER, id);
      }
      const prior = await this.priorByOrder(tx, touched);
      // Every seller's wallet up front, sorted — as in `record`.
      const sellers = [
        ...new Set(
          touched.map((id) => byId.get(id)?.sellerId).filter((s): s is string => s !== undefined),
        ),
      ].sort();
      for (const s of sellers) {
        await takeAdvisoryLock(tx, AdvisoryLock.WALLET, `${s}|${Currency.INR}`);
      }
      const lineData = parsedLines.map((line) => {
        const expected = byId.get(line.orderId)?.codAmountInr ?? ZERO;
        const p = prior.get(line.orderId) ?? NO_PRIOR;
        return {
          orderId: line.orderId,
          expectedInr: expected,
          settledInr: line.settled,
          shortfallInr: recognisedShortfall({
            expected,
            priorPaid: p.paid,
            priorRecognised: p.recognised,
            settled: line.settled,
            reversal: false,
          }),
          note: line.note,
        };
      });
      await tx.courierSettlementLine.createMany({
        data: lineData.map((l) => ({ ...l, settlementId: settlement.id })),
      });
      await tx.courierSettlement.update({
        where: { id: settlement.id },
        data: { allocatedInr: fresh.allocatedInr.add(adding) },
      });

      // The zero-sum pair. No new cash arrived, so the account total
      // must not move: what changes is WHOSE the money already there
      // is. Same shape as TRE-8's reclassification, for the same
      // reason — a single entry would change the balance and make the
      // book disagree with the statement. Each seller THIS allocation
      // credits is moved their COD before the credit (so its tax and fee
      // find it), less any part that repays what they owe — that stays
      // capital's.
      let moved = ZERO;
      for (const line of lineData) {
        const order = byId.get(line.orderId);
        if (!order) continue;
        // Whatever the seller's CURRENT mode: an order this payout covers
        // and nobody has credited yet (delivered before a switch to Instant
        // Pay, or whose Instant Pay credit never ran) is owed now, as a
        // settlement credit. One Instant Pay already credited at delivery
        // is caught by `isCredited` below, and its cash repays our front.
        if (line.expectedInr.lessThanOrEqualTo(0)) continue;
        await takeAdvisoryLock(tx, AdvisoryLock.WALLET, `${order.sellerId}|${Currency.INR}`);
        if (await this.codCredit.isCredited(tx, order.id)) continue;
        const split = await this.attribution.debtSplit(tx, order.sellerId, line.expectedInr);
        if (split.toSeller.gt(0)) {
          await this.bank.post(
            {
              accountId: receivingAccount.id,
              type: BankEntryType.COURIER_SETTLEMENT,
              signedAmount: split.toSeller,
              amountCurrency: Currency.INR,
              owner: { kind: BankOwnerKind.SELLER, sellerId: order.sellerId },
              occurredAt: settlement.receivedAt,
              reference: settlement.reference,
              settlementId: settlement.id,
              staffId,
              note: `COD allocated later — ${settlement.reference}`,
            },
            tx,
          );
          moved = moved.add(split.toSeller);
        }
        const credit = await this.codCredit.creditForOrder(tx, {
          orderId: order.id,
          sellerId: order.sellerId,
          grossInr: line.expectedInr,
          mode: 'SETTLEMENT',
        });
        if (!credit.credited) {
          throw new ConflictException({
            code: 'SETTLEMENT_CREDIT_RACED',
            message: `Order ${order.id} was credited by another payout meanwhile — allocate again.`,
          });
        }
        credited.add(order.sellerId);
      }
      if (!moved.isZero()) {
        await this.bank.post(
          {
            accountId: receivingAccount.id,
            type: BankEntryType.COURIER_SETTLEMENT,
            signedAmount: moved.negated(),
            amountCurrency: Currency.INR,
            owner: { kind: BankOwnerKind.CAPITAL },
            occurredAt: settlement.receivedAt,
            reference: settlement.reference,
            settlementId: settlement.id,
            staffId,
            note: `Reattributed to sellers on ${settlement.reference}`,
          },
          tx,
        );
      }

      await this.audit.log(
        {
          actorType: ActorType.STAFF,
          staffUserId: staffId,
          action: 'wallet.courier_settlement.allocated',
          entityType: 'courier_settlement',
          entityId: settlement.id,
          changes: {
            before: { allocatedInr: fresh.allocatedInr.toString() },
            after: { allocatedInr: fresh.allocatedInr.add(adding).toString() },
          },
          metadata: {
            reference: settlement.reference,
            orders: parsedLines.map((l) => l.orderId),
            addedInr: adding.toString(),
            movedFromCapitalInr: moved.toString(),
          },
          severity: 'MEDIUM',
          ...(ctx === undefined ? {} : { ctx }),
        },
        tx,
      );
    });

    // The credits changed cached balances (TRE-7 reads the cache).
    for (const sellerId of credited) {
      await this.wallet.recomputeCacheAfterCommit(sellerId, Currency.INR, 'post-settlement-credit');
    }

    return this.getById(settlement.id);
  }

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

  /**
   * What each order has been paid, net, and what shortfall has been
   * recognised on it, across the payout lines recorded so far. Read in the
   * caller's transaction, under the orders' locks. Absent = never on one.
   */
  private async priorByOrder(
    tx: Prisma.TransactionClient,
    orderIds: readonly string[],
  ): Promise<Map<string, { paid: Prisma.Decimal; recognised: Prisma.Decimal }>> {
    if (orderIds.length === 0) return new Map();
    const rows = await tx.courierSettlementLine.groupBy({
      by: ['orderId'],
      where: { orderId: { in: [...orderIds] } },
      _sum: { settledInr: true, shortfallInr: true },
    });
    return new Map(
      rows.map((r) => [
        r.orderId,
        { paid: r._sum.settledInr ?? ZERO, recognised: r._sum.shortfallInr ?? ZERO },
      ]),
    );
  }

  /**
   * Refuses an order this courier account did not carry. An order counts
   * as ours when any of its waybill-bearing shipments was booked on this
   * account (or, before accounts were recorded, with this courier); one
   * with no waybill yet passes — there is nothing to contradict.
   */
  private async assertSameCourier(
    account: { id: string; courier: { code: string } },
    orderIds: readonly string[],
  ): Promise<void> {
    if (orderIds.length === 0) return;
    const shipments = await this.prisma.client.shipment.findMany({
      where: {
        awbNumber: { not: null },
        orderShipments: { some: { orderId: { in: [...orderIds] } } },
      },
      select: {
        courierAccountId: true,
        courierCode: true,
        orderShipments: { select: { orderId: true } },
      },
    });
    const carried = new Map<string, boolean>();
    for (const s of shipments) {
      const ours =
        s.courierAccountId !== null
          ? s.courierAccountId === account.id
          : s.courierCode === account.courier.code;
      for (const os of s.orderShipments) {
        if (!orderIds.includes(os.orderId)) continue;
        carried.set(os.orderId, (carried.get(os.orderId) ?? false) || ours);
      }
    }
    const foreign = [...carried].filter(([, ours]) => !ours).map(([id]) => id);
    if (foreign.length > 0) {
      throw new BadRequestException({
        code: 'SETTLEMENT_ORDER_OTHER_COURIER',
        message: `Order(s) carried by a different courier account, not this one: ${foreign.join(', ')}`,
      });
    }
  }

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
      earlyCodFeeInr: row.earlyCodFeeInr.toString(),
      freightDeductedInr: row.freightDeductedInr.toString(),
      rtoReversalInr: row.rtoReversalInr.toString(),
      keptBackInr: keptBackOf(row).toString(),
      unallocatedInr: row.amountInr.add(explainedKeptBackOf(row)).sub(row.allocatedInr).toString(),
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

function positive(v: Prisma.Decimal): Prisma.Decimal {
  return v.lessThan(0) ? ZERO : v;
}

/** Everything the courier kept back from a payout, whatever the kind. */
function keptBackOf(row: {
  earlyCodFeeInr: Prisma.Decimal;
  freightDeductedInr: Prisma.Decimal;
  rtoReversalInr: Prisma.Decimal;
}): Prisma.Decimal {
  return row.earlyCodFeeInr.add(row.freightDeductedInr).add(row.rtoReversalInr);
}

/**
 * What explains a payout landing short of the COD it covers: the fee and
 * the freight the courier kept. An RTO reversal is a negative LINE, so it
 * is already inside what was allocated and is not added again.
 */
function explainedKeptBackOf(row: {
  earlyCodFeeInr: Prisma.Decimal;
  freightDeductedInr: Prisma.Decimal;
}): Prisma.Decimal {
  return row.earlyCodFeeInr.add(row.freightDeductedInr);
}
