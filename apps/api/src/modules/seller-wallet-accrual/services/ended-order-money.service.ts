import { Injectable, Logger } from '@nestjs/common';
import { ActorType, Currency, Prisma, WalletEntryDirection } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { WalletService } from '../../seller-wallet/services/wallet.service';
import { SellerCashAttributionService } from '../../treasury/services/seller-cash-attribution.service';
import { AdvisoryLock, takeAdvisoryLock } from '../../../common/db/advisory-lock';
import { CodCreditService } from './cod-credit.service';

const ZERO = new Prisma.Decimal(0);
const positive = (d: Prisma.Decimal): Prisma.Decimal => (d.greaterThan(0) ? d : ZERO);

/**
 * The money an order must give back when it ENDS without being delivered
 * — called off (cancelled, rejected) or lost — beyond the delivery fee
 * (`OrderChargesRefundService` owns that).
 *
 * Two things, both run post-commit by `OrderPostCommitHooksService` for
 * BOTH writers of `orders.status` (ORD-2 / ORD-3):
 *
 *  1. **Retire the deferred accrual.** On the default T+N tier a delivery
 *     only SCHEDULES its money (`pending_accruals`); the sweep bills it up
 *     to seven days later. A delivery god mode forced and then cancelled
 *     used to be billed anyway — charged, Instant-Pay credited and
 *     freight-billed on a cancelled order, with the cancel's refund having
 *     already run and found nothing. The row is closed here with a reason,
 *     and the sweep re-checks the order itself as the second gate.
 *
 *  2. **Undo an Instant Pay credit no courier ever paid for.** Instant Pay
 *     credits a COD at delivery out of OUR money (WAL-9's front). If the
 *     parcel never left and the order is called off, no customer paid and
 *     no courier will: the credit comes back (`CodCreditService.reverseForOrder`,
 *     which also returns its tax and fee), and the cash the front made the
 *     seller's becomes ours again. Only when NO payout line covers the
 *     order — once a courier has paid, a reversal is the settlement's
 *     business (WAL-6), not this one's.
 */
@Injectable()
export class EndedOrderMoneyService {
  private readonly logger = new Logger(EndedOrderMoneyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly codCredit: CodCreditService,
    private readonly attribution: SellerCashAttributionService,
    private readonly audit: AuditLogService,
  ) {}

  /**
   * Close any not-yet-processed deferred accrual for the order, WITHOUT
   * billing it. Idempotent: a processed row is never touched. Returns how
   * many rows were retired (0 or 1 — one row per order).
   */
  async retirePendingAccrual(orderId: string, reason: string): Promise<number> {
    const res = await this.prisma.client.pendingAccrual.updateMany({
      where: { orderId, processedAt: null },
      data: { processedAt: new Date(), skippedReason: reason },
    });
    return res.count;
  }

  /**
   * Take back an Instant Pay COD credit for an order whose parcel never
   * reached a customer and that no courier payout covers.
   *
   * The bank-book side mirrors the settlement's clawback without the cash
   * leaving: no money ever arrived (the credit was fronted), so nothing
   * leaves the account — the seller's share of it simply becomes ours
   * again. After the reversal and the refunds of its tax and fee (which
   * move their own shares back as each is written), the seller must hold
   * exactly `max(0, wallet)`; the part that stops being theirs is
   * `max(0, before) − max(0, before − gross)` — the same arithmetic
   * `CourierSettlementService` uses for an RTO reversal.
   */
  async reverseUncoveredInstantPayCredit(
    orderId: string,
    sellerId: string,
    note: string,
  ): Promise<{ readonly reversed: boolean; readonly reason?: string }> {
    const outcome = await this.prisma.client.$transaction(async (tx) => {
      await takeAdvisoryLock(tx, AdvisoryLock.WALLET, `${sellerId}|${Currency.INR}`);
      const paid = await tx.courierSettlementLine.count({ where: { orderId } });
      if (paid > 0) return { reversed: false, reason: 'COURIER_PAYOUT_RECORDED' } as const;

      const before = await this.attribution.walletBalance(tx, sellerId);
      const res = await this.codCredit.reverseForOrder(tx, { orderId, sellerId, note });
      if (!res.reversed) return { reversed: false, reason: res.reason ?? 'NOT_REVERSED' } as const;

      const gross = new Prisma.Decimal(res.grossInr);
      const take = positive(before).sub(positive(before.sub(gross)));
      // Referenced by the REVERSAL entry, never by the order id: the front
      // is the ONLY pair referenced by an order id (WAL-9), and a second
      // one would be miscounted as cash fronted.
      const reversal = await tx.sellerWalletEntry.findFirst({
        where: { linkedOrderId: orderId, direction: WalletEntryDirection.COD_REVERSAL },
        orderBy: { id: 'desc' },
        select: { id: true },
      });
      if (take.greaterThan(0)) {
        await this.attribution.takeToCapital(tx, {
          sellerId,
          amount: take,
          reference: reversal?.id ?? orderId,
          note: 'Instant Pay credit undone — the parcel never reached a customer',
        });
      }
      await this.audit.log(
        {
          actorType: ActorType.SYSTEM,
          actorId: null,
          sellerId,
          action: 'wallet.instant_pay_credit_reversed',
          entityType: 'order',
          entityId: orderId,
          severity: 'HIGH',
          metadata: {
            grossInr: res.grossInr,
            deductionsReturnedInr: res.returnedInr,
            cashReturnedToCapitalInr: take.toFixed(2),
            note,
          },
        },
        tx,
      );
      return { reversed: true } as const;
    });
    if (outcome.reversed) {
      await this.wallet.recomputeCacheAfterCommit(sellerId, Currency.INR, 'instant-pay-reversal');
      this.logger.log({ orderId, sellerId }, 'Instant Pay credit reversed on an ended order');
    }
    return outcome;
  }
}
