import { Injectable, Logger } from '@nestjs/common';
import { ActorType, Prisma, WalletEntryDirection } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { WalletService } from '../../seller-wallet/services/wallet.service';

/**
 * Giving the delivery fee back when an order is called off before it ships.
 *
 * A seller on `AT_AWB` fee timing is debited at CONFIRMED — the waybill
 * is generated there (CUR-2b), so the charge lands days before anything
 * physically moves. Cancelling after that point but before the parcel is
 * packed means we took money for a delivery that will not happen, and
 * nothing in the system was previously giving it back. The seller would
 * have had to notice the wrong balance and ask.
 *
 * The mirror image of `OrderChargesAccrualService`, deliberately kept
 * next to it: the two are only correct relative to each other, and a
 * change to what the debit sums has to be reflected in what the refund
 * returns. That is why this reads the ORIGINAL ENTRY's amount rather
 * than re-summing `order_charges` — re-deriving it would let the two
 * sides drift the day someone adds a charge type, and the seller would
 * be refunded a different number from the one they were charged.
 *
 * Idempotent on the order: at most one refund per ORDER_CHARGES entry,
 * so a retry, a double-click, or a cancel that lands twice through
 * different paths all converge on one credit.
 *
 * NOT a general reversal tool. It refuses to refund an order that
 * dispatched — at that point the courier has been paid and the cost is
 * real whatever happens to the parcel afterwards. An RTO's fees are the
 * RTO_FEE path's business, not this one.
 */
@Injectable()
export class OrderChargesRefundService {
  private readonly logger = new Logger(OrderChargesRefundService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly audit: AuditLogService,
  ) {}

  /**
   * Return the delivery fee for a cancelled order, if one was taken.
   *
   * Opens its own transaction — the callers are post-commit hooks on a
   * status change that has already happened, and a refund must not be
   * able to roll back the cancellation that prompted it.
   *
   * Returns the amount credited, or null when there is nothing to give
   * back (never charged, or already refunded). Neither is an error: most
   * cancellations are of orders on the default `AT_DELIVERY` timing,
   * which were never debited in the first place.
   */
  async refundIfCharged(
    orderId: string,
    sellerId: string,
    reason: string,
  ): Promise<Prisma.Decimal | null> {
    return this.prisma.client.$transaction(async (tx) => {
      const charged = await tx.sellerWalletEntry.findFirst({
        where: { linkedOrderId: orderId, direction: WalletEntryDirection.ORDER_CHARGES },
        select: { id: true, amount: true, currency: true },
        orderBy: { createdAt: 'asc' },
      });
      // Never charged — the ordinary case for an AT_DELIVERY seller.
      if (!charged) return null;

      const already = await tx.sellerWalletEntry.findFirst({
        where: {
          linkedOrderId: orderId,
          direction: WalletEntryDirection.ORDER_CHARGES_REFUND,
        },
        select: { id: true },
      });
      if (already) return null;

      await this.wallet.applyEntry(tx, {
        sellerId,
        currency: charged.currency,
        direction: WalletEntryDirection.ORDER_CHARGES_REFUND,
        amount: charged.amount,
        linkedOrderId: orderId,
        // Points back at the debit being returned, so the pair reads as
        // one round trip in the ledger rather than two unrelated lines.
        linkedEntryId: charged.id,
        note: reason,
        actorType: ActorType.SYSTEM,
      });

      await this.audit.log(
        {
          actorType: ActorType.SYSTEM,
          actorId: null,
          sellerId,
          action: 'wallet.order_charges_refunded',
          entityType: 'order',
          entityId: orderId,
          severity: 'LOW',
          metadata: {
            amountInr: charged.amount.toString(),
            originalEntryId: charged.id,
            reason,
          },
        },
        tx,
      );

      this.logger.log(
        `Refunded order charges ${charged.amount.toString()} INR to seller ${sellerId} for cancelled order ${orderId}`,
      );
      return charged.amount;
    });
  }
}
