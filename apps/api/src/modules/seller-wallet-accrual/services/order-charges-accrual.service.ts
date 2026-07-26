import { Injectable } from '@nestjs/common';
import { ActorType, ChargeType, Currency, Prisma, WalletEntryDirection } from '@skydrop/db';
import { WalletService } from '../../seller-wallet/services/wallet.service';

/**
 * R1c (revised-plan roadmap) — the shared ORDER_CHARGES debit,
 * extracted so it can be triggered at TWO different moments in an
 * order's life: at DELIVERED (the existing, default timing —
 * `OrderDeliveredAccrualListener`) or early at AWB-generation time
 * (the new `wallet.courier_fee_deduction_timing = AT_AWB` seller
 * option — `CourierFeeAccrualService`). Both callers own their own
 * transaction and pass it in; this service never opens one itself, so
 * the DELIVERED path can still pair its debit with the COD credit in
 * ONE transaction when neither has happened yet (today's exact
 * behavior), while the AT_AWB path runs in its own, earlier
 * transaction — an unavoidable consequence of debiting well before
 * delivery, not a weakening of the existing pairing.
 *
 * Idempotent: at most one ORDER_CHARGES entry per order, checked
 * INSIDE the caller's tx (so a concurrent caller sees a consistent
 * view). Returns `false` (no-op) when already debited or when there's
 * nothing to charge (total <= 0) — never throws for either case.
 */
@Injectable()
export class OrderChargesAccrualService {
  constructor(private readonly wallet: WalletService) {}

  async debitIfNeeded(
    tx: Prisma.TransactionClient,
    orderId: string,
    sellerId: string,
  ): Promise<boolean> {
    const already = await tx.sellerWalletEntry.findFirst({
      where: { linkedOrderId: orderId, direction: WalletEntryDirection.ORDER_CHARGES },
      select: { id: true },
    });
    if (already) return false;

    const charges = await tx.orderCharge.findMany({
      where: { orderId, deletedAt: null },
      select: { type: true, amountInr: true },
    });
    let total = new Prisma.Decimal(0);
    for (const c of charges) {
      if (c.type === ChargeType.REFUND) continue;
      total = total.add(c.amountInr);
    }
    if (total.lte(0)) return false;

    await this.wallet.applyEntry(tx, {
      sellerId,
      currency: Currency.INR,
      direction: WalletEntryDirection.ORDER_CHARGES,
      amount: total,
      linkedOrderId: orderId,
      actorType: ActorType.SYSTEM,
    });
    return true;
  }
}
