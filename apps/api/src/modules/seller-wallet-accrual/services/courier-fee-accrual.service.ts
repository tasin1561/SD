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
 * Called wherever a parcel is ENTERED WITH A COURIER — the Delhivery
 * AWB-generation loop AND manual placement, which is how a parcel goes
 * out with anyone else. It used to be wired only to the Delhivery path,
 * so a manually-placed parcel on an AT_AWB seller was never charged at
 * entry and quietly fell through to the DELIVERED-time debit. Same
 * physical event, so the same hook belongs on both.
 *
 * Best-effort — a failure here must NEVER block the parcel going out.
 * The shipment already has a real AWB by the time this runs, and the
 * charge is caught by the DELIVERED-time fallback if this attempt
 * fails, since `debitIfNeeded`'s gate is shared and idempotent either
 * way. That is also why an insufficient balance is not enforced here:
 * refusing to charge would silently ship for free, and refusing to
 * SHIP is a decision that belongs upstream of a parcel that already
 * has a waybill.
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
