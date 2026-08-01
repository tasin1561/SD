import { Injectable } from '@nestjs/common';
import {
  ActorType,
  ChargeType,
  Currency,
  OrderChargeStatus,
  Prisma,
  WalletEntryDirection,
} from '@skydrop/db';
import { WalletService } from '../../seller-wallet/services/wallet.service';
import { PricingEngineService } from '../../pricing/services/pricing-engine.service';
import { OrderChargesAccrualService } from './order-charges-accrual.service';

/**
 * What a returned parcel costs.
 *
 * A return is charged twice over, and both halves land HERE, at the
 * moment the parcel is physically received:
 *
 *   1. **The delivery fee.** The courier carried the parcel out and
 *      attempted it; that leg happened and is owed regardless of the
 *      outcome. For a seller on AT_AWB timing it was already debited and
 *      this is a no-op. For one on AT_DELIVERY it was NOT — an order
 *      that returns never reaches DELIVERED, so without this step the
 *      trip would have been free. Charging it here is what makes a
 *      returned parcel cost delivery + RTO rather than RTO alone.
 *
 *   2. **The flat RTO fee**, its own `WalletEntryDirection.RTO_FEE` so
 *      "what did returns cost this month" is a question the ledger can
 *      answer without unpicking ORDER_CHARGES.
 *
 * With the seeded defaults that is 200 + 30 = 230.
 *
 * ── Why at RECEIVE and not at RTO_INITIATED ───────────────────────────
 * A courier scan saying a parcel is coming back is not the parcel coming
 * back. Scans get reversed, and a debit taken on one would have to be
 * refunded — which means an adjusting wallet entry, and a seller
 * watching money move twice for one event. Physical receipt is the fact.
 *
 * Idempotent on both halves: one RTO_FEE wallet entry per order, and the
 * delivery-fee sweep carries its own gate.
 */
@Injectable()
export class RtoFeeAccrualService {
  constructor(
    private readonly wallet: WalletService,
    private readonly pricing: PricingEngineService,
    private readonly chargesAccrual: OrderChargesAccrualService,
  ) {}

  /**
   * Charge a received return. Composes into the caller's transaction.
   *
   * Returns what actually moved, so the caller can log it — a silent
   * `false` from a money path is hard to investigate later.
   */
  async chargeOnReceive(
    tx: Prisma.TransactionClient,
    orderId: string,
    sellerId: string,
  ): Promise<{ deliveryFeeSwept: boolean; rtoFeeInr: string | null }> {
    // 1. The outbound leg, if nobody has charged it yet.
    //
    // Ordering matters: this sums the order's charge lines, so it must
    // run BEFORE the RTO_FEE line exists or the fee would be swept into
    // the ORDER_CHARGES debit as well as taken on its own. The sum also
    // skips RTO_FEE lines defensively — see OrderChargesAccrualService.
    const deliveryFeeSwept = await this.chargesAccrual.debitIfNeeded(tx, orderId, sellerId);

    // 2. The return fee itself.
    const already = await tx.sellerWalletEntry.findFirst({
      where: { linkedOrderId: orderId, direction: WalletEntryDirection.RTO_FEE },
      select: { id: true },
    });
    if (already) return { deliveryFeeSwept, rtoFeeInr: null };

    const fee = await this.pricing.resolveRtoFee(sellerId);
    if (fee.amount.lessThanOrEqualTo(0)) {
      // A zero fee is a legitimate configuration — a seller may have
      // been given free returns — so this is a quiet no-op, not an error.
      return { deliveryFeeSwept, rtoFeeInr: null };
    }

    // The charge line first, so the order's breakdown explains the debit
    // rather than the seller finding an unexplained deduction.
    await tx.orderCharge.create({
      data: {
        orderId,
        type: ChargeType.RTO_FEE,
        description: 'Return fee (flat)',
        amountInr: fee.amount,
        // No GST decomposition: the flat fees carry
        // pricing.flat_fee_gst_percent (seeded 0), so today the fee IS
        // the total. When that setting moves to 18 this line gains a tax
        // component alongside the delivery fee's.
        totalAmountInr: fee.amount,
        status: OrderChargeStatus.CONFIRMED,
        isVisibleToSeller: true,
        displayOrder: 100,
      },
    });

    await this.wallet.applyEntry(tx, {
      sellerId,
      currency: Currency.INR,
      direction: WalletEntryDirection.RTO_FEE,
      amount: fee.amount,
      linkedOrderId: orderId,
      actorType: ActorType.SYSTEM,
    });

    return { deliveryFeeSwept, rtoFeeInr: fee.amount.toFixed(2) };
  }
}
