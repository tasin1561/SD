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
      select: { id: true },
    });
    if (existing) return;

    const delaySetting = await this.settings.resolve(sellerId, ACCRUAL_DELAY_DAYS_KEY);
    const delayDays = Number(delaySetting.value);
    const eligibleAt = new Date(Date.now() + delayDays * DAY_MS);

    await this.prisma.client.pendingAccrual.create({
      data: { orderId, sellerId, eligibleAt },
    });
  }
}
