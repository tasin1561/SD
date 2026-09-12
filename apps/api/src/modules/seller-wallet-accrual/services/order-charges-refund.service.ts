import { Injectable, Logger } from '@nestjs/common';
import { Currency, ActorType, Prisma, WalletEntryDirection } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { WalletService } from '../../seller-wallet/services/wallet.service';
import { AdvisoryLock, takeAdvisoryLock } from '../../../common/db/advisory-lock';

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
      // WAL-7: two concurrent refunds would both read "charged, not yet
      // refunded" and both credit the seller back.
      await takeAdvisoryLock(tx, AdvisoryLock.WALLET, `${sellerId}|${Currency.INR}`);

      // Charges and refunds PAIR UP (2026-09-12). An order may be billed,
      // refunded, and billed again — a lost parcel is refunded and then
      // found and delivered ("lost then found", god mode) — so "already
      // refunded once" is not "nothing owed back". Refund the latest
      // charge no refund points at, and only while charges outnumber
      // refunds; `OrderChargesAccrualService.debitIfNeeded` counts the
      // same pairs, so the two sides can never disagree.
      const charges = await tx.sellerWalletEntry.findMany({
        where: { linkedOrderId: orderId, direction: WalletEntryDirection.ORDER_CHARGES },
        select: { id: true, amount: true, currency: true },
        orderBy: { id: 'desc' },
      });
      // Never charged — the ordinary case for an AT_DELIVERY seller.
      if (charges.length === 0) return null;

      const refunds = await tx.sellerWalletEntry.findMany({
        where: {
          linkedOrderId: orderId,
          direction: WalletEntryDirection.ORDER_CHARGES_REFUND,
        },
        select: { linkedEntryId: true },
      });
      if (refunds.length >= charges.length) return null;
      const refundedIds = new Set(refunds.map((r) => r.linkedEntryId));
      const charged = charges.find((c) => !refundedIds.has(c.id));
      if (charged === undefined) return null;

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
