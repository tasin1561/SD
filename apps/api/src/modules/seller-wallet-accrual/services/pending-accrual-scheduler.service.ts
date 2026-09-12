import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { SettingsResolverService } from '../../settings/services/settings-resolver.service';

const ACCRUAL_DELAY_DAYS_KEY = 'wallet.accrual_delay_days';
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * R2b — schedules a T_PLUS_N-tier order's deferred accrual.
 * Idempotent: a pre-existing `PendingAccrual` row for the order is
 * left untouched (a re-fired DELIVERED event must NOT reset the
 * clock — the seller's window was already committed to on first
 * schedule).
 */
@Injectable()
export class PendingAccrualSchedulerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsResolverService,
  ) {}

  async scheduleIfNeeded(orderId: string, sellerId: string): Promise<void> {
    const existing = await this.prisma.client.pendingAccrual.findUnique({
      where: { orderId },
      select: { id: true, skippedReason: true },
    });
    // A row that was CLOSED WITHOUT BILLING (the order was cancelled or
    // lost after an earlier delivery) is re-armed when the order is
    // delivered again — god mode's "lost then found". Without this the
    // one-row-per-order unique would leave the re-delivery unbilled while
    // the loss had already refunded the fee. A row that really executed
    // is never re-armed (its money was taken), and a pending one keeps
    // its original clock.
    if (existing && existing.skippedReason === null) return;

    const delaySetting = await this.settings.resolve(sellerId, ACCRUAL_DELAY_DAYS_KEY);
    const delayDays = Number(delaySetting.value);
    const eligibleAt = new Date(Date.now() + delayDays * DAY_MS);

    if (existing) {
      await this.prisma.client.pendingAccrual.updateMany({
        where: { id: existing.id, skippedReason: { not: null } },
        data: { processedAt: null, skippedReason: null, eligibleAt },
      });
      return;
    }

    await this.prisma.client.pendingAccrual.create({
      data: { orderId, sellerId, eligibleAt },
    });
  }
}
