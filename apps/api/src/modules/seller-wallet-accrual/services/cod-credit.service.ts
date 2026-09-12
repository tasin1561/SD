import { Injectable } from '@nestjs/common';
import { ActorType, Currency, Prisma, WalletEntryDirection } from '@skydrop/db';
import { SettingsResolverService } from '../../settings/services/settings-resolver.service';
import { WalletService } from '../../seller-wallet/services/wallet.service';
import { AdvisoryLock, takeAdvisoryLock } from '../../../common/db/advisory-lock';

/**
 * Paying a seller their COD money.
 *
 * Two modes, one at a time, chosen per seller by
 * `wallet.cod_credit_mode`:
 *
 *   SETTLEMENT  — credited when the courier actually settles with us.
 *                 The seller waits and we carry no float.
 *   INSTANT_PAY — credited the moment the parcel is delivered, for a
 *                 percentage fee. We front the money until the courier
 *                 pays, and the fee is what that costs.
 *
 * Both withhold GST first. Then TWO independent fees come off the
 * post-GST amount (the owner's decision, 2026-09-12), each its own
 * ledger line, each switched off by a rate of 0:
 *
 *   COD fee      — `wallet.cod_collection_fee_percent`, what handling
 *                  cash-on-delivery costs at all. EVERY COD credit, on
 *                  either mode. A `COD_COLLECTION_FEE` entry.
 *   Instant Pay  — `wallet.instant_pay_fee_percent`, the price of being
 *                  paid before the courier settles. Only an order credited
 *                  under INSTANT_PAY, and IN ADDITION to the COD fee — it
 *                  is not all-in. An `INSTANT_PAY_FEE` entry.
 *
 * ₹1,180 COD at 18%: tax ₹180, post-GST ₹1,000; COD fee 1% = ₹10,
 * Instant Pay 2.5% = ₹25. Credited ₹990 on SETTLEMENT, ₹965 on
 * INSTANT_PAY. Two lines rather than one blended rate, so each reads
 * exactly the percentage the seller was quoted for it.
 * Both land here so the arithmetic exists once: two call sites doing
 * their own tax maths is how the figures stop agreeing.
 *
 * ── GST is EXTRACTED, not added ───────────────────────────────────────
 * An Indian retail price is tax-inclusive — the customer paying ₹1,000
 * has already paid the tax inside it. So the deduction is
 *
 *     cod × rate / (100 + rate)      →  ₹152.54 at 18%
 *
 * NOT `cod × rate`, which would take ₹180 and over-deduct by ₹27.46 on
 * every ₹1,000 — roughly 2.75% of GMV.
 *
 * ── The deducted tax is OUR REVENUE, not a liability ──────────────────
 * WAL-4 (amended 2026-09-07, confirmed by the founder 2026-09-11): we
 * file no return against it — the courier bills and remits GST on the
 * carriage — so the P&L reports it on its own "COD tax deduction" line.
 * It still gets its own `GST_WITHHOLDING` direction and `gst_withholdings`
 * row: netted silently into the credit, the seller could not tie their
 * credit to their order, and "what did we deduct as tax" could not be
 * told apart from any other charge.
 */

const MODE_KEY = 'wallet.cod_credit_mode';
const GST_KEY = 'wallet.cod_gst_percent';
const INSTANT_FEE_KEY = 'wallet.instant_pay_fee_percent';
const COLLECTION_FEE_KEY = 'wallet.cod_collection_fee_percent';

const DEFAULT_GST_PERCENT = '18.00';
const DEFAULT_INSTANT_FEE_PERCENT = '2.50';
const DEFAULT_COLLECTION_FEE_PERCENT = '0.00';

export type CodCreditModeValue = 'SETTLEMENT' | 'INSTANT_PAY';

export interface CodCreditResult {
  readonly credited: boolean;
  readonly mode: CodCreditModeValue;
  readonly grossInr: string;
  readonly gstWithheldInr: string;
  /** The base charge for collecting COD. Applies on both modes. */
  readonly collectionFeeInr: string;
  /** The premium for being paid before the courier settles. INSTANT_PAY only. */
  readonly instantFeeInr: string;
  readonly netCreditedInr: string;
  readonly reason?: string;
}

const NOT_CREDITED = (mode: CodCreditModeValue, reason: string): CodCreditResult => ({
  credited: false,
  mode,
  grossInr: '0.00',
  gstWithheldInr: '0.00',
  collectionFeeInr: '0.00',
  instantFeeInr: '0.00',
  netCreditedInr: '0.00',
  reason,
});

@Injectable()
export class CodCreditService {
  constructor(
    // No PrismaService: every write here happens on the CALLER's
    // transaction, and the only thing that ever read outside it was the
    // global GST lookup — which is now resolved per seller through
    // SettingsResolverService.
    private readonly settings: SettingsResolverService,
    private readonly wallet: WalletService,
  ) {}

  async resolveMode(sellerId: string): Promise<CodCreditModeValue> {
    const resolved = await this.settings.resolve(sellerId, MODE_KEY);
    return String(resolved.value) === 'INSTANT_PAY' ? 'INSTANT_PAY' : 'SETTLEMENT';
  }

  /**
   * Credit a seller for one delivered COD order.
   *
   * `grossInr` is what the ORDER was worth, not what any courier
   * remitted — see the settlement caller for why. Composes into the
   * caller's transaction.
   *
   * Idempotent on an UNREVERSED COD_COLLECTION for the order, read under
   * the wallet lock (`isCredited`). After a reversal the order may be
   * credited again — the courier reversed it by mistake and paid it on a
   * later payout — so the gate counts credits against reversals rather
   * than looking for one, and the `gst_withholdings` row is upserted.
   */
  async creditForOrder(
    tx: Prisma.TransactionClient,
    input: {
      orderId: string;
      sellerId: string;
      grossInr: Prisma.Decimal;
      mode: CodCreditModeValue;
    },
  ): Promise<CodCreditResult> {
    const { orderId, sellerId, grossInr, mode } = input;

    if (grossInr.lessThanOrEqualTo(0)) {
      return NOT_CREDITED(mode, 'Nothing to credit — the order has no COD amount');
    }
    /*
      WAL-7: a guard that READS before it writes must hold the lock.

      `findFirst`-then-insert inside a transaction feels safe and is not.
      Under READ COMMITTED two concurrent transactions each take a
      snapshot, each see no row, and each insert — a transaction gives no
      protection against a row that does not exist yet. The advisory lock
      inside `applyEntry` serialises the WRITES, but by then both callers
      have already decided they were first.

      Taken here, the second caller blocks until the first commits and
      its `findFirst` then sees the committed row. This is the rule
      WAL-7 already states — "any future money guard that reads a balance
      or COUNTS ROWS before writing must hold this same lock inside the
      same transaction" — which the withdrawal path honours and these
      accrual paths did not.
    */
    await takeAdvisoryLock(tx, AdvisoryLock.WALLET, `${sellerId}|${Currency.INR}`);

    if (await this.isCredited(tx, orderId)) {
      return NOT_CREDITED(mode, 'Already credited');
    }

    // Per SELLER, not global. GST is slabbed by what is being sold —
    // apparel 5% or 12%, electronics 18% — so a single platform-wide
    // rate is wrong for most sellers rather than safely conservative.
    // Still not negotiable: the override records which slab a seller
    // trades in, clamped 0–28 at write time (SET-1).
    const gstPercent = await this.sellerDecimal(sellerId, GST_KEY, DEFAULT_GST_PERCENT);
    // Extracted from a tax-inclusive price. The divisor is (100 + rate),
    // not 100 — see the class comment; getting this wrong over-withholds
    // on every single order.
    const gst = grossInr
      .times(gstPercent)
      .dividedBy(new Prisma.Decimal(100).plus(gstPercent))
      .toDecimalPlaces(2);
    const postGst = grossInr.minus(gst);

    // The COD fee: what handling cash-on-delivery costs at all, on EVERY
    // COD credit whichever mode credited it. Seeded at 0 — off until
    // somebody decides otherwise.
    const collectionPercent = await this.sellerDecimal(
      sellerId,
      COLLECTION_FEE_KEY,
      DEFAULT_COLLECTION_FEE_PERCENT,
    );
    // Capped at what there is to take a fee from. Each percent is clamped
    // 0–100 on its own, so a bad pair (60% + 60%) could otherwise deduct
    // more than the post-GST amount and credit the seller a NEGATIVE net
    // for a parcel their customer paid for.
    const collectionFee = Prisma.Decimal.min(
      postGst.times(collectionPercent).dividedBy(100).toDecimalPlaces(2),
      postGst,
    );

    // The Instant Pay fee: the price of being paid before the courier
    // settles, so only when THIS credit is an Instant Pay one — and ON
    // TOP of the COD fee, not instead of it (2026-09-12). The two are
    // independent charges for independent services, and a seller on
    // Instant Pay still had their COD handled.
    const instantPercent =
      mode === 'INSTANT_PAY'
        ? await this.sellerDecimal(sellerId, INSTANT_FEE_KEY, DEFAULT_INSTANT_FEE_PERCENT)
        : new Prisma.Decimal(0);
    // The second fee takes only what the first left — never a negative
    // net credit. The settings write refuses a pair summing past 100%
    // (COD_FEES_EXCEED_100); this is the backstop for one that got there
    // another way (a global change under a seller's override).
    const instantFee = Prisma.Decimal.min(
      postGst.times(instantPercent).dividedBy(100).toDecimalPlaces(2),
      Prisma.Decimal.max(postGst.minus(collectionFee), 0),
    );

    // The full COD is credited, and the deductions are their own
    // entries. Netting them into one credit would hide both the tax and
    // the fee inside a number the seller cannot reconcile against their
    // own order.
    await this.wallet.applyEntry(tx, {
      sellerId,
      currency: Currency.INR,
      direction: WalletEntryDirection.COD_COLLECTION,
      amount: grossInr,
      linkedOrderId: orderId,
      actorType: ActorType.SYSTEM,
      note: mode === 'INSTANT_PAY' ? 'COD collected (Instant Pay)' : 'COD collected (settled)',
    });

    if (gst.greaterThan(0)) {
      // The per-order record of what was deducted. UNIQUE on orderId and
      // UPSERTED: an order credited again after a reversal records its
      // latest deduction.
      //
      // NOT a liability record any more (2026-09-07): the courier bills
      // GST on the shipping alongside their charge and remits it, so
      // there is no return of ours behind this. The row survives
      // because "what was deducted from THIS order" is still the
      // question asked when a seller queries their credit; `filedAt`
      // and `filingRef` are now vestigial.
      const withholding = {
        sellerId,
        codAmountInr: grossInr,
        gstPercent,
        gstAmountInr: gst,
        netToSellerInr: postGst,
      };
      await tx.gstWithholding.upsert({
        where: { orderId },
        create: { orderId, ...withholding },
        update: withholding,
      });
      await this.wallet.applyEntry(tx, {
        sellerId,
        currency: Currency.INR,
        // NOT ORDER_CHARGES, still. The reason changed but the rule
        // did not: "what did sellers pay us in delivery charges" and
        // "what did we deduct as tax" are different questions, and a
        // note cannot be grouped by — folding them together silently
        // included one inside the other (WAL-4).
        direction: WalletEntryDirection.GST_WITHHOLDING,
        amount: gst,
        linkedOrderId: orderId,
        actorType: ActorType.SYSTEM,
        note: `Tax deducted from COD at ${gstPercent.toFixed(2)}%`,
      });
    }

    if (collectionFee.greaterThan(0)) {
      await this.wallet.applyEntry(tx, {
        sellerId,
        currency: Currency.INR,
        direction: WalletEntryDirection.COD_COLLECTION_FEE,
        amount: collectionFee,
        linkedOrderId: orderId,
        actorType: ActorType.SYSTEM,
        note: `COD collection fee at ${collectionPercent.toFixed(2)}%`,
      });
    }

    if (instantFee.greaterThan(0)) {
      await this.wallet.applyEntry(tx, {
        sellerId,
        currency: Currency.INR,
        direction: WalletEntryDirection.INSTANT_PAY_FEE,
        amount: instantFee,
        linkedOrderId: orderId,
        actorType: ActorType.SYSTEM,
        note: `Instant Pay fee at ${instantPercent.toFixed(2)}% — credited at delivery rather than at settlement`,
      });
    }

    return {
      credited: true,
      mode,
      grossInr: grossInr.toFixed(2),
      gstWithheldInr: gst.toFixed(2),
      collectionFeeInr: collectionFee.toFixed(2),
      instantFeeInr: instantFee.toFixed(2),
      netCreditedInr: postGst.minus(collectionFee).minus(instantFee).toFixed(2),
    };
  }

  /**
   * Whether the order carries a COD credit not since taken back. A COD may
   * be credited, reversed and credited again, so this COUNTS rather than
   * looks for one entry. The caller holds the seller's wallet lock.
   */
  async isCredited(tx: Prisma.TransactionClient, orderId: string): Promise<boolean> {
    const credits = await tx.sellerWalletEntry.count({
      where: { linkedOrderId: orderId, direction: WalletEntryDirection.COD_COLLECTION },
    });
    const reversals = await tx.sellerWalletEntry.count({
      where: { linkedOrderId: orderId, direction: WalletEntryDirection.COD_REVERSAL },
    });
    return credits > reversals;
  }

  /**
   * Take back a COD credit the courier has REVERSED — a parcel it had
   * paid out on turned into a return, and it clawed the money back out of
   * a later payout. The seller never really got paid by that customer, so
   * they must not keep the credit; and what we deducted from it (the tax
   * and the COD and Instant Pay fees, each its own entry) was never
   * earned, so each goes back.
   *
   * The WHOLE credit is taken back: the seller was credited the order's
   * COD whatever the courier paid (WAL-6), so that is what reverses. The
   * cash the courier takes is checked against what it PAID by the
   * settlement recorder, not here. Reverses the latest credit not yet
   * reversed, returns only deductions not already returned, and is
   * idempotent: an order with as many reversals as credits is done.
   * Composes into the caller's transaction.
   */
  async reverseForOrder(
    tx: Prisma.TransactionClient,
    input: { orderId: string; sellerId: string; note: string },
  ): Promise<{
    readonly reversed: boolean;
    readonly reason?: 'NEVER_CREDITED' | 'ALREADY_REVERSED';
    readonly grossInr: string;
    readonly returnedInr: string;
  }> {
    const { orderId, sellerId, note } = input;
    await takeAdvisoryLock(tx, AdvisoryLock.WALLET, `${sellerId}|${Currency.INR}`);

    // Credits and reversals pair up: a COD may be credited, reversed,
    // credited again on a later payout and reversed again.
    const credits = await tx.sellerWalletEntry.findMany({
      where: { linkedOrderId: orderId, direction: WalletEntryDirection.COD_COLLECTION },
      orderBy: { id: 'desc' },
      select: { id: true, amount: true },
    });
    if (credits.length === 0) {
      return { reversed: false, reason: 'NEVER_CREDITED', grossInr: '0.00', returnedInr: '0.00' };
    }
    const reversals = await tx.sellerWalletEntry.findMany({
      where: { linkedOrderId: orderId, direction: WalletEntryDirection.COD_REVERSAL },
      select: { linkedEntryId: true },
    });
    const reversedIds = new Set(reversals.map((r) => r.linkedEntryId));
    // The latest credit not yet taken back.
    const credit = credits.find((c) => !reversedIds.has(c.id));
    if (reversals.length >= credits.length || credit === undefined) {
      return { reversed: false, reason: 'ALREADY_REVERSED', grossInr: '0.00', returnedInr: '0.00' };
    }

    await this.wallet.applyEntry(tx, {
      sellerId,
      currency: Currency.INR,
      direction: WalletEntryDirection.COD_REVERSAL,
      amount: credit.amount,
      linkedOrderId: orderId,
      linkedEntryId: credit.id,
      actorType: ActorType.SYSTEM,
      note,
    });

    // Each deduction taken from that COD, given back as its own entry
    // pointing at the one it returns — so the P&L can take each off the
    // line that counted it.
    const deductions = await tx.sellerWalletEntry.findMany({
      where: {
        linkedOrderId: orderId,
        direction: {
          in: [
            WalletEntryDirection.GST_WITHHOLDING,
            WalletEntryDirection.COD_COLLECTION_FEE,
            WalletEntryDirection.INSTANT_PAY_FEE,
          ],
        },
      },
      select: { id: true, amount: true, direction: true },
    });
    // Only what has not been given back already: a second reversal must
    // not return the first credit's deductions twice.
    const refunded = await tx.sellerWalletEntry.findMany({
      where: { linkedOrderId: orderId, direction: WalletEntryDirection.COD_DEDUCTION_REFUND },
      select: { linkedEntryId: true },
    });
    const refundedIds = new Set(refunded.map((r) => r.linkedEntryId));
    let returned = new Prisma.Decimal(0);
    for (const d of deductions) {
      if (d.amount.lessThanOrEqualTo(0) || refundedIds.has(d.id)) continue;
      await this.wallet.applyEntry(tx, {
        sellerId,
        currency: Currency.INR,
        direction: WalletEntryDirection.COD_DEDUCTION_REFUND,
        amount: d.amount,
        linkedOrderId: orderId,
        linkedEntryId: d.id,
        actorType: ActorType.SYSTEM,
        note: `Returned: ${d.direction.toLowerCase().replace(/_/g, ' ')} on a reversed COD`,
      });
      returned = returned.add(d.amount);
    }
    return {
      reversed: true,
      grossInr: credit.amount.toFixed(2),
      returnedInr: returned.toFixed(2),
    };
  }

  // ── internal ──────────────────────────────────────────────────────

  /** A rate that varies by seller — resolved through SET-1. */
  private async sellerDecimal(
    sellerId: string,
    key: string,
    fallback: string,
  ): Promise<Prisma.Decimal> {
    const resolved = await this.settings.resolve(sellerId, key);
    const raw = resolved.value;
    return new Prisma.Decimal(raw === null || raw === undefined ? fallback : String(raw));
  }
}
