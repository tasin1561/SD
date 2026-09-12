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
import {
  grossLineTotals,
  InboundFreightAmortisationService,
} from './inbound-freight-amortisation.service';
import { BankLedgerService } from '../../treasury/services/bank-ledger.service';
import { AdvisoryLock, takeAdvisoryLock } from '../../../common/db/advisory-lock';
import { inrRateAt, toInr, type InrRateAt } from '../../../common/fx/inr-rate-at';
import { isUniqueViolation } from '../../../common/db/unique-violation';

type ChargeWithRefs = Prisma.InboundFreightChargeGetPayload<{
  include: {
    consignment: { select: { consignmentNumber: true } };
    goodsReceipt: { select: { receiptNumber: true } };
    seller: { select: { companyName: true } };
  };
}>;

/** One forwarder payment, in rupees at the rate in force when it moved. */
export interface ForwarderPaymentInr {
  readonly bankEntryId: string;
  readonly currency: Currency;
  readonly amount: string;
  readonly occurredAt: string;
  readonly costInr: string;
  /** INR per unit of the payment's currency, and where that came from. */
  readonly inrPerUnit: string;
  readonly rateSource: InrRateAt['source'];
  readonly rateRecordedAt: string | null;
  /** The stored row it was read off, e.g. "INR→BDT 1.23". */
  readonly rateAsStored: string;
}

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
    // What each line owes over its life, service charge included. These
    // sum to `total` exactly, and amortisation charges against them — so
    // a pay-later bill collects its service charge as its units leave
    // rather than closing short of it.
    const gross = grossLineTotals(
      plan.lines.map((l) => l.lineTotalInr),
      total,
    );

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

      for (const [i, line] of plan.lines.entries()) {
        const lineGross = gross[i] ?? line.lineTotalInr;
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
            lineGrossInr: lineGross,
            perUnitInr: line.perUnitInr,
            ...(settleNow ? { unitsSettled: line.units, amountSettledInr: lineGross } : {}),
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

    const updated = await this.prisma.client.$transaction(async (tx) => {
      // The WALLET lock amortisation charges under. Taken BEFORE the
      // outstanding figure is read, so a delivery charged at the same
      // moment is either already in `amountSettledInr` below or runs
      // after this commits — and then finds the bill SETTLED and
      // charges nothing. Read outside it, a delivery landing between
      // the read and the claim was billed twice: once by itself and
      // once again inside this remainder.
      await takeAdvisoryLock(tx, AdvisoryLock.WALLET, `${charge.sellerId}|${Currency.INR}`);
      const fresh = await tx.inboundFreightCharge.findUnique({
        where: { id: freightChargeId },
        select: { status: true, totalInr: true, amountSettledInr: true, unitsSettled: true },
      });
      if (
        fresh === null ||
        (fresh.status !== InboundFreightStatus.PENDING &&
          fresh.status !== InboundFreightStatus.PARTIALLY_SETTLED)
      ) {
        throw new ConflictException({
          code: 'FREIGHT_NOT_PENDING',
          message: 'Freight bill was settled by another operator',
        });
      }
      const remainder = fresh.totalInr.sub(fresh.amountSettledInr);
      if (remainder.lte(0)) {
        throw new ConflictException({
          code: 'FREIGHT_NOTHING_OUTSTANDING',
          message: 'Every unit on this bill has already been charged',
        });
      }

      // Re-guard INSIDE the tx, on the very figure the remainder was
      // worked out from: two operators clicking "settle" must not
      // produce two debits.
      const claimed = await tx.inboundFreightCharge.updateMany({
        where: {
          id: freightChargeId,
          status: {
            in: [InboundFreightStatus.PENDING, InboundFreightStatus.PARTIALLY_SETTLED],
          },
          amountSettledInr: fresh.amountSettledInr,
        },
        data: {
          status: InboundFreightStatus.SETTLED,
          settledAt: new Date(),
          settledByStaffId: staffId,
          unitsSettled: charge.totalUnits,
          amountSettledInr: fresh.totalInr,
        },
      });
      if (claimed.count !== 1) {
        throw new ConflictException({
          code: 'FREIGHT_NOT_PENDING',
          message: 'Freight bill was settled by another operator',
        });
      }

      // Every line is now fully charged — in the SAME transaction.
      // The status alone already stops amortisation reading the bill,
      // but the lines are what the cost breakdown shows and what any
      // future reader of "how much of this line is paid" will trust;
      // leaving them at their pre-settle counters is how the bill came
      // to be charged a second time.
      const lines = await tx.inboundFreightAllocation.findMany({
        where: { freightChargeId },
        select: { id: true, units: true, lineGrossInr: true },
      });
      for (const line of lines) {
        await tx.inboundFreightAllocation.update({
          where: { id: line.id },
          data: { unitsSettled: line.units, amountSettledInr: line.lineGrossInr },
        });
      }

      const entry = await this.wallet.applyEntry(tx, {
        sellerId: charge.sellerId,
        currency: Currency.INR,
        direction: WalletEntryDirection.INBOUND_FREIGHT,
        // The REMAINDER, read under the lock: units that already left
        // were charged as they went.
        amount: remainder,
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
            totalInr: fresh.totalInr.toString(),
            outstandingChargedInr: remainder.toString(),
            unitsAlreadySettled: fresh.unitsSettled,
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
      select: { id: true, ourCostInr: true, _count: { select: { bankEntries: true } } },
    });
    if (!existing) {
      throw new NotFoundException({
        code: 'FREIGHT_CHARGE_NOT_FOUND',
        message: 'No such freight bill',
      });
    }
    // Once a payment is attached, our cost IS the sum of the payments
    // (each at the rate in force when it moved) and is recomputed on
    // every one. A typed figure here would be overwritten by the next
    // payment, and until then would say something the bank book does not.
    if (existing._count.bankEntries > 0) {
      throw new ConflictException({
        code: 'FREIGHT_COST_FROM_PAYMENTS',
        message:
          'This bill already has forwarder payments attached, so its cost is the sum of those ' +
          'payments. Record a further payment instead of typing the cost.',
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
   * ── OUR COST IS THE SUM OF THE PAYMENTS ──────────────────────────────
   * Recomputed from every payment attached to the bill, in the same
   * transaction, each converted to rupees at the rate in force at ITS own
   * instant (the latest `fx_rate_history` row at or before it, else
   * `fx_rates` — the rule the P&L converts a taka expense by). It used to
   * be filled in only when unset, so a second instalment never reached
   * the cost: ₹30,000 then ₹20,000 read as ₹30,000, and because a linked
   * payment is excluded from operating expenses the ₹20,000 was on no
   * line of the P&L at all. The rupee figure used to be typed by the
   * operator; the one production payment (৳2,000) was typed at 1.20 and
   * read ₹1,666.67 where every recorded rate said ₹1,626.02.
   *
   * ── IDEMPOTENT ON THE CLIENT'S KEY ───────────────────────────────────
   * A replay with the same `idempotencyKey` returns the bill as it now
   * stands and posts nothing; two racing copies are settled by the unique
   * index on `bank_entries.idempotency_key`.
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
      readonly occurredAt: Date;
      readonly reference?: string | null;
      readonly note?: string | null;
      readonly idempotencyKey?: string | null;
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

    const replay = await this.replayForwarderPayment(input.idempotencyKey, freightChargeId);
    if (replay !== null) return replay;

    // The account decides the currency of the entry (TRE-2).
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

    // The rate in force at the payment's own instant — refused rather
    // than guessed when there is none at all.
    const rate = await inrRateAt(this.prisma.client, account.currency, input.occurredAt);
    if (rate === null) {
      throw new BadRequestException({
        code: 'FREIGHT_FX_RATE_MISSING',
        message:
          `No ${account.currency}→INR rate is recorded, so this payment cannot be priced in ` +
          'rupees. Record the rate on the FX page first.',
      });
    }
    const costInr = toInr(amount, rate);

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

    let row: {
      updated: ChargeWithRefs;
      bankEntryId: string;
      payments: readonly ForwarderPaymentInr[];
    };
    try {
      row = await this.prisma.client.$transaction(async (tx) => {
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
            idempotencyKey: input.idempotencyKey ?? null,
            note:
              `Forwarder payment — ${existing.consignment.consignmentNumber}` +
              (account.currency === Currency.INR
                ? ''
                : ` (₹${costInr.toFixed(2)} at ${rate.storedPair} ${rate.storedRate}, ` +
                  `${rate.source === 'HISTORY' ? 'rate history' : 'current rate'})`) +
              `${input.note == null || input.note === '' ? '' : ` — ${input.note}`}`,
          },
          tx,
        );

        const recomputed = await this.recomputeOurCost(tx, freightChargeId);
        const updated = await tx.inboundFreightCharge.update({
          where: { id: freightChargeId },
          // Always INR — `our_cost_inr` is the P&L's cost side and a BDT
          // number in it would be wrong by the exchange rate.
          data: { ourCostInr: recomputed.total },
          include: {
            consignment: { select: { consignmentNumber: true } },
            goodsReceipt: { select: { receiptNumber: true } },
            seller: { select: { companyName: true } },
          },
        });
        return { updated, bankEntryId: entry.id, payments: recomputed.payments };
      });
    } catch (err) {
      // Two copies of the same request racing: the loser's insert hits
      // the unique key the winner committed. It is the same request, so
      // it gets the same answer rather than an error.
      if (input.idempotencyKey != null && isUniqueViolation(err)) {
        const again = await this.replayForwarderPayment(input.idempotencyKey, freightChargeId);
        if (again !== null) return again;
      }
      throw err;
    }

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
        rate: {
          inrPerUnit: rate.inrPerUnit.toString(),
          asStored: `${rate.storedPair} ${rate.storedRate}`,
          source: rate.source,
          recordedAt: rate.recordedAt?.toISOString() ?? null,
        },
        ourCostWas: existing.ourCostInr?.toString() ?? null,
        ourCostNow: row.updated.ourCostInr?.toString() ?? null,
        payments: row.payments,
        reference: input.reference ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        ipAddress: ctx?.ipAddress ?? null,
        userAgent: ctx?.userAgent ?? null,
        requestId: ctx?.requestId ?? null,
      },
    });

    return this.toView(row.updated);
  }

  /**
   * The answer to a request already made with this key: the bill as it
   * now stands. Null when the key is new. A key that created something
   * OTHER than a payment against this bill is refused — reusing a key
   * across two different requests is a client bug, and answering it with
   * the first request's result would tell the caller the second worked.
   */
  private async replayForwarderPayment(
    idempotencyKey: string | null | undefined,
    freightChargeId: string,
  ): Promise<FreightChargeView | null> {
    if (idempotencyKey == null) return null;
    const prior = await this.prisma.client.bankEntry.findUnique({
      where: { idempotencyKey },
      select: { inboundFreightChargeId: true },
    });
    if (prior === null) return null;
    if (prior.inboundFreightChargeId !== freightChargeId) {
      throw new ConflictException({
        code: 'IDEMPOTENCY_KEY_REUSED',
        message: 'This request key was already used for a different payment.',
      });
    }
    return this.toView(await this.load(freightChargeId));
  }

  /**
   * Our cost for the bill: every forwarder payment attached to it, each
   * in rupees at the rate in force at its own instant, summed. Read in
   * the caller's transaction so it sees the payment just posted.
   */
  private async recomputeOurCost(
    tx: Prisma.TransactionClient,
    freightChargeId: string,
  ): Promise<{ total: Prisma.Decimal; payments: ForwarderPaymentInr[] }> {
    const entries = await tx.bankEntry.findMany({
      where: { inboundFreightChargeId: freightChargeId, type: BankEntryType.EXPENSE },
      select: { id: true, currency: true, signedAmount: true, occurredAt: true },
      orderBy: { occurredAt: 'asc' },
    });
    const payments = await this.pricePayments(tx, entries);
    const total = payments.reduce((sum, p) => sum.add(p.costInr), new Prisma.Decimal(0));
    return { total, payments };
  }

  /** Each payment in rupees at its own instant's rate. Refuses on a gap. */
  private async pricePayments(
    db: Pick<Prisma.TransactionClient, 'fxRateHistory' | 'fxRate'>,
    entries: ReadonlyArray<{
      id: string;
      currency: Currency;
      signedAmount: Prisma.Decimal;
      occurredAt: Date;
    }>,
  ): Promise<ForwarderPaymentInr[]> {
    const out: ForwarderPaymentInr[] = [];
    for (const e of entries) {
      const rate = await inrRateAt(db, e.currency, e.occurredAt);
      if (rate === null) {
        throw new BadRequestException({
          code: 'FREIGHT_FX_RATE_MISSING',
          message:
            `No ${e.currency}→INR rate is recorded, so a payment on this bill cannot be priced ` +
            'in rupees. Record the rate on the FX page first.',
        });
      }
      const abs = e.signedAmount.abs();
      out.push({
        bankEntryId: e.id,
        currency: e.currency,
        amount: abs.toFixed(2),
        occurredAt: e.occurredAt.toISOString(),
        costInr: toInr(abs, rate).toFixed(2),
        inrPerUnit: rate.inrPerUnit.toString(),
        rateSource: rate.source,
        rateRecordedAt: rate.recordedAt?.toISOString() ?? null,
        rateAsStored: `${rate.storedPair} ${rate.storedRate}`,
      });
    }
    return out;
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

  /**
   * Attach an expense that was ALREADY recorded to the bill it belongs
   * to.
   *
   * ── WHY THIS EXISTS SEPARATELY FROM PAYING ───────────────────────────
   * `recordForwarderPayment` writes the cash and the attribution
   * together, which is the right path going forward. It does nothing
   * for the payments already sitting on /expenses as loose entries —
   * and those are exactly the ones being counted twice, because the
   * P&L reports an unlinked forwarder payment as an operating expense
   * while the leg it belongs to still reads as unpriced.
   *
   * So this only ever moves an entry from "general" to "attributed". No
   * money is created, moved or restated: the amount, the account, the
   * owner and the date are all left alone, and the ONLY column touched
   * on the entry is the link. That is why it does not go through
   * `BankLedgerService.post()` (TRE-1) — nothing about the cash changes.
   *
   * ── THE INR FIGURE ───────────────────────────────────────────────────
   * Our cost becomes the sum of every payment attached to the bill, each
   * at the rate in force at its own instant — the same recomputation
   * `recordForwarderPayment` runs, so the two paths cannot disagree.
   */
  async attributeExistingPayment(
    staffId: string,
    freightChargeId: string,
    input: { readonly bankEntryId: string },
    ctx?: ClientContext,
  ): Promise<FreightChargeView> {
    const charge = await this.prisma.client.inboundFreightCharge.findUnique({
      where: { id: freightChargeId },
      select: {
        id: true,
        ourCostInr: true,
        consignment: { select: { consignmentNumber: true } },
      },
    });
    if (charge === null) {
      throw new NotFoundException({
        code: 'FREIGHT_CHARGE_NOT_FOUND',
        message: 'No such freight bill',
      });
    }

    const entry = await this.prisma.client.bankEntry.findUnique({
      where: { id: input.bankEntryId },
      select: {
        id: true,
        type: true,
        currency: true,
        signedAmount: true,
        inboundFreightChargeId: true,
      },
    });
    if (entry === null) {
      throw new NotFoundException({ code: 'BANK_ENTRY_NOT_FOUND', message: 'No such bank entry' });
    }
    if (entry.type !== BankEntryType.EXPENSE) {
      // A settlement or a top-up is not a payment to a forwarder, and
      // letting one be attributed would take real cash out of the line
      // it actually belongs to.
      throw new ConflictException({
        code: 'ENTRY_NOT_AN_EXPENSE',
        message: 'Only an expense can be attributed to a freight bill.',
      });
    }
    if (entry.inboundFreightChargeId !== null) {
      // Refused rather than moved. Re-pointing an entry at a different
      // bill silently changes two legs' margins at once, and the person
      // doing it can see only one of them.
      throw new ConflictException({
        code: 'ENTRY_ALREADY_ATTRIBUTED',
        message: 'This expense is already attached to a consignment.',
      });
    }

    const paidAmount = entry.signedAmount.abs();

    const { updated, payments } = await this.prisma.client.$transaction(async (tx) => {
      // Through the LEDGER, which owns bank_entries (TRE-1). It writes
      // the link guarded on it still being absent, so two people
      // attributing the same expense from two screens cannot both win.
      const claimed = await this.bank.attributeToFreightCharge(entry.id, freightChargeId, tx);
      if (!claimed.claimed) {
        throw new ConflictException({
          code: 'ENTRY_ALREADY_ATTRIBUTED',
          message: 'Somebody else attached this expense while you were on this page.',
        });
      }
      // Every payment on the bill, this one included, at its own rate.
      const recomputed = await this.recomputeOurCost(tx, freightChargeId);
      const row = await tx.inboundFreightCharge.update({
        where: { id: freightChargeId },
        data: { ourCostInr: recomputed.total },
        include: {
          consignment: { select: { consignmentNumber: true } },
          goodsReceipt: { select: { receiptNumber: true } },
          seller: { select: { companyName: true } },
        },
      });
      return { updated: row, payments: recomputed.payments };
    });
    const costInr = new Prisma.Decimal(
      payments.find((p) => p.bankEntryId === entry.id)?.costInr ?? '0',
    );

    await this.audit.log({
      actorType: ActorType.STAFF,
      staffUserId: staffId,
      action: 'staff.inbound_freight.payment_attributed',
      entityType: 'inbound_freight_charge',
      entityId: freightChargeId,
      // It moves a cost out of operating expenses and into a leg, which
      // changes two figures on the P&L at once.
      severity: 'HIGH',
      metadata: {
        bankEntryId: entry.id,
        paidAmount: paidAmount.toFixed(2),
        paidCurrency: entry.currency,
        costInr: costInr.toFixed(2),
        ourCostWas: charge.ourCostInr?.toString() ?? null,
        ourCostNow: updated.ourCostInr?.toString() ?? null,
        payments,
        ipAddress: ctx?.ipAddress ?? null,
        userAgent: ctx?.userAgent ?? null,
        requestId: ctx?.requestId ?? null,
      },
    });

    return this.toView(updated);
  }

  /**
   * How a freight bill came to be what it is.
   *
   * ── TWO SIDES, AND THEY ANSWER DIFFERENT QUESTIONS ───────────────────
   * The ALLOCATION lines say how the bill was split — freight is priced
   * by weight, so a heavy SKU carries more of it than a light one, and
   * a bill that looks wrong is usually one line that does. Without them
   * "₹3,000" is a number with no working, and the only way to check it
   * is to re-derive the split by hand from a spreadsheet.
   *
   * The PAYMENTS say what has actually gone out against it, from which
   * account and in which currency. That is a different question from
   * what the forwarder billed — a part payment, or one made in BDT, is
   * exactly the case where the two figures diverge and the difference
   * is the bank's charge.
   *
   * Read-only, and derived: no total is stored, so this cannot drift
   * from the rows it is built out of.
   */
  async costBreakdown(freightChargeId: string): Promise<{
    lines: ReadonlyArray<{
      skuCode: string | null;
      productName: string | null;
      units: number;
      unitWeightGrams: number | null;
      chargeableWeightKg: string | null;
      rateInr: string;
      lineTotalInr: string;
      perUnitInr: string;
      unitsSettled: number;
      amountSettledInr: string;
    }>;
    payments: ReadonlyArray<{
      accountLabel: string;
      currency: string;
      amount: string;
      occurredAt: string;
      reference: string | null;
      recordedByName: string | null;
      /** This payment in rupees at the rate in force when it moved — the
       *  figure our cost sums. Null when no rate is recorded at all. */
      costInr: string | null;
      /** The rate row it was read off, and whether it was the history or
       *  (no history that early) today's rate. */
      rateAsStored: string | null;
      rateSource: InrRateAt['source'] | null;
    }>;
    ourCostInr: string | null;
    paidTotalByCurrency: ReadonlyArray<{ currency: string; amount: string }>;
  }> {
    const charge = await this.prisma.client.inboundFreightCharge.findUnique({
      where: { id: freightChargeId },
      select: {
        ourCostInr: true,
        allocations: {
          orderBy: { lineTotalInr: 'desc' },
          select: {
            units: true,
            unitWeightGrams: true,
            chargeableWeightKg: true,
            rateInr: true,
            lineTotalInr: true,
            perUnitInr: true,
            unitsSettled: true,
            amountSettledInr: true,
            variant: { select: { skuCode: true, product: { select: { name: true } } } },
          },
        },
        bankEntries: {
          orderBy: { occurredAt: 'desc' },
          select: {
            id: true,
            signedAmount: true,
            currency: true,
            occurredAt: true,
            reference: true,
            account: { select: { label: true } },
            createdBy: { select: { emailDisplay: true } },
          },
        },
      },
    });
    if (charge === null) {
      throw new NotFoundException({
        code: 'FREIGHT_CHARGE_NOT_FOUND',
        message: 'No such freight bill',
      });
    }

    // Totalled PER CURRENCY, never added together. Two payments in two
    // currencies have no meaningful sum, and one would invite reading
    // ৳2,500 + ₹1,000 as ₹3,500.
    const byCurrency = new Map<string, Prisma.Decimal>();
    for (const e of charge.bankEntries) {
      const abs = e.signedAmount.abs();
      byCurrency.set(e.currency, (byCurrency.get(e.currency) ?? new Prisma.Decimal(0)).add(abs));
    }

    return {
      ourCostInr: charge.ourCostInr?.toFixed(2) ?? null,
      lines: charge.allocations.map((a) => ({
        skuCode: a.variant?.skuCode ?? null,
        productName: a.variant?.product?.name ?? null,
        units: a.units,
        unitWeightGrams: a.unitWeightGrams,
        chargeableWeightKg: a.chargeableWeightKg?.toString() ?? null,
        rateInr: a.rateInr.toString(),
        lineTotalInr: a.lineTotalInr.toFixed(2),
        perUnitInr: a.perUnitInr.toString(),
        unitsSettled: a.unitsSettled,
        amountSettledInr: a.amountSettledInr.toFixed(2),
      })),
      payments: await Promise.all(
        charge.bankEntries.map(async (e) => {
          const rate = await inrRateAt(this.prisma.client, e.currency, e.occurredAt);
          return {
            accountLabel: e.account.label,
            currency: e.currency,
            amount: e.signedAmount.abs().toFixed(2),
            occurredAt: e.occurredAt.toISOString(),
            reference: e.reference,
            recordedByName: e.createdBy?.emailDisplay ?? null,
            costInr: rate === null ? null : toInr(e.signedAmount.abs(), rate).toFixed(2),
            rateAsStored: rate === null ? null : `${rate.storedPair} ${rate.storedRate}`,
            rateSource: rate?.source ?? null,
          };
        }),
      ),
      paidTotalByCurrency: [...byCurrency.entries()].map(([currency, amount]) => ({
        currency,
        amount: amount.toFixed(2),
      })),
    };
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
