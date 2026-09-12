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
import { AdvisoryLock, takeAdvisoryLock } from '../../../common/db/advisory-lock';

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
    // WAL-7: the idempotency read must be serialised against a
    // concurrent one, or both see "not charged" and both charge.
    await takeAdvisoryLock(tx, AdvisoryLock.WALLET, `${sellerId}|${Currency.INR}`);

    // Billed means MORE charges than refunds (2026-09-12). A charge that
    // was refunded — the parcel was lost, or the order called off — and
    // the order then delivered after all ("lost then found", god mode)
    // owes the fee again; a plain "a charge exists" gate left it refunded
    // AND unbilled. `OrderChargesRefundService` pairs them the same way.
    const [charged, refunded] = await Promise.all([
      tx.sellerWalletEntry.count({
        where: { linkedOrderId: orderId, direction: WalletEntryDirection.ORDER_CHARGES },
      }),
      tx.sellerWalletEntry.count({
        where: { linkedOrderId: orderId, direction: WalletEntryDirection.ORDER_CHARGES_REFUND },
      }),
    ]);
    if (charged > refunded) return false;

    const charges = await tx.orderCharge.findMany({
      where: { orderId, deletedAt: null },
      select: { id: true, type: true, amountInr: true, status: true },
    });
    const billedIds: string[] = [];
    let total = new Prisma.Decimal(0);
    // What the total is MADE OF, in the seller's own ledger.
    //
    // Every other direction says what it was — "COD collected
    // (settled)", "GST withheld at 18.00%" — and this one, the largest
    // category by count, said nothing at all: nine of nine rows in
    // production carried a null note. A seller reading their ledger saw
    // "Order charges" and a number, and had to open the order to learn
    // it was delivery plus tax.
    const parts: string[] = [];
    for (const c of charges) {
      if (c.type === ChargeType.REFUND) continue;
      // The return fee has its OWN wallet direction (RTO_FEE) and is
      // taken separately at RTO receive. Summing it here too would
      // charge it twice — and the second charge would be invisible,
      // buried inside an ORDER_CHARGES total.
      if (c.type === ChargeType.RTO_FEE) continue;
      total = total.add(c.amountInr);
      if (c.status === OrderChargeStatus.ESTIMATED) billedIds.push(c.id);
      parts.push(`${c.type.toLowerCase().replaceAll('_', ' ')} ${c.amountInr.toFixed(2)}`);
    }
    if (total.lte(0)) return false;

    await this.wallet.applyEntry(tx, {
      sellerId,
      currency: Currency.INR,
      direction: WalletEntryDirection.ORDER_CHARGES,
      amount: total,
      linkedOrderId: orderId,
      actorType: ActorType.SYSTEM,
      note: `Order charges — ${parts.join(', ')}`,
    });

    // The lines just billed are no longer an estimate. CONFIRMED is what
    // the RTO fee is written as at the moment it is billed, and these
    // stayed ESTIMATED after the wallet had been debited for them — the
    // order page read "base shipping · estimated" on a fee the seller had
    // paid. Same transaction as the debit, so the two cannot disagree;
    // exactly the rows summed above; status only, no amount moves.
    if (billedIds.length > 0) {
      await tx.orderCharge.updateMany({
        where: { id: { in: billedIds }, status: OrderChargeStatus.ESTIMATED },
        data: { status: OrderChargeStatus.CONFIRMED },
      });
    }
    return true;
  }
}
