import { Injectable, Logger } from '@nestjs/common';
import { Currency } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { SettingsResolverService } from '../../settings/services/settings-resolver.service';
import { WalletService } from '../../seller-wallet/services/wallet.service';
import { OrderChargesAccrualService } from './order-charges-accrual.service';

/** Matches the seed value at 'wallet.courier_fee_deduction_timing'. */
const FEE_TIMING_SETTING_KEY = 'wallet.courier_fee_deduction_timing';
const AT_AWB = 'AT_AWB';

/**
 * R1c (revised-plan roadmap) — the AT_AWB half of the courier-fee
 * timing toggle. `OrderDeliveredAccrualListener` (DELIVERED-time,
 * default AT_DELIVERY) is the other half; both share
 * `OrderChargesAccrualService.debitIfNeeded` so the debit math and
 * idempotency gate can never drift between the two timings.
 *
 * Called from `courier-awb`'s AWB-generation loop, best-effort — a
 * failure here must NEVER block AWB generation (the shipment already
 * has a real AWB by the time this runs; the charge can always be
 * caught by the DELIVERED-time fallback if this early attempt fails,
 * since `debitIfNeeded`'s gate is shared and idempotent either way).
 */
@Injectable()
export class CourierFeeAccrualService {
  private readonly logger = new Logger(CourierFeeAccrualService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly chargesAccrual: OrderChargesAccrualService,
    private readonly settings: SettingsResolverService,
  ) {}

  async tryEarlyAccrual(orderId: string): Promise<void> {
    try {
      const order = await this.prisma.client.order.findUnique({
        where: { id: orderId },
        select: { id: true, sellerId: true },
      });
      if (!order) return;

      const resolved = await this.settings.resolve(order.sellerId, FEE_TIMING_SETTING_KEY);
      if (resolved.value !== AT_AWB) return;

      const debited = await this.prisma.client.$transaction((tx) =>
        this.chargesAccrual.debitIfNeeded(tx, order.id, order.sellerId),
      );
      if (debited) {
        await this.wallet.recomputeCacheAfterCommit(
          order.sellerId,
          Currency.INR,
          'post-commit-awb-accrual',
        );
      }
    } catch (err) {
      this.logger.error(
        { orderId, err: err instanceof Error ? err.message : String(err) },
        'AT_AWB early charge accrual failed — will fall back to the DELIVERED-time debit',
      );
    }
  }
}
