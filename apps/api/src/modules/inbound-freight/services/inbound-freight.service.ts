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
  ConsignmentEventType,
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
import { ConsignmentEventService } from '../../consignment-core/services/consignment-event.service';
import { ConsignmentFreightModeService } from '../../consignment-core/services/consignment-freight-mode.service';
import { WalletService } from '../../seller-wallet/services/wallet.service';
import type { ClientContext } from '../../seller-auth/seller-auth.service';
import {
  grossLineTotals,
  InboundFreightAmortisationService,
} from './inbound-freight-amortisation.service';
import {
  BankLedgerService,
  idempotencyKeyReused,
} from '../../treasury/services/bank-ledger.service';
import {
  AdvisoryLock,
  lockAccountsForPosting,
  takeAdvisoryLock,
} from '../../../common/db/advisory-lock';
import { inrRateAt, toInr, type InrRateAt } from '../../../common/fx/inr-rate-at';
import { isUniqueViolation } from '../../../common/db/unique-violation';

/**
 * What every load of a bill includes. Five call sites had this literal
 * copied out, and `toView` restates it as a type — one of them drifting
 * would be a field silently missing from a screen rather than an error.
 */
export const CHARGE_REFS = {
  consignment: { select: { consignmentNumber: true } },
  goodsReceipt: { select: { receiptNumber: true } },
  seller: { select: { companyName: true } },
} satisfies Prisma.InboundFreightChargeInclude;

type ChargeWithRefs = Prisma.InboundFreightChargeGetPayload<{
  include: typeof CHARGE_REFS;
}>;

/**
 * What the seller reads on their consignment timeline when a bill is
 * raised (`FREIGHT_RECORDED`).
 *
 * It says the rupees CHARGED and, when they differ, what was AGREED and
 * in which currency — the rate was negotiated by phone, so "৳4,500" is
 * the number they will recognise and "₹3,658.54" is the one that left
 * their wallet. Never a rate or a per-line breakdown: those are on the
 * bill itself, and a timeline entry that tries to be an invoice is read
 * by nobody.
 */
export function freightRecordedDescription(input: {
  readonly totalInr: Prisma.Decimal;
  readonly agreedAmount: Prisma.Decimal;
  readonly agreedCurrency: Currency;
  readonly mode: InboundFreightMode;
  readonly lineCount: number;
  readonly units: number;
}): string {
  const inr = `₹${input.totalInr.toFixed(2)}`;
  const agreed =
    input.agreedCurrency === Currency.INR
      ? ''
      : ` (${input.agreedAmount.toFixed(2)} ${input.agreedCurrency} as agreed)`;
  const when =
    input.mode === InboundFreightMode.PAY_ADVANCE
      ? 'billed before it leaves Bangladesh'
      : input.mode === InboundFreightMode.PAY_NOW
        ? 'charged now'
        : 'charged as the stock sells';
  const what = `${input.units} unit(s) across ${input.lineCount} product(s)`;
  return `Freight billed — ${inr}${agreed} for ${what}, ${when}`;
}

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

/** The material fields a forwarder payment's idempotency key vouches for. */
interface ForwarderPaymentShape {
  readonly accountId: string;
  readonly signedAmount: Prisma.Decimal;
  readonly occurredAt: Date;
  readonly reference: string | null;
}

/**
 * Our cost for a bill, stamped: the total AND each payment's rupee figure
 * as it was priced when the total was worked out. The page's per-payment
 * breakdown reads these, so it always adds up to the total above it — a
 * rate back-filled into the history later moves neither until the next
 * payment or attribution re-sums the bill.
 */
function stampOurCost(
  total: Prisma.Decimal,
  payments: readonly ForwarderPaymentInr[],
): { ourCostInr: Prisma.Decimal; ourCostPayments: Prisma.InputJsonValue } {
  return {
    ourCostInr: total,
    // Plain strings throughout; the cast is only past the interface's
    // lack of an index signature.
    ourCostPayments: payments.map((p) => ({ ...p })) as unknown as Prisma.InputJsonValue,
  };
}

/** The stamped per-payment figures, keyed by bank entry; tolerant of legacy rows. */
function stampedPayments(json: Prisma.JsonValue | null): Map<string, ForwarderPaymentInr> {
  const out = new Map<string, ForwarderPaymentInr>();
  if (!Array.isArray(json)) return out;
  for (const item of json) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) continue;
    const id = item['bankEntryId'];
    const cost = item['costInr'];
    if (typeof id !== 'string' || typeof cost !== 'string') continue;
    out.set(id, item as unknown as ForwarderPaymentInr);
  }
  return out;
}

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
  /** What was AGREED, before conversion — equal to `amountInr` for an INR bill. */
  readonly agreedAmount: string;
  readonly agreedCurrency: Currency;
  /** How the agreed figure became rupees. Null on an INR bill. */
  readonly fxRate: string | null;
  readonly fxRatePair: string | null;
  readonly fxRateSource: string | null;
  readonly fxRateRecordedAt: Date | null;
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
  /** Set when the bill was withdrawn as wrong; `voidReason` says why. */
  readonly voidedAt: Date | null;
  readonly voidReason: string | null;
  /** The compensating credit the void wrote, or null if it had charged nothing. */
  readonly voidReversalEntryId: string | null;
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
    /** Per kg or per piece, in `currency` — NOT necessarily rupees. */
    readonly rate: string;
    readonly chargeableWeightKg?: string | null;
  }[];
  /**
   * What the rates are agreed in. Defaults to INR, which is what every
   * bill raised before 2026-09-20 was. A non-INR bill is converted to
   * rupees at the billing instant and the rate is recorded on it.
   */
  readonly currency?: Currency;
  /**
   * PINS the consignment to this mode as part of raising the bill.
   *
   * Not a fourth level of its own: the bill freezes whatever mode it was
   * raised on onto the consignment, so a per-bill mode that did not also
   * pin it would disagree with the consignment the moment anybody looked.
   */
  readonly mode?: InboundFreightMode;
  readonly note?: string | null;
}

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
    private readonly freightMode: ConsignmentFreightModeService,
    private readonly events: ConsignmentEventService,
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
        message: `Goods receipt ${input.goodsReceiptId} not found, or not part of a consignment`,
      });
    }
    const consignment = receipt.consignment;

    // Only a VIA_BD consignment is billed by us. A seller who shipped
    // straight to India paid their own freight, and this is enforced
    // rather than merely practised: a rule that lives in whoever is on
    // shift eventually bills somebody twice.
    //
    // Checked FIRST now, because everything below depends on the mode
    // and a DIRECT_IN consignment has no Bangladesh intake for a
    // PAY_ADVANCE bill to hang on at all.
    if (consignment.route !== ConsignmentRoute.VIA_BD) {
      throw new ConflictException({
        code: 'FREIGHT_NOT_BILLABLE',
        message:
          `${consignment.consignmentNumber} shipped straight to India, so we did not carry it. ` +
          `Only consignments routed through the Bangladesh warehouse are billed inbound freight.`,
      });
    }

    // The three-level chain, through its ONE reader. A `mode` on the
    // request PINS the consignment as part of raising the bill rather
    // than forming a fourth level of its own — the snapshot below writes
    // whatever is used, so a per-bill mode that did not also pin the
    // consignment would disagree with it the moment anybody looked.
    const mode = input.mode ?? (await this.freightMode.resolveForConsignment(consignment.id)).mode;

    // WHICH leg may be billed is the mode's decision, and it is the one
    // thing PAY_ADVANCE actually changes: the Bangladesh intake, where
    // the count and the weight that price the bill are taken, rather
    // than the arrival a forwarder invoices.
    const expectedLeg = this.freightMode.legFor(mode);
    if (receipt.leg !== expectedLeg) {
      throw new ConflictException(
        expectedLeg === ConsignmentLeg.BD_INTAKE
          ? {
              code: 'FREIGHT_NOT_THE_BD_INTAKE',
              message:
                `${consignment.consignmentNumber} is billed in ADVANCE, so its freight bill is ` +
                `raised against the Bangladesh intake — the count and weight it is priced from. ` +
                `${receipt.receiptNumber} is the India arrival.`,
            }
          : {
              code: 'FREIGHT_NOT_AN_ARRIVAL',
              message:
                `${receipt.receiptNumber} is the Bangladesh intake, not an arrival in India. ` +
                `Freight is billed against the shipment that actually flew. Pin this consignment ` +
                `to PAY_ADVANCE if it is meant to be billed before it leaves.`,
            },
      );
    }

    // Counted, or the split runs over numbers that are still guesses.
    // True of both legs: the Dhaka count is exactly what an advance bill
    // is priced from.
    if (receipt.status !== GoodsReceiptStatus.COMPLETED) {
      throw new ConflictException({
        code: 'FREIGHT_ARRIVAL_NOT_COUNTED',
        message:
          `${receipt.receiptNumber} is ${receipt.status}. Count it first, so the bill ` +
          `is split over units that are known to exist.`,
      });
    }

    // Idempotency: one LIVE bill per RECEIPT. A re-submit is refused
    // rather than billing the seller twice for the same shipment; a
    // DIFFERENT arrival on the same consignment is a different invoice and
    // is allowed, which is the whole point of the key. Re-checked inside
    // the transaction below — this read is only so the common case says so
    // without taking a lock.
    //
    // `voidedAt: null` is LOAD-BEARING, not tidiness: a withdrawn bill is
    // kept as the record of what was billed, and counting it here would
    // make void-and-re-bill impossible — which is the whole reason the
    // database's own key is now partial on the same predicate.
    const existing = await this.prisma.client.inboundFreightCharge.findFirst({
      where: { goodsReceiptId: receipt.id, voidedAt: null },
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
    // guesswork. Scoping to the one receipt is what lets a consignment be
    // billed as it lands: the September shipment gets its own invoice
    // over its own units.
    const plan = await this.amortisation.planFromPricedLines(
      receipt.id,
      input.lines.map((l) => ({
        goodsReceiptLineId: l.goodsReceiptLineId,
        basis: l.basis,
        rate: this.parseRate(l.rate),
        chargeableWeightKg:
          l.chargeableWeightKg === undefined || l.chargeableWeightKg === null
            ? null
            : this.parseRate(l.chargeableWeightKg),
      })),
    );

    // The bill is AGREED in a currency and CHARGED in rupees (PRC-8).
    // The rate is agreed by phone — "৳300 a kilo" — so it is typed in
    // whatever it was negotiated in and converted HERE, at the billing
    // instant, through the same `inrRateAt` / `toInr` helpers the P&L
    // and the flat fees use. That is what stops the rupees a seller is
    // charged and the figure the report derives from diverging.
    const at = new Date();
    const agreedCurrency = input.currency ?? Currency.INR;
    const fx = await inrRateAt(this.prisma.client, agreedCurrency, at);
    if (fx === null) {
      // REFUSED, never billed at zero and never billed as if the figure
      // were rupees. A missing rate sends whoever reads this to the FX
      // screen rather than to the freight screen, where they would find
      // nothing wrong.
      throw new BadRequestException({
        code: 'NO_FX_RATE_FOR_FREIGHT',
        message:
          `There is no ${agreedCurrency} → INR rate recorded, so this bill cannot be priced in ` +
          `rupees. Record the rate first — a freight bill is charged in rupees whatever it was ` +
          `agreed in.`,
      });
    }
    const agreedAmount = plan.totalAgreed;
    const amount = toInr(agreedAmount, fx);
    if (amount.lte(0)) {
      throw new BadRequestException({
        code: 'FREIGHT_AMOUNT_INVALID',
        message: `${agreedAmount.toFixed(2)} ${agreedCurrency} comes to nothing in rupees.`,
      });
    }
    // Each line in rupees, apportioned so the lines sum to `amount`
    // EXACTLY — converting each line on its own and summing would drift
    // a paisa away from the bill the seller is charged. Identity for an
    // INR bill, so nothing about an existing bill's arithmetic moves.
    const lineInr = grossLineTotals(
      plan.lines.map((l) => l.lineTotalAgreed),
      amount,
    );

    // The service charge is snapshotted at record time and never
    // re-resolved at settlement: the seller owes the rate that applied
    // when their consignment landed, not whatever the setting says weeks
    // later. PAY_ADVANCE pays in full up front, so it carries none.
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
    const gross = grossLineTotals(lineInr, total);

    const created = await this.prisma.client.$transaction(async (tx) => {
      // THE DOUBLE-BILLING GUARD.
      //
      // `goods_receipt_id @unique` cannot see this: a PAY_ADVANCE bill
      // hangs on the Dhaka intake and a PAY_NOW / PAY_LATER one on the
      // India arrival, which are DIFFERENT receipts — so both would be
      // accepted and the seller charged twice for one consignment.
      //
      // Read-then-write is not a guard under READ COMMITTED, so the read
      // and the write happen under this lock inside one transaction. The
      // partial unique `inbound_freight_one_advance_per_consignment` is
      // the backstop for the half an index can express.
      await takeAdvisoryLock(tx, AdvisoryLock.INBOUND_FREIGHT_BILL, consignment.id);

      const live = await tx.inboundFreightCharge.findMany({
        where: { consignmentId: consignment.id, voidedAt: null },
        select: { id: true, mode: true, status: true, goodsReceiptId: true },
      });
      const advance = live.find((c) => c.mode === InboundFreightMode.PAY_ADVANCE);
      if (advance !== undefined) {
        throw new ConflictException({
          code: 'FREIGHT_CONSIGNMENT_BILLED_IN_ADVANCE',
          message:
            `${consignment.consignmentNumber} was billed in advance before it left Bangladesh, ` +
            `so its freight is already paid for. Void that bill if it was wrong, then raise a ` +
            `new one.`,
          cause: { freightChargeId: advance.id, status: advance.status },
        });
      }
      if (mode === InboundFreightMode.PAY_ADVANCE && live.length > 0) {
        const other = live[0];
        throw new ConflictException({
          code: 'FREIGHT_CONSIGNMENT_ALREADY_BILLED',
          message:
            `${consignment.consignmentNumber} already carries a freight bill, so it cannot also ` +
            `be billed in advance — the goods would be charged for twice.`,
          ...(other === undefined ? {} : { cause: { freightChargeId: other.id } }),
        });
      }
      // Re-read the per-receipt key under the lock too: the pre-flight
      // above ran outside it. LIVE bills only, exactly as above and as the
      // partial unique `inbound_freight_one_live_bill_per_receipt` does.
      const dupe = await tx.inboundFreightCharge.findFirst({
        where: { goodsReceiptId: receipt.id, voidedAt: null },
        select: { id: true, status: true },
      });
      if (dupe !== null) {
        throw new ConflictException({
          code: 'FREIGHT_ALREADY_RECORDED',
          message: `${receipt.receiptNumber} already carries a freight bill (${dupe.status})`,
          cause: { freightChargeId: dupe.id, status: dupe.status },
        });
      }

      const settleNow = this.freightMode.settlesImmediately(mode);
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
          agreedAmount,
          agreedCurrency,
          ...(fx.source === 'IDENTITY'
            ? {}
            : {
                fxRate: new Prisma.Decimal(fx.storedRate),
                fxRatePair: fx.storedPair,
                fxRateSource: fx.source,
                fxRateRecordedAt: fx.recordedAt,
              }),
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
        include: CHARGE_REFS,
      });

      for (const [i, line] of plan.lines.entries()) {
        const inInr = lineInr[i] ?? line.lineTotalAgreed;
        const lineGross = gross[i] ?? inInr;
        await tx.inboundFreightAllocation.create({
          data: {
            freightChargeId: row.id,
            goodsReceiptLineId: line.goodsReceiptLineId,
            variantId: line.variantId,
            units: line.units,
            unitWeightGrams: line.unitWeightGrams,
            basis: line.basis,
            rate: line.rate,
            chargeableWeightKg: line.chargeableWeightKg,
            lineTotalAgreed: line.lineTotalAgreed,
            lineTotalInr: inInr,
            lineGrossInr: lineGross,
            perUnitInr: inInr.div(line.units).toDecimalPlaces(4),
            ...(settleNow ? { unitsSettled: line.units, amountSettledInr: lineGross } : {}),
          },
        });
      }

      // FREEZE the mode onto the consignment. From here it says what it
      // was billed on, and no later settings change can restate it
      // (ORD-6 / RS-5) — `setOverride` refuses once a live bill exists.
      await this.freightMode.snapshotAtBilling(tx, consignment.id, mode);

      // The seller watches this timeline, and until now a freight bill
      // appeared on it nowhere — the first sign of one was an
      // unexplained wallet debit. `FREIGHT_RECORDED` has been in the
      // event vocabulary (and in the seller UI's word list) since the
      // two-leg work and nothing had ever written it.
      await this.events.append(
        {
          consignmentId: consignment.id,
          type: ConsignmentEventType.FREIGHT_RECORDED,
          description: freightRecordedDescription({
            totalInr: total,
            agreedAmount,
            agreedCurrency,
            mode,
            lineCount: plan.lines.length,
            units: plan.totalUnits,
          }),
          data: {
            freightChargeId: row.id,
            goodsReceiptId: receipt.id,
            receiptNumber: receipt.receiptNumber,
            leg: receipt.leg,
            mode,
            agreedAmount: agreedAmount.toString(),
            agreedCurrency,
            fxRate: fx.source === 'IDENTITY' ? null : fx.storedRate,
            fxRatePair: fx.source === 'IDENTITY' ? null : fx.storedPair,
            amountInr: amount.toString(),
            serviceChargeInr: serviceCharge?.toString() ?? null,
            totalInr: total.toString(),
            totalUnits: plan.totalUnits,
            settledImmediately: settleNow,
          },
          actorType: ActorType.STAFF,
          actorId: staffId,
        },
        tx,
      );

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
            leg: receipt.leg,
            agreedAmount: agreedAmount.toString(),
            agreedCurrency,
            fxRate: fx.source === 'IDENTITY' ? null : fx.storedRate,
            fxRateSource: fx.source,
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
        include: CHARGE_REFS,
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
    //
    // Checked under the lock a payment re-sums under, INSIDE the write:
    // read outside it, a payment landing between the check and the
    // update had its re-summed cost overwritten by the typed figure.
    const paymentsAttached = (): ConflictException =>
      new ConflictException({
        code: 'FREIGHT_COST_FROM_PAYMENTS',
        message:
          'This bill already has forwarder payments attached, so its cost is the sum of those ' +
          'payments. Record a further payment instead of typing the cost.',
      });
    if (existing._count.bankEntries > 0) throw paymentsAttached();

    const row = await this.prisma.client.$transaction(async (tx) => {
      await takeAdvisoryLock(tx, AdvisoryLock.FREIGHT_COST, freightChargeId);
      const attached = await tx.bankEntry.count({
        where: { inboundFreightChargeId: freightChargeId },
      });
      if (attached > 0) throw paymentsAttached();
      return tx.inboundFreightCharge.update({
        where: { id: freightChargeId },
        data: { ourCostInr: cost },
        include: CHARGE_REFS,
      });
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

    // What this request would post — a replay must match it exactly.
    const expected: ForwarderPaymentShape = {
      accountId: input.bankAccountId,
      signedAmount: amount.negated(),
      occurredAt: input.occurredAt,
      reference: input.reference ?? null,
    };
    const replay = await this.replayForwarderPayment(
      input.idempotencyKey,
      freightChargeId,
      expected,
    );
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
        // Serialise every re-sum of this bill's cost. Without it two
        // payments at once each re-sum a set holding only their own
        // uncommitted entry, and the later write drops the other payment
        // from our cost — and, being linked, from operating expenses too.
        await takeAdvisoryLock(tx, AdvisoryLock.FREIGHT_COST, freightChargeId);
        // The account's reconcile key (TRE-1): a reconcile of this account must
        // not read its balance between our read and our post.
        await lockAccountsForPosting(tx, [input.bankAccountId]);
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
          data: stampOurCost(recomputed.total, recomputed.payments),
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
        const again = await this.replayForwarderPayment(
          input.idempotencyKey,
          freightChargeId,
          expected,
        );
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
   * now stands. Null when the key is new. A key whose entry is not THIS
   * payment — another bill, another account, amount, date or reference —
   * is refused (IDEM-1): reusing a key across two different requests is a
   * client bug, and answering it with the first request's result would
   * tell the caller the second one worked.
   */
  private async replayForwarderPayment(
    idempotencyKey: string | null | undefined,
    freightChargeId: string,
    expected: ForwarderPaymentShape,
  ): Promise<FreightChargeView | null> {
    if (idempotencyKey == null) return null;
    const prior = await this.prisma.client.bankEntry.findUnique({
      where: { idempotencyKey },
      select: {
        inboundFreightChargeId: true,
        type: true,
        accountId: true,
        signedAmount: true,
        occurredAt: true,
        reference: true,
      },
    });
    if (prior === null) return null;
    if (
      prior.inboundFreightChargeId !== freightChargeId ||
      prior.type !== BankEntryType.EXPENSE ||
      prior.accountId !== expected.accountId ||
      !prior.signedAmount.equals(expected.signedAmount) ||
      prior.occurredAt.getTime() !== expected.occurredAt.getTime() ||
      (prior.reference ?? '').trim() !== (expected.reference ?? '').trim()
    ) {
      throw idempotencyKeyReused('forwarder payment');
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
        include: CHARGE_REFS,
      });
    });

    return this.toView(updated);
  }

  /**
   * WITHDRAW a bill that was wrong — a mistyped rate, a recount — so a
   * fresh one can be raised against the same receipt.
   *
   * ── WHY A VOID RATHER THAN AN EDIT ────────────────────────────────
   * The owner's call: the freight record and the money must always
   * agree, and margin must stay true. Editing a bill in place would
   * leave the wallet holding a figure the bill no longer claims, and
   * the P&L reading a total nobody was charged. Withdrawing the whole
   * thing and raising a new one keeps both sides of every row.
   *
   * ── THE GIVE-BACK IS A CREDIT, NEVER A DELETION ───────────────────
   * `seller_wallet_entries` is append-only, so whatever the bill had
   * charged comes back as one `INBOUND_FREIGHT_REFUND` credit. Exactly
   * `amountSettledInr` — what was actually taken, which for a PAY_NOW or
   * PAY_ADVANCE bill is its whole total and for a part-amortised
   * PAY_LATER bill is only the units that have left. A bill that had
   * charged nothing writes no entry at all, rather than a ₹0 line
   * nobody can read a meaning into.
   *
   * TRE-8 does the rest: the credit is TO_SELLER, so only
   * `max(0, after) − max(0, before)` of it becomes the seller's cash
   * again — the part that repaid a receivable was never theirs to have
   * back.
   *
   * ── AND THE ALLOCATIONS ───────────────────────────────────────────
   * Their counters are zeroed in the same transaction. The status alone
   * already stops amortisation reading the bill, but the lines are what
   * the cost breakdown shows and what any later reader of "how much of
   * this line is paid" will trust — leaving them charged is how a
   * withdrawn bill comes to look part-paid forever. The rows themselves
   * are KEPT: they are the record of what was billed and are the only
   * evidence of the mistake.
   *
   * Saga / ordering: everything is one transaction — the wallet writer
   * takes a tx, so unlike the M5 stock services this genuinely composes.
   * The guarded `updateMany` on "not already voided" is what stops two
   * operators giving the money back twice, and the UNIQUE
   * `void_reversal_entry_id` is the second gate.
   */
  async void(
    staffId: string,
    freightChargeId: string,
    reason: string,
    ctx?: ClientContext,
  ): Promise<FreightChargeView> {
    if (reason.trim().length < 10) {
      throw new BadRequestException({
        code: 'FREIGHT_VOID_REASON_TOO_SHORT',
        message: 'Say why the bill was wrong — at least 10 characters.',
      });
    }
    const charge = await this.load(freightChargeId);
    if (charge.voidedAt !== null) {
      throw new ConflictException({
        code: 'FREIGHT_ALREADY_VOIDED',
        message: `This bill was already withdrawn on ${charge.voidedAt.toISOString().slice(0, 10)}.`,
      });
    }

    const updated = await this.prisma.client.$transaction(async (tx) => {
      // WAL-7: the refund reads what was charged and then writes. Taken
      // before the read so a delivery charging a unit at the same moment
      // is either already inside `amountSettledInr` or runs after this
      // commits — and then finds the bill VOIDED and charges nothing.
      // The BILL lock FIRST, then the wallet — the order `record` already
      // uses (bill lock, then `applyEntry`'s wallet lock), so there is no
      // cycle. It is what makes the dispatch guard's "is this consignment
      // billed?" and this withdrawal serialise: without it a void
      // committing just after that read ships an advance consignment whose
      // freight has been given back.
      await takeAdvisoryLock(tx, AdvisoryLock.INBOUND_FREIGHT_BILL, charge.consignmentId);
      await takeAdvisoryLock(tx, AdvisoryLock.WALLET, `${charge.sellerId}|${Currency.INR}`);
      const fresh = await tx.inboundFreightCharge.findUnique({
        where: { id: freightChargeId },
        select: { amountSettledInr: true, voidedAt: true },
      });
      if (fresh === null || fresh.voidedAt !== null) {
        throw new ConflictException({
          code: 'FREIGHT_ALREADY_VOIDED',
          message: 'This bill was withdrawn by another operator.',
        });
      }

      // ONE instant for the bill and every line it owns — read back later,
      // "when was this withdrawn" must give the same answer whichever row
      // is asked.
      const voidedAt = new Date();

      // Claimed on the very figure the refund is worked out from, so a
      // unit charged between the read and the write cannot be silently
      // left uncredited.
      const claimed = await tx.inboundFreightCharge.updateMany({
        where: {
          id: freightChargeId,
          voidedAt: null,
          amountSettledInr: fresh.amountSettledInr,
        },
        data: {
          status: InboundFreightStatus.VOIDED,
          voidedAt,
          voidedByStaffId: staffId,
          voidReason: reason.trim(),
        },
      });
      if (claimed.count !== 1) {
        throw new ConflictException({
          code: 'FREIGHT_ALREADY_VOIDED',
          message: 'This bill changed while you were withdrawing it — look at it again.',
        });
      }

      const refund = fresh.amountSettledInr;
      let reversalEntryId: string | null = null;
      if (refund.gt(0)) {
        const entry = await this.wallet.applyEntry(tx, {
          sellerId: charge.sellerId,
          currency: Currency.INR,
          direction: WalletEntryDirection.INBOUND_FREIGHT_REFUND,
          amount: refund,
          // Points at the settlement debit this returns, where there was
          // one, so the pair reads as one round trip in the ledger
          // rather than two unrelated lines. A part-amortised PAY_LATER
          // bill has many per-order debits and no single one to name, so
          // the link is the bill's own `voidReversalEntryId` instead.
          ...(charge.walletEntryId === null ? {} : { linkedEntryId: charge.walletEntryId }),
          actorType: ActorType.STAFF,
          actorId: staffId,
          note: `Inbound freight bill withdrawn for ${charge.consignment.consignmentNumber}: ${reason.trim()}`,
        });
        reversalEntryId = entry.id;
        await tx.inboundFreightCharge.update({
          where: { id: freightChargeId },
          data: { voidReversalEntryId: entry.id },
        });
      }

      // Zero every line AND mark it dead, in the SAME transaction. The
      // zeroing is what stops a withdrawn bill reading as part-paid on the
      // breakdown; `voidedAt` is what lets the receipt line carry a NEW
      // allocation — the partial unique
      // `inbound_freight_one_live_allocation_per_line` tests exactly this
      // column, and the attribution walk filters on it so a re-billed unit
      // is charged at the LIVE rate rather than skipped as voided.
      await tx.inboundFreightAllocation.updateMany({
        where: { freightChargeId },
        data: {
          unitsSettled: 0,
          amountSettledInr: new Prisma.Decimal(0),
          voidedAt,
        },
      });

      // The seller watches the timeline, and a bill appearing and then a
      // credit arriving with nothing between them reads as a mistake of
      // ours that nobody explained.
      await this.events.append(
        {
          consignmentId: charge.consignmentId,
          type: ConsignmentEventType.FREIGHT_RECORDED,
          description:
            `Freight bill withdrawn — ₹${charge.totalInr.toFixed(2)}` +
            (refund.gt(0) ? `, ₹${refund.toFixed(2)} returned to your wallet` : '') +
            `. ${reason.trim()}`,
          data: {
            freightChargeId,
            voided: true,
            totalInr: charge.totalInr.toString(),
            refundedInr: refund.toString(),
            reason: reason.trim(),
          },
          actorType: ActorType.STAFF,
          actorId: staffId,
        },
        tx,
      );

      await this.audit.log(
        {
          actorType: ActorType.STAFF,
          staffUserId: staffId,
          sellerId: charge.sellerId,
          action: 'wallet.inbound_freight.voided',
          entityType: 'inbound_freight_charge',
          entityId: freightChargeId,
          // HIGH: money handed back, and the bill it was taken for
          // struck out. Same weight as a waiver.
          severity: 'HIGH',
          metadata: {
            consignmentId: charge.consignmentId,
            consignmentNumber: charge.consignment.consignmentNumber,
            goodsReceiptId: charge.goodsReceiptId,
            mode: charge.mode,
            totalInr: charge.totalInr.toString(),
            refundedInr: refund.toString(),
            reversalEntryId,
            reason: reason.trim(),
            ...this.ctxMeta(ctx),
          },
        },
        tx,
      );

      return tx.inboundFreightCharge.findUniqueOrThrow({
        where: { id: freightChargeId },
        include: CHARGE_REFS,
      });
    });

    return this.toView(updated);
  }

  async listForSeller(
    sellerId: string,
    status?: InboundFreightStatus,
  ): Promise<readonly FreightChargeView[]> {
    const rows = await this.prisma.client.inboundFreightCharge.findMany({
      // A VOIDED bill is hidden unless it is asked for by name. It was
      // withdrawn as wrong and its money given back, so listing it
      // beside live bills is how a seller comes to believe they were
      // charged twice.
      where: {
        sellerId,
        ...(status === undefined ? { voidedAt: null } : { status }),
      },
      include: CHARGE_REFS,
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
        // Same rule as the seller's list: withdrawn bills are reachable
        // by asking for them, not mixed in with live ones.
        ...(query.status === undefined ? { voidedAt: null } : { status: query.status }),
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
      include: CHARGE_REFS,
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

  private async load(id: string): Promise<ChargeWithRefs> {
    const row = await this.prisma.client.inboundFreightCharge.findUnique({
      where: { id },
      include: CHARGE_REFS,
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

  // `resolveMode` lived here and is GONE: the mode is now a three-level
  // chain (consignment pin, seller override, global default) with ONE
  // reader, `ConsignmentFreightModeService`. A second resolver here is
  // exactly the drift CNS-2 and BIN-1 exist to prevent, and the
  // disagreement it would produce is a seller billed on the wrong leg.

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
      // The lock every re-sum of this bill's cost takes — an attribution
      // racing a payment would otherwise drop one of them from the total.
      await takeAdvisoryLock(tx, AdvisoryLock.FREIGHT_COST, freightChargeId);
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
        data: stampOurCost(recomputed.total, recomputed.payments),
        include: CHARGE_REFS,
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
    /** What the rates below are quoted in. */
    agreedCurrency: Currency;
    lines: ReadonlyArray<{
      skuCode: string | null;
      productName: string | null;
      units: number;
      unitWeightGrams: number | null;
      chargeableWeightKg: string | null;
      /** Per kg or per piece, in the bill's AGREED currency. */
      rate: string;
      /** The invoice line as typed, in the agreed currency. */
      lineTotalAgreed: string;
      /** That line in rupees — what it actually costs the seller. */
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
        ourCostPayments: true,
        agreedCurrency: true,
        allocations: {
          orderBy: { lineTotalInr: 'desc' },
          select: {
            units: true,
            unitWeightGrams: true,
            chargeableWeightKg: true,
            rate: true,
            lineTotalAgreed: true,
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
    const stamps = stampedPayments(charge.ourCostPayments);
    const byCurrency = new Map<string, Prisma.Decimal>();
    for (const e of charge.bankEntries) {
      const abs = e.signedAmount.abs();
      byCurrency.set(e.currency, (byCurrency.get(e.currency) ?? new Prisma.Decimal(0)).add(abs));
    }

    return {
      agreedCurrency: charge.agreedCurrency,
      ourCostInr: charge.ourCostInr?.toFixed(2) ?? null,
      lines: charge.allocations.map((a) => ({
        skuCode: a.variant?.skuCode ?? null,
        productName: a.variant?.product?.name ?? null,
        units: a.units,
        unitWeightGrams: a.unitWeightGrams,
        chargeableWeightKg: a.chargeableWeightKg?.toString() ?? null,
        rate: a.rate.toString(),
        lineTotalAgreed: a.lineTotalAgreed.toFixed(2),
        lineTotalInr: a.lineTotalInr.toFixed(2),
        perUnitInr: a.perUnitInr.toString(),
        unitsSettled: a.unitsSettled,
        amountSettledInr: a.amountSettledInr.toFixed(2),
      })),
      // Each payment's rupee figure is the one STAMPED when our cost was
      // last re-summed, so these rows add up to `ourCostInr` above them.
      // Pricing them again here would disagree with the total the moment
      // a rate was back-filled into the history. Only a payment the stamp
      // predates (a bill last re-summed before the stamp existed) is
      // priced now, at the rate in force at its instant.
      payments: await Promise.all(
        charge.bankEntries.map(async (e) => {
          const stamped = stamps.get(e.id);
          if (stamped !== undefined) {
            return {
              accountLabel: e.account.label,
              currency: e.currency,
              amount: e.signedAmount.abs().toFixed(2),
              occurredAt: e.occurredAt.toISOString(),
              reference: e.reference,
              recordedByName: e.createdBy?.emailDisplay ?? null,
              costInr: stamped.costInr,
              rateAsStored: stamped.rateAsStored,
              rateSource: stamped.rateSource,
            };
          }
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

  private toView(row: ChargeWithRefs): FreightChargeView {
    return {
      id: row.id,
      consignmentId: row.consignmentId,
      consignmentNumber: row.consignment?.consignmentNumber ?? null,
      sellerCompanyName: row.seller?.companyName ?? null,
      goodsReceiptId: row.goodsReceiptId,
      receiptNumber: row.goodsReceipt?.receiptNumber ?? null,
      amountInr: row.amountInr.toString(),
      agreedAmount: row.agreedAmount.toString(),
      agreedCurrency: row.agreedCurrency,
      fxRate: row.fxRate?.toString() ?? null,
      fxRatePair: row.fxRatePair,
      fxRateSource: row.fxRateSource,
      fxRateRecordedAt: row.fxRateRecordedAt,
      ourCostInr: row.ourCostInr?.toString() ?? null,
      mode: row.mode,
      serviceChargePercent: row.serviceChargePercent?.toString() ?? null,
      serviceChargeInr: row.serviceChargeInr?.toString() ?? null,
      totalInr: row.totalInr.toString(),
      totalUnits: row.totalUnits,
      unitsSettled: row.unitsSettled,
      amountSettledInr: row.amountSettledInr.toString(),
      // A WITHDRAWN bill owes nothing. Without this a voided PENDING
      // bill would report its whole face value as outstanding on every
      // row that shows one — the seller reading "you still owe ₹4,500"
      // for a bill we told them was wrong and gave back.
      outstandingInr:
        row.voidedAt === null ? row.totalInr.sub(row.amountSettledInr).toString() : '0',
      status: row.status,
      settledAt: row.settledAt,
      walletEntryId: row.walletEntryId,
      voidedAt: row.voidedAt,
      voidReason: row.voidReason,
      voidReversalEntryId: row.voidReversalEntryId,
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
