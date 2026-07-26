import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { OrderStatus } from '@skydrop/db';
import type { Subscription } from 'rxjs';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  OrderLifecycleEventBus,
  type OrderLifecycleEvent,
} from '../../lifecycle-events/order-lifecycle-event-bus.service';
import { SettingsResolverService } from '../../settings/services/settings-resolver.service';
import { AccrualExecutionService } from './accrual-execution.service';
import { PendingAccrualSchedulerService } from './pending-accrual-scheduler.service';

const ACCRUAL_TIMING_TIER_KEY = 'wallet.accrual_timing_tier';
const T_PLUS_N = 'T_PLUS_N';

/**
 * Phase 1B M22 — COD accrual on DELIVERED. R2b extended this to a
 * per-seller TIMING TIER dispatcher:
 *   INSTANT (default, today's exact behavior) → executes immediately
 *     via `AccrualExecutionService.executeAccrual()`.
 *   T_PLUS_N (seller opt-in) → schedules a `PendingAccrual` row
 *     instead; `PendingAccrualSweepService` executes it later, via the
 *     SAME `AccrualExecutionService`, once the seller's delay window
 *     elapses. `WalletService.applyEntry` is the sole ledger writer
 *     either way — this listener never touches it directly anymore.
 *
 * Discipline (mirrors M11 NotificationListener):
 *  - Subscribes on `OnApplicationBootstrap`; in-flight Promises
 *    tracked in a Set; `OnModuleDestroy` drains them so e2e teardown
 *    is deterministic.
 *  - Per-event `handle()` runs in its own try/catch wrapper. A
 *    failure NEVER reaches back to the OrderLifecycleEventBus
 *    emitter (NOTIF-1 best-effort discipline).
 *
 * PREPAID orders DO NOT accrue COD. They have charges, but those
 * charges were collected at checkout (or netted off the prepaid
 * top-up — Phase 2). For Phase 1B PREPAID DELIVERED we write a
 * DEBIT-only entry so the seller still owes us the shipping cost.
 */
@Injectable()
export class OrderDeliveredAccrualListener
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(OrderDeliveredAccrualListener.name);
  private subscription: Subscription | null = null;
  private readonly inFlight = new Set<Promise<void>>();

  constructor(
    private readonly bus: OrderLifecycleEventBus,
    private readonly prisma: PrismaService,
    private readonly settings: SettingsResolverService,
    private readonly execution: AccrualExecutionService,
    private readonly scheduler: PendingAccrualSchedulerService,
  ) {}

  onApplicationBootstrap(): void {
    this.subscription = this.bus.subscribe((event) => {
      const p = this.handle(event)
        .catch((err) => {
          this.logger.error(
            {
              err: (err as Error).message,
              orderId: event.orderId,
              to: event.to,
            },
            'OrderDeliveredAccrualListener.handle threw; swallowed',
          );
        })
        .finally(() => {
          this.inFlight.delete(p);
        });
      this.inFlight.add(p);
    });
    this.logger.log(
      'OrderDeliveredAccrualListener subscribed to OrderLifecycleEventBus',
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = null;
    }
    if (this.inFlight.size > 0) {
      await Promise.allSettled([...this.inFlight]);
    }
  }

  /** Test-harness drain seam. */
  async drainInFlight(): Promise<void> {
    if (this.inFlight.size > 0) {
      await Promise.allSettled([...this.inFlight]);
    }
  }

  /** Public — mirrors NotificationListener.handle: testable directly,
   *  doubles as a manual re-trigger. */
  async handle(event: OrderLifecycleEvent): Promise<void> {
    if (event.to !== OrderStatus.DELIVERED) return;

    const order = await this.prisma.client.order.findUnique({
      where: { id: event.orderId },
      select: { id: true, sellerId: true },
    });
    if (!order) {
      this.logger.warn(
        { orderId: event.orderId },
        'Order vanished between lifecycle emit and accrual handler; skipping',
      );
      return;
    }

    const tier = await this.settings.resolve(order.sellerId, ACCRUAL_TIMING_TIER_KEY);
    if (tier.value === T_PLUS_N) {
      await this.scheduler.scheduleIfNeeded(order.id, order.sellerId);
      return;
    }

    // INSTANT (default) — execute immediately, exactly as before R2b.
    await this.execution.executeAccrual(order.id);
  }
}
