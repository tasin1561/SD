import { Injectable } from '@nestjs/common';
import { ActorType, Currency, Prisma, WalletEntryDirection } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { SettingsResolverService } from '../../settings/services/settings-resolver.service';
import { WalletService } from '../../seller-wallet/services/wallet.service';

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
 * Both withhold GST first, and both then carry the COD collection fee —
 * what handling cash-on-delivery costs at all. Instant Pay's fee STACKS
 * on that: the collection fee is the base service, the instant fee is
 * the premium for not waiting. Both are seeded so that today only the
 * instant one is non-zero.
 *
 * Both fees are computed off the same post-GST base rather than
 * compounding, so the two percentages stay independently readable — a
 * seller quoted "2.5% instant" should be able to find 2.5% in the
 * ledger, not 2.5% of something already reduced.
 * Both land here so the arithmetic exists once:
 * two call sites doing their own tax maths is how a quarter's filing
 * stops reconciling.
 *
 * ── GST is EXTRACTED, not added ───────────────────────────────────────
 * An Indian retail price is tax-inclusive — the customer paying ₹1,000
 * has already paid the tax inside it. So the withholding is
 *
 *     cod × rate / (100 + rate)      →  ₹152.54 at 18%
 *
 * NOT `cod × rate`, which would take ₹180 and over-withhold by ₹27.46 on
 * every ₹1,000 — roughly 2.75% of GMV, and a number that would never
 * reconcile against a return.
 *
 * ── The withheld money is a LIABILITY ─────────────────────────────────
 * We file it, so between collecting and filing it is money owed to the
 * department, not margin. It gets its own `gst_withholdings` row for
 * exactly that reason: netted silently into a credit it would sit in the
 * same pot as revenue and be spent before the return is due.
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
    private readonly prisma: PrismaService,
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
   * Idempotent on two independent gates: an existing COD_COLLECTION
   * entry, and the UNIQUE `gst_withholdings.order_id`. Either alone
   * would do; both means a partial write cannot leave the order
   * half-credited and re-creditable.
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
    const already = await tx.sellerWalletEntry.findFirst({
      where: { linkedOrderId: orderId, direction: WalletEntryDirection.COD_COLLECTION },
      select: { id: true },
    });
    if (already) {
      return NOT_CREDITED(mode, 'Already credited');
    }

    const gstPercent = await this.globalDecimal(GST_KEY, DEFAULT_GST_PERCENT);
    // Extracted from a tax-inclusive price. The divisor is (100 + rate),
    // not 100 — see the class comment; getting this wrong over-withholds
    // on every single order.
    const gst = grossInr
      .times(gstPercent)
      .dividedBy(new Prisma.Decimal(100).plus(gstPercent))
      .toDecimalPlaces(2);
    const postGst = grossInr.minus(gst);

    // The base charge for handling COD, on both modes. Seeded at 0, so
    // today this is a no-op — which is exactly when to get the shape
    // right rather than while money is moving through it.
    const collectionPercent = await this.sellerDecimal(
      sellerId,
      COLLECTION_FEE_KEY,
      DEFAULT_COLLECTION_FEE_PERCENT,
    );
    const collectionFee = postGst.times(collectionPercent).dividedBy(100).toDecimalPlaces(2);

    let instantFee = new Prisma.Decimal(0);
    if (mode === 'INSTANT_PAY') {
      const feePercent = await this.sellerDecimal(
        sellerId,
        INSTANT_FEE_KEY,
        DEFAULT_INSTANT_FEE_PERCENT,
      );
      // On the POST-GST amount, and STACKED on the collection fee: this
      // is the premium for early access, not a replacement for the cost
      // of collecting at all. Both are computed off the same base rather
      // than compounding, so the two rates stay independently readable.
      instantFee = postGst.times(feePercent).dividedBy(100).toDecimalPlaces(2);
    }

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
      // The liability record. UNIQUE on orderId, so this is also the
      // second idempotency gate.
      await tx.gstWithholding.create({
        data: {
          sellerId,
          orderId,
          codAmountInr: grossInr,
          gstPercent,
          gstAmountInr: gst,
          netToSellerInr: postGst,
        },
      });
      await this.wallet.applyEntry(tx, {
        sellerId,
        currency: Currency.INR,
        direction: WalletEntryDirection.ORDER_CHARGES,
        amount: gst,
        linkedOrderId: orderId,
        actorType: ActorType.SYSTEM,
        note: `GST withheld at ${gstPercent.toFixed(2)}% (we file this)`,
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
        note: 'Instant Pay — credited at delivery rather than at settlement',
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

  // ── internal ──────────────────────────────────────────────────────

  /** A rate set by law — global, never per-seller. */
  private async globalDecimal(key: string, fallback: string): Promise<Prisma.Decimal> {
    const row = await this.prisma.client.systemSetting.findUnique({
      where: { key },
      select: { valueDecimal: true },
    });
    return new Prisma.Decimal(row?.valueDecimal ?? fallback);
  }

  /** A rate that is negotiated — resolved per seller (SET-1). */
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
