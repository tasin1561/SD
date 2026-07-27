import { Injectable, Logger } from '@nestjs/common';
import { ActorType, Currency, PaymentMode, Prisma, WalletEntryDirection } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { WalletService } from '../../seller-wallet/services/wallet.service';
import { OrderChargesAccrualService } from './order-charges-accrual.service';
import { InboundFreightAmortisationService } from '../../inbound-freight/services/inbound-freight-amortisation.service';

/**
 * R2b (revised-plan roadmap) — the actual COD-credit + charges-debit
 * execution, extracted verbatim from `OrderDeliveredAccrualListener`'s
 * body (R1c shape) so it can be invoked from TWO different moments:
 * immediately on DELIVERED for INSTANT-tier sellers (an opt-in since
 * 2026-07-26;
 * unchanged behavior), or later by `PendingAccrualSweepService` for
 * T_PLUS_N-tier sellers. `WalletService.applyEntry` stays the sole
 * ledger writer either way — only the CALLER and its timing differ.
 *
 * Idempotent by construction (same gates as before the extraction): a
 * pre-existing COD_COLLECTION entry skips the credit; ORDER_CHARGES is
 * gated independently inside `OrderChargesAccrualService.debitIfNeeded`.
 * Safe to call more than once for the same order.
 */
@Injectable()
export class AccrualExecutionService {
  private readonly logger = new Logger(AccrualExecutionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly chargesAccrual: OrderChargesAccrualService,
    private readonly freightAmortisation: InboundFreightAmortisationService,
  ) {}

  async executeAccrual(orderId: string): Promise<void> {
    const order = await this.prisma.client.order.findUnique({
      where: { id: orderId },
      select: { id: true, sellerId: true, paymentMode: true, codAmountInr: true },
    });
    if (!order) {
      this.logger.warn({ orderId }, 'Order vanished before accrual execution; skipping');
      return;
    }

    await this.prisma.client.$transaction(async (tx) => {
      // Read the already-credited guard INSIDE the transaction, matching
      // the two sibling services that do the same job
      // (OrderChargesAccrualService, InboundFreightAmortisationService).
      // Outside it, the check and the credit are separate operations and
      // two concurrent runs could each see "not yet credited" and each pay
      // the seller. Not reachable today — the sweep worker is concurrency
      // 1 and the INSTANT listener path is mutually exclusive with the
      // T+N one — but a guard whose correctness rests on there only ever
      // being one caller is a guard waiting to be wrong.
      const codAlready = await tx.sellerWalletEntry.findFirst({
        where: { linkedOrderId: orderId, direction: WalletEntryDirection.COD_COLLECTION },
        select: { id: true },
      });

      if (!codAlready && order.paymentMode === PaymentMode.COD) {
        const codAmount = order.codAmountInr ?? new Prisma.Decimal(0);
        if (codAmount.gt(0)) {
          await this.wallet.applyEntry(tx, {
            sellerId: order.sellerId,
            currency: Currency.INR,
            direction: WalletEntryDirection.COD_COLLECTION,
            amount: codAmount,
            linkedOrderId: order.id,
            actorType: ActorType.SYSTEM,
          });
        }
      }

      await this.chargesAccrual.debitIfNeeded(tx, order.id, order.sellerId);

      // R3 amortisation: the delivered units' share of the BD→India
      // inbound freight bill. Separate from ORDER_CHARGES (that is the
      // outbound India-domestic courier leg) and charged per unit, so the
      // rest of the consignment still owes. No-op for orders whose goods
      // came from a PAY_NOW consignment or from no billed consignment at
      // all.
      await this.freightAmortisation.debitForDeliveredOrder(tx, order.id, order.sellerId);
    });

    await this.wallet.recomputeCacheAfterCommit(
      order.sellerId,
      Currency.INR,
      'post-commit-accrual',
    );
  }
}
