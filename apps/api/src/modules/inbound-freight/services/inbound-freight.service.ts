import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ActorType,
  BankEntryType,
  BankOwnerKind,
  ConsignmentLeg,
  ConsignmentRoute,
  Currency,
  GoodsReceiptStatus,
  InboundFreightBasis,
  InboundFreightMode,
  InboundFreightStatus,
  Prisma,
  WalletEntryDirection,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { SettingsResolverService } from '../../settings/services/settings-resolver.service';
import { WalletService } from '../../seller-wallet/services/wallet.service';
import type { ClientContext } from '../../seller-auth/seller-auth.service';
import { InboundFreightAmortisationService } from './inbound-freight-amortisation.service';
import { BankLedgerService } from '../../treasury/services/bank-ledger.service';

/**
 * Where a forwarder payment is filed. Resolved rather than asked for:
 * this payment is a forwarder payment by construction, and letting the
 * caller choose the category would let one cost be filed two ways and
 * stop the expense breakdown adding up.
 */
const FORWARDER_EXPENSE_CATEGORY = 'freight_forwarder';

export interface FreightChargeView {
  readonly id: string;
  readonly consignmentId: string;
  readonly consignmentNumber: string | null;
  /** WHOSE consignment. Two bills with adjacent numbers are otherwise
   * indistinguishable, and they may belong to different sellers. */
  readonly sellerCompanyName: string | null;
  /** The arrival this bill covers — one forwarder invoice per shipment. */
  readonly goodsReceiptId: string;
  readonly receiptNumber: string | null;
  readonly amountInr: string;
  readonly ourCostInr: string | null;
  readonly mode: InboundFreightMode;
  readonly serviceChargePercent: string | null;
  readonly serviceChargeInr: string | null;
  readonly totalInr: string;
  readonly totalUnits: number;
  readonly unitsSettled: number;
  readonly amountSettledInr: string;
  readonly outstandingInr: string;
  readonly status: InboundFreightStatus;
  readonly settledAt: Date | null;
  readonly walletEntryId: string | null;
  readonly note: string | null;
  readonly createdAt: Date;
}

export interface RecordFreightInput {
  /**
   * The India arrival being billed. The consignment is DERIVED from it
   * rather than supplied alongside: two ids that must agree are two ids
   * that can disagree.
   */
  readonly goodsReceiptId: string;
  /**
   * What the FORWARDER charged US. The lines are what the SELLER is
   * billed; without this the BD→India leg's margin is unknowable rather
   * than merely unreported, and the P&L reads the whole leg as profit.
   */
  readonly ourCostInr?: string | null;
  /**
   * The forwarder's invoice, line by line. Every counted product on the
   * arrival must appear: one left out would ship freight-free forever,
   * because a unit with no allocation row is skipped when it leaves.
   */
  readonly lines: readonly {
    readonly goodsReceiptLineId: string;
    readonly basis: InboundFreightBasis;
    readonly rateInr: string;
    readonly chargeableWeightKg?: string | null;
  }[];
  /** Overrides the seller's resolved mode for this one arrival. */
  readonly mode?: InboundFreightMode;
  readonly note?: string | null;
}

const SETTING_MODE = 'wallet.inbound_freight_mode';
const SETTING_SERVICE_CHARGE = 'wallet.inbound_freight_service_charge_percent';

/**
 * R3 — the BD→India inbound freight bill.
 *
 * This is a SEPARATE money flow from the outbound courier fee: that one
 * is per-order, India-domestic, and lands as `ORDER_CHARGES`. This one is
 * per-consignment, cross-border, and lands as `INBOUND_FREIGHT`. Keeping
 * them apart is what makes "what did it cost to get this stock into
 * India" answerable at all.
 *
 * ── SAGA / ORDERING ───────────────────────────────────────────────────
 * `record` and `settle` each open ONE transaction that writes the charge
 * row AND (when settling) the wallet debit through
 * `WalletService.applyEntry` — the wallet writer takes a tx, so unlike
 * the M5 stock services this genuinely composes, and no saga is needed.
 * The stamped `walletEntryId` is both the FK and the idempotency
 * evidence: a bill can be settled exactly once.
 *
 * Idempotency:
 *  - `record` is gated by the UNIQUE `goods_receipt_id` — a re-submit
 *    returns the existing bill rather than double-billing the seller.
 *  - `settle` charges only the OUTSTANDING remainder, and re-guards the
 *    status inside its tx, so two operators cannot double-debit.
 *
 * ── HOW A PAY_LATER BILL ACTUALLY GETS PAID (R3 amortisation) ─────────
 * Per UNIT, as units leave. A consignment of 100 units carries one bill;
 * when one unit is delivered (or written off at RTO) the seller pays that
 * unit's share and the other 99 stay due. See
 * `InboundFreightAmortisationService` for the split (by weight) and the
 * batch → receipt-line → rate attribution chain. `settle` remains the
 * "pay the rest now" escape hatch, and `waive` forgives the remainder.
 */
@Injectable()
export class InboundFreightService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly settings: SettingsResolverService,
    private readonly wallet: WalletService,
    private readonly amortisation: InboundFreightAmortisationService,
    private readonly bank: BankLedgerService,
  ) {}

  /**
   * Ops records the freight invoice for ONE ARRIVAL. PAY_NOW settles in
   * the same transaction; PAY_LATER leaves a visible receivable.
   *
   * Per-arrival, not per-consignment: a forwarder invoices a shipment,
   * and a consignment arrives in as many shipments as it takes. The
   * split runs over the units on THIS arrival, so a later shipment gets
   * its own bill over its own units rather than landing freight-free.
   */
  async record(
    staffId: string,
    input: RecordFreightInput,
    ctx?: ClientContext,
  ): Promise<FreightChargeView> {
    const receipt = await this.prisma.client.goodsReceipt.findFirst({
      where: { id: input.goodsReceiptId, deletedAt: null },
      select: {
        id: true,
        receiptNumber: true,
        leg: true,
        status: true,
        consignment: {
          select: {
            id: true,
            sellerId: true,
            consignmentNumber: true,
            route: true,
            deletedAt: true,
          },
        },
      },
    });
    if (!receipt || receipt.consignment === null || receipt.consignment.deletedAt !== null) {
      throw new NotFoundException({
        code: 'ARRIVAL_NOT_FOUND',
        message: `Arrival ${input.goodsReceiptId} not found, or not part of a consignment`,
      });
    }
    const consignment = receipt.consignment;

    // The BD intake is not an arrival — it is the goods being handed to
    // us. Amortising over it would charge freight to units that never
    // flew, leaving a remainder nothing settles and a bill stuck at
    // PARTIALLY_SETTLED forever.
    if (receipt.leg !== ConsignmentLeg.IN_FINAL) {
      throw new ConflictException({
        code: 'FREIGHT_NOT_AN_ARRIVAL',
        message:
          `${receipt.receiptNumber} is the Bangladesh intake, not an arrival in India. ` +
          `Freight is billed against the shipment that actually flew.`,
      });
    }

    // Counted, or the split runs over numbers that are still guesses.
    if (receipt.status !== GoodsReceiptStatus.COMPLETED) {
      throw new ConflictException({
        code: 'FREIGHT_ARRIVAL_NOT_COUNTED',
        message:
          `${receipt.receiptNumber} is ${receipt.status}. Count the arrival first, so the bill ` +
          `is split over units that are known to exist.`,
      });
    }

    // Only a VIA_BD consignment is billed by us. A seller who shipped
    // straight to India paid their own freight, and this is enforced
    // rather than merely practised: a rule that lives in whoever is on
    // shift eventually bills somebody twice.
    if (consignment.route !== ConsignmentRoute.VIA_BD) {
      throw new ConflictException({
        code: 'FREIGHT_NOT_BILLABLE',
        message:
          `${consignment.consignmentNumber} shipped straight to India, so we did not carry it. ` +
          `Only consignments routed through the Bangladesh warehouse are billed inbound freight.`,
      });
    }

    // Idempotency: one bill per ARRIVAL. A re-submit is refused rather
    // than billing the seller twice for the same shipment; a DIFFERENT
    // arrival on the same consignment is a different invoice and is
    // allowed, which is the whole point of the key.
    const existing = await this.prisma.client.inboundFreightCharge.findUnique({
      where: { goodsReceiptId: receipt.id },
      select: { id: true, status: true },
    });
    if (existing) {
      throw new ConflictException({
        code: 'FREIGHT_ALREADY_RECORDED',
        message: `${receipt.receiptNumber} already carries a freight bill (${existing.status})`,
        cause: { freightChargeId: existing.id, status: existing.status },
      });
    }

    // The forwarder's invoice, priced line by line — the bill total is
    // the SUM of its lines rather than a figure typed once and split by
    // guesswork. Scoping to the one arrival is what lets a consignment be
    // billed as it lands: the September shipment gets its own invoice
    // over its own units.
    const plan = await this.amortisation.planFromPricedLines(
      receipt.id,
      input.lines.map((l) => ({
        goodsReceiptLineId: l.goodsReceiptLineId,
        basis: l.basis,
        rateInr: this.parseRate(l.rateInr),
        chargeableWeightKg:
          l.chargeableWeightKg === undefined || l.chargeableWeightKg === null
            ? null
            : this.parseRate(l.chargeableWeightKg),
      })),
    );
    const amount = plan.totalInr;

    const mode = input.mode ?? (await this.resolveMode(consignment.sellerId));
    // The service charge is snapshotted at record time and never
    // re-resolved at settlement: the seller owes the rate that applied
    // when their consignment landed, not whatever the setting says weeks
    // later.
    const percent =
      mode === InboundFreightMode.PAY_LATER
        ? await this.resolveServiceChargePercent(consignment.sellerId)
        : null;
    const serviceCharge =
      percent === null || percent.isZero() ? null : amount.mul(percent).div(100).toDecimalPlaces(2);
    const total = serviceCharge === null ? amount : amount.add(serviceCharge);

    const created = await this.prisma.client.$transaction(async (tx) => {
      const settleNow = mode === InboundFreightMode.PAY_NOW;
      let walletEntryId: string | null = null;
      if (settleNow) {
        const entry = await this.wallet.applyEntry(tx, {
          sellerId: consignment.sellerId,
          currency: Currency.INR,
          direction: WalletEntryDirection.INBOUND_FREIGHT,
          amount: total,
          actorType: ActorType.STAFF,
          actorId: staffId,
          note: `Inbound freight for ${receipt.receiptNumber} (${consignment.consignmentNumber})`,
        });
        walletEntryId = entry.id;
      }

      const row = await tx.inboundFreightCharge.create({
        data: {
          sellerId: consignment.sellerId,
          consignmentId: consignment.id,
          goodsReceiptId: receipt.id,
          amountInr: amount,
          ...(input.ourCostInr !== undefined && input.ourCostInr !== null
            ? { ourCostInr: new Prisma.Decimal(input.ourCostInr) }
            : {}),
          mode,
          serviceChargePercent: percent,
          serviceChargeInr: serviceCharge,
          totalInr: total,
          totalUnits: plan.totalUnits,
          ...(settleNow ? { unitsSettled: plan.totalUnits, amountSettledInr: total } : {}),
          status: settleNow ? InboundFreightStatus.SETTLED : InboundFreightStatus.PENDING,
          ...(settleNow ? { settledAt: new Date(), settledByStaffId: staffId, walletEntryId } : {}),
          note: input.note ?? null,
        },
        include: {
          consignment: { select: { consignmentNumber: true } },
          goodsReceipt: { select: { receiptNumber: true } },
          seller: { select: { companyName: true } },
        },
      });

      for (const line of plan.lines) {
        await tx.inboundFreightAllocation.create({
          data: {
            freightChargeId: row.id,
            goodsReceiptLineId: line.goodsReceiptLineId,
            variantId: line.variantId,
            units: line.units,
            unitWeightGrams: line.unitWeightGrams,
            basis: line.basis,
            rateInr: line.rateInr,
            chargeableWeightKg: line.chargeableWeightKg,
            lineTotalInr: line.lineTotalInr,
            perUnitInr: line.perUnitInr,
            ...(settleNow ? { unitsSettled: line.units, amountSettledInr: line.lineTotalInr } : {}),
          },
        });
      }

      await this.audit.log(
        {
          actorType: ActorType.STAFF,
          staffUserId: staffId,
          sellerId: consignment.sellerId,
          action: 'wallet.inbound_freight.recorded',
          entityType: 'inbound_freight_charge',
          entityId: row.id,
          severity: 'MEDIUM',
          metadata: {
            consignmentId: consignment.id,
            consignmentNumber: consignment.consignmentNumber,
            goodsReceiptId: receipt.id,
            receiptNumber: receipt.receiptNumber,
            amountInr: amount.toString(),
            mode,
            serviceChargeInr: serviceCharge?.toString() ?? null,
            totalInr: total.toString(),
            totalUnits: plan.totalUnits,
            allocatedLines: plan.lines.length,
            settledImmediately: settleNow,
            ...this.ctxMeta(ctx),
          },
        },
        tx,
      );
      return row;
    });

    return this.toView(created);
  }

  /**
   * Settle the OUTSTANDING balance of a bill against the wallet — the
   * "pay the rest of it now" action.
   *
   * R3 amortisation makes this a remainder, not the whole bill: units that
   * already left have been charged as they went, so charging `totalInr`
   * again would double-bill the seller for those.
   */
  async settle(
    staffId: string,
    freightChargeId: string,
    ctx?: ClientContext,
  ): Promise<FreightChargeView> {
    const charge = await this.load(freightChargeId);
    if (
      charge.status !== InboundFreightStatus.PENDING &&
      charge.status !== InboundFreightStatus.PARTIALLY_SETTLED
    ) {
      throw new ConflictException({
        code: 'FREIGHT_NOT_PENDING',
        message: `Freight bill is ${charge.status}; only an outstanding bill can be settled`,
      });
    }
    const outstanding = charge.totalInr.sub(charge.amountSettledInr);
    if (outstanding.lte(0)) {
      throw new ConflictException({
        code: 'FREIGHT_NOTHING_OUTSTANDING',
        message: 'Every unit on this bill has already been charged',
      });
    }

    const updated = await this.prisma.client.$transaction(async (tx) => {
      // Re-guard INSIDE the tx: two operators clicking "settle" must not
      // produce two debits.
      const claimed = await tx.inboundFreightCharge.updateMany({
        where: {
          id: freightChargeId,
          status: {
            in: [InboundFreightStatus.PENDING, InboundFreightStatus.PARTIALLY_SETTLED],
          },
        },
        data: {
          status: InboundFreightStatus.SETTLED,
          settledAt: new Date(),
          settledByStaffId: staffId,
          unitsSettled: charge.totalUnits,
          amountSettledInr: charge.totalInr,
        },
      });
      if (claimed.count !== 1) {
        throw new ConflictException({
          code: 'FREIGHT_NOT_PENDING',
          message: 'Freight bill was settled by another operator',
        });
      }

      const entry = await this.wallet.applyEntry(tx, {
        sellerId: charge.sellerId,
        currency: Currency.INR,
        direction: WalletEntryDirection.INBOUND_FREIGHT,
        // The REMAINDER: units that already left were charged as they went.
        amount: outstanding,
        actorType: ActorType.STAFF,
        actorId: staffId,
        note: `Inbound freight for ${charge.consignment.consignmentNumber}`,
      });

      const row = await tx.inboundFreightCharge.update({
        where: { id: freightChargeId },
        data: { walletEntryId: entry.id },
        include: {
          consignment: { select: { consignmentNumber: true } },
          goodsReceipt: { select: { receiptNumber: true } },
          seller: { select: { companyName: true } },
        },
      });

      await this.audit.log(
        {
          actorType: ActorType.STAFF,
          staffUserId: staffId,
          sellerId: charge.sellerId,
          action: 'wallet.inbound_freight.settled',
          entityType: 'inbound_freight_charge',
          entityId: freightChargeId,
          severity: 'MEDIUM',
          metadata: {
            totalInr: charge.totalInr.toString(),
            outstandingChargedInr: outstanding.toString(),
            unitsAlreadySettled: charge.unitsSettled,
            walletEntryId: entry.id,
            ...this.ctxMeta(ctx),
          },
        },
        tx,
      );
      return row;
    });

    return this.toView(updated);
  }

  /**
   * Ops forgives a PENDING bill (our own mishandling, goodwill). No
   * wallet movement — WAIVED is deliberately distinct from SETTLED so
   * write-offs stay countable rather than hiding inside collections.
   */
  /**
   * Record what the forwarder charged us, after the fact.
   *
   * Their invoice routinely arrives weeks after the goods, so demanding
   * the figure at record time would either block the bill or invite a
   * guess. Settable at any point in the bill's life — including after
   * settlement, because what the SELLER paid and what WE paid are
   * independent facts and correcting one must not disturb the other.
   */
  async setOurCost(
    staffId: string,
    freightChargeId: string,
    ourCostInr: string,
    ctx?: ClientContext,
  ): Promise<FreightChargeView> {
    const cost = new Prisma.Decimal(ourCostInr);
    if (cost.isNegative()) {
      throw new BadRequestException({
        code: 'FREIGHT_COST_NEGATIVE',
        message: 'A forwarder cannot charge us less than nothing',
      });
    }
    const existing = await this.prisma.client.inboundFreightCharge.findUnique({
      where: { id: freightChargeId },
      select: { id: true, ourCostInr: true },
    });
    if (!existing) {
      throw new NotFoundException({
        code: 'FREIGHT_CHARGE_NOT_FOUND',
        message: 'No such freight bill',
      });
    }

    const row = await this.prisma.client.inboundFreightCharge.update({
      where: { id: freightChargeId },
      data: { ourCostInr: cost },
      include: {
        consignment: { select: { consignmentNumber: true } },
        goodsReceipt: { select: { receiptNumber: true } },
        seller: { select: { companyName: true } },
      },
    });

    await this.audit.log({
      actorType: ActorType.STAFF,
      staffUserId: staffId,
      action: 'staff.inbound_freight.our_cost_set',
      entityType: 'inbound_freight_charge',
      entityId: freightChargeId,
      // The number the whole BD→India margin is measured against; a
      // wrong one moves the P&L and nothing else would show it.
      severity: 'MEDIUM',
      metadata: {
        was: existing.ourCostInr?.toString() ?? null,
        now: cost.toString(),
        ipAddress: ctx?.ipAddress ?? null,
        userAgent: ctx?.userAgent ?? null,
        requestId: ctx?.requestId ?? null,
      },
    });

    return this.toView(row);
  }

  /**
   * Pay the forwarder, and attribute it to the consignment in one act.
   *
   * ── WHY THIS EXISTS ──────────────────────────────────────────────────
   * There were two freight numbers and nothing joined them.
   * `ourCostInr` is what the forwarder billed us and is the cost side of
   * the P&L's BD→India line. The cash going out was recorded separately
   * on /expenses, where it lands in operating expenses. Record both —
   * which the P&L's own coverage note told you to do — and the same
   * rupees were subtracted TWICE, once from gross and once from net.
   *
   * Recording the payment HERE writes the bank entry, links it to the
   * bill and fills in the cost, in one transaction. TRE-3: the flow that
   * moves money writes the cash side alongside the business event, so a
   * payment cannot exist without its attribution or an attribution
   * without its payment.
   *
   * ── WHAT IT DOES NOT DO ──────────────────────────────────────────────
   * It does not touch the SELLER side. What we owe the forwarder and
   * what the seller owes us are independent facts (the same reason
   * `setOurCost` is settable after settlement), and this must not
   * disturb the amortisation.
   *
   * `ourCostInr` is filled in only when it is UNSET. A part payment
   * against a known invoice must not rewrite the invoice down to what
   * has been paid so far — the cost is what they billed, not what has
   * cleared, and the P&L recognises it once either way.
   */
  async recordForwarderPayment(
    staffId: string,
    freightChargeId: string,
    input: {
      readonly bankAccountId: string;
      /**
       * What LEFT the account, in the ACCOUNT's own currency.
       *
       * The forwarder is a Bangladeshi business and is routinely paid in
       * BDT from a BDT account. TRE-2 stamps the entry with the
       * account's currency whatever arrives, so handing over an INR
       * figure for a BDT account would not fail — it would be
       * relabelled, wrong by the exchange rate, with nothing in the row
       * to show it happened.
       */
      readonly amountPaid: string;
      /**
       * What that payment COST US in INR — the reporting currency.
       *
       * Entered rather than derived, for the TRE-5 reason: deriving it
       * from a rate would silently absorb every bank charge and every
       * gap between the rate quoted and the rate achieved. Both figures
       * come off the two statements. Required only when the account is
       * not already INR.
       */
      readonly costInr?: string | null;
      readonly occurredAt: Date;
      readonly reference?: string | null;
      readonly note?: string | null;
    },
    ctx?: ClientContext,
  ): Promise<FreightChargeView> {
    const amount = new Prisma.Decimal(input.amountPaid);
    if (amount.lessThanOrEqualTo(0)) {
      throw new BadRequestException({
        code: 'FREIGHT_PAYMENT_NOT_POSITIVE',
        message: 'A payment to the forwarder is money going out — give a positive amount',
      });
    }

    // The account decides the currency of the entry (TRE-2), so it also
    // decides whether an INR figure has to be supplied separately.
    const account = await this.prisma.client.platformBankAccount.findFirst({
      where: { id: input.bankAccountId, deletedAt: null },
      select: { id: true, currency: true, label: true },
    });
    if (account === null) {
      throw new NotFoundException({
        code: 'BANK_ACCOUNT_NOT_FOUND',
        message: 'No such bank account',
      });
    }

    let costInr: Prisma.Decimal;
    if (account.currency === Currency.INR) {
      costInr = amount;
    } else {
      if (input.costInr == null || input.costInr === '') {
        throw new BadRequestException({
          code: 'FREIGHT_COST_INR_REQUIRED',
          message:
            `This account is held in ${account.currency}, and the P&L is in INR. ` +
            'Give what the payment cost in INR as well — read off the statement rather ' +
            'than converted at a posted rate, so bank charges and the rate actually ' +
            'achieved are not silently absorbed.',
        });
      }
      costInr = new Prisma.Decimal(input.costInr);
      if (costInr.lessThanOrEqualTo(0)) {
        throw new BadRequestException({
          code: 'FREIGHT_COST_NOT_POSITIVE',
          message: 'The INR cost of the payment must be a positive number',
        });
      }
    }

    const existing = await this.prisma.client.inboundFreightCharge.findUnique({
      where: { id: freightChargeId },
      select: {
        id: true,
        ourCostInr: true,
        consignment: { select: { consignmentNumber: true } },
      },
    });
    if (!existing) {
      throw new NotFoundException({
        code: 'FREIGHT_CHARGE_NOT_FOUND',
        message: 'No such freight bill',
      });
    }

    // The category is resolved rather than asked for: this payment is a
    // forwarder payment by construction, and letting the caller choose
    // would let the same cost be filed two ways.
    const category = await this.prisma.client.expenseCategory.findUnique({
      where: { code: FORWARDER_EXPENSE_CATEGORY },
      select: { id: true },
    });

    const row = await this.prisma.client.$transaction(async (tx) => {
      const entry = await this.bank.post(
        {
          accountId: input.bankAccountId,
          type: BankEntryType.EXPENSE,
          // Negative: the money leaves. Unlike a courier wallet recharge
          // this does NOT become another asset — it is spent.
          signedAmount: amount.negated(),
          // The ACCOUNT's currency, stated rather than assumed (TRE-2).
          amountCurrency: account.currency,
          // Ours. The seller is billed for freight separately, through
          // the wallet, and attributing this to them would move their
          // held cash for a payment they did not make.
          owner: { kind: BankOwnerKind.CAPITAL },
          actorType: ActorType.STAFF,
          staffId,
          occurredAt: input.occurredAt,
          inboundFreightChargeId: freightChargeId,
          ...(category === null ? {} : { expenseCategoryId: category.id }),
          reference: input.reference ?? null,
          note:
            `Forwarder payment — ${existing.consignment.consignmentNumber}` +
            (account.currency === Currency.INR ? '' : ` (₹${costInr.toFixed(2)} equivalent)`) +
            `${input.note == null || input.note === '' ? '' : ` — ${input.note}`}`,
        },
        tx,
      );

      const updated = await tx.inboundFreightCharge.update({
        where: { id: freightChargeId },
        // Always the INR figure — `our_cost_inr` is the P&L's cost side
        // and a BDT number in it would be wrong by the exchange rate.
        data: existing.ourCostInr === null ? { ourCostInr: costInr } : {},
        include: {
          consignment: { select: { consignmentNumber: true } },
          goodsReceipt: { select: { receiptNumber: true } },
          seller: { select: { companyName: true } },
        },
      });
      return { updated, bankEntryId: entry.id };
    });

    await this.audit.log({
      actorType: ActorType.STAFF,
      staffUserId: staffId,
      action: 'staff.inbound_freight.forwarder_paid',
      entityType: 'inbound_freight_charge',
      entityId: freightChargeId,
      // Real money leaving a real account, on somebody's say-so.
      severity: 'HIGH',
      metadata: {
        bankAccountId: input.bankAccountId,
        bankEntryId: row.bankEntryId,
        amountPaid: amount.toFixed(2),
        paidCurrency: account.currency,
        costInr: costInr.toFixed(2),
        ourCostWas: existing.ourCostInr?.toString() ?? null,
        reference: input.reference ?? null,
        ipAddress: ctx?.ipAddress ?? null,
        userAgent: ctx?.userAgent ?? null,
        requestId: ctx?.requestId ?? null,
      },
    });

    return this.toView(row.updated);
  }

  async waive(
    staffId: string,
    freightChargeId: string,
    reason: string,
    ctx?: ClientContext,
  ): Promise<FreightChargeView> {
    if (reason.trim().length < 10) {
      throw new BadRequestException({
        code: 'FREIGHT_WAIVE_REASON_TOO_SHORT',
        message: 'A waiver reason of at least 10 characters is required',
      });
    }
    const charge = await this.load(freightChargeId);
    if (
      charge.status !== InboundFreightStatus.PENDING &&
      charge.status !== InboundFreightStatus.PARTIALLY_SETTLED
    ) {
      throw new ConflictException({
        code: 'FREIGHT_NOT_PENDING',
        message: `Freight bill is ${charge.status}; only an outstanding bill can be waived`,
      });
    }

    const updated = await this.prisma.client.$transaction(async (tx) => {
      const claimed = await tx.inboundFreightCharge.updateMany({
        where: {
          id: freightChargeId,
          status: {
            in: [InboundFreightStatus.PENDING, InboundFreightStatus.PARTIALLY_SETTLED],
          },
        },
        data: {
          status: InboundFreightStatus.WAIVED,
          settledAt: new Date(),
          settledByStaffId: staffId,
          note: charge.note === null ? reason : `${charge.note}\n${reason}`,
        },
      });
      if (claimed.count !== 1) {
        throw new ConflictException({
          code: 'FREIGHT_NOT_PENDING',
          message: 'Freight bill was resolved by another operator',
        });
      }
      await this.audit.log(
        {
          actorType: ActorType.STAFF,
          staffUserId: staffId,
          sellerId: charge.sellerId,
          action: 'wallet.inbound_freight.waived',
          entityType: 'inbound_freight_charge',
          entityId: freightChargeId,
          severity: 'HIGH',
          metadata: {
            totalInr: charge.totalInr.toString(),
            reason,
            ...this.ctxMeta(ctx),
          },
        },
        tx,
      );
      return tx.inboundFreightCharge.findUniqueOrThrow({
        where: { id: freightChargeId },
        include: {
          consignment: { select: { consignmentNumber: true } },
          goodsReceipt: { select: { receiptNumber: true } },
          seller: { select: { companyName: true } },
        },
      });
    });

    return this.toView(updated);
  }

  async listForSeller(
    sellerId: string,
    status?: InboundFreightStatus,
  ): Promise<readonly FreightChargeView[]> {
    const rows = await this.prisma.client.inboundFreightCharge.findMany({
      where: { sellerId, ...(status === undefined ? {} : { status }) },
      include: {
        consignment: { select: { consignmentNumber: true } },
        goodsReceipt: { select: { receiptNumber: true } },
        seller: { select: { companyName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toView(r));
  }

  async listForAdmin(query: {
    sellerId?: string;
    status?: InboundFreightStatus;
    /**
     * Free text over the consignment number, the goods-receipt number
     * and the seller's company name — the three things somebody holding
     * a forwarder's invoice might actually recognise. Case-insensitive
     * and a substring, because a person types the tail of a number they
     * are reading off paper rather than the whole of it.
     */
    search?: string;
  }): Promise<readonly FreightChargeView[]> {
    const term = query.search?.trim() ?? '';
    const rows = await this.prisma.client.inboundFreightCharge.findMany({
      where: {
        ...(query.sellerId === undefined ? {} : { sellerId: query.sellerId }),
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(term === ''
          ? {}
          : {
              OR: [
                { consignment: { consignmentNumber: { contains: term, mode: 'insensitive' } } },
                { goodsReceipt: { receiptNumber: { contains: term, mode: 'insensitive' } } },
                { seller: { companyName: { contains: term, mode: 'insensitive' } } },
              ],
            }),
      },
      include: {
        consignment: { select: { consignmentNumber: true } },
        goodsReceipt: { select: { receiptNumber: true } },
        seller: { select: { companyName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map((r) => this.toView(r));
  }

  /**
   * Total INR a seller still owes for inbound freight — the REMAINDER
   * across every outstanding bill, not the face value, since units that
   * already left have been charged as they went.
   */
  async outstandingForSeller(sellerId: string): Promise<string> {
    const rows = await this.prisma.client.inboundFreightCharge.findMany({
      where: {
        sellerId,
        status: {
          in: [InboundFreightStatus.PENDING, InboundFreightStatus.PARTIALLY_SETTLED],
        },
      },
      select: { totalInr: true, amountSettledInr: true },
    });
    return rows
      .reduce((sum, r) => sum.add(r.totalInr.sub(r.amountSettledInr)), new Prisma.Decimal(0))
      .toString();
  }

  // ── internal ──────────────────────────────────────────────────────

  private async load(id: string): Promise<
    Prisma.InboundFreightChargeGetPayload<{
      include: {
        consignment: { select: { consignmentNumber: true } };
        goodsReceipt: { select: { receiptNumber: true } };
        seller: { select: { companyName: true } };
      };
    }>
  > {
    const row = await this.prisma.client.inboundFreightCharge.findUnique({
      where: { id },
      include: {
        consignment: { select: { consignmentNumber: true } },
        goodsReceipt: { select: { receiptNumber: true } },
        seller: { select: { companyName: true } },
      },
    });
    if (!row) {
      throw new NotFoundException({
        code: 'FREIGHT_CHARGE_NOT_FOUND',
        message: `Freight charge ${id} not found`,
      });
    }
    return row;
  }

  /**
   * A rate or a weight off the invoice. Kept at 4dp rather than money's
   * 2dp: a per-piece rate on a cheap item is often fractions of a rupee,
   * and rounding it before multiplying by the unit count would move the
   * bill total away from what the forwarder charged.
   *
   * Zero is allowed HERE and refused later on the total. A single free
   * line is real — a consolidator waiving one carton — but a whole bill
   * of nothing is not a bill.
   */
  private parseRate(raw: string): Prisma.Decimal {
    let value: Prisma.Decimal;
    try {
      value = new Prisma.Decimal(raw);
    } catch {
      throw new BadRequestException({
        code: 'FREIGHT_AMOUNT_INVALID',
        message: `'${raw}' is not a valid number`,
      });
    }
    if (!value.isFinite() || value.lt(0)) {
      throw new BadRequestException({
        code: 'FREIGHT_AMOUNT_INVALID',
        message: 'A rate or weight cannot be negative',
      });
    }
    return value.toDecimalPlaces(4);
  }

  /** Defaults to PAY_NOW — the simpler money flow — on any doubt. */
  private async resolveMode(sellerId: string): Promise<InboundFreightMode> {
    try {
      const resolved = await this.settings.resolve(sellerId, SETTING_MODE);
      return String(resolved.value).toUpperCase() === 'PAY_LATER'
        ? InboundFreightMode.PAY_LATER
        : InboundFreightMode.PAY_NOW;
    } catch {
      return InboundFreightMode.PAY_NOW;
    }
  }

  /**
   * Defaults to ZERO on any doubt: a seller must never be charged for
   * credit terms that were not explicitly quoted to them.
   */
  private async resolveServiceChargePercent(sellerId: string): Promise<Prisma.Decimal> {
    try {
      const resolved = await this.settings.resolve(sellerId, SETTING_SERVICE_CHARGE);
      const pct = new Prisma.Decimal(String(resolved.value ?? '0'));
      return pct.isFinite() && pct.gt(0) ? pct : new Prisma.Decimal(0);
    } catch {
      return new Prisma.Decimal(0);
    }
  }

  private toView(
    row: Prisma.InboundFreightChargeGetPayload<{
      include: {
        consignment: { select: { consignmentNumber: true } };
        goodsReceipt: { select: { receiptNumber: true } };
        seller: { select: { companyName: true } };
      };
    }>,
  ): FreightChargeView {
    return {
      id: row.id,
      consignmentId: row.consignmentId,
      consignmentNumber: row.consignment?.consignmentNumber ?? null,
      sellerCompanyName: row.seller?.companyName ?? null,
      goodsReceiptId: row.goodsReceiptId,
      receiptNumber: row.goodsReceipt?.receiptNumber ?? null,
      amountInr: row.amountInr.toString(),
      ourCostInr: row.ourCostInr?.toString() ?? null,
      mode: row.mode,
      serviceChargePercent: row.serviceChargePercent?.toString() ?? null,
      serviceChargeInr: row.serviceChargeInr?.toString() ?? null,
      totalInr: row.totalInr.toString(),
      totalUnits: row.totalUnits,
      unitsSettled: row.unitsSettled,
      amountSettledInr: row.amountSettledInr.toString(),
      outstandingInr: row.totalInr.sub(row.amountSettledInr).toString(),
      status: row.status,
      settledAt: row.settledAt,
      walletEntryId: row.walletEntryId,
      note: row.note,
      createdAt: row.createdAt,
    };
  }

  private ctxMeta(ctx?: ClientContext): Record<string, string | null> {
    return {
      ipAddress: ctx?.ipAddress ?? null,
      userAgent: ctx?.userAgent ?? null,
      requestId: ctx?.requestId ?? null,
    };
  }
}
