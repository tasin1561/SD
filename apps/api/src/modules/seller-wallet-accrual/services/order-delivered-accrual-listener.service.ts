import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ActorType, OrderStatus } from '@skydrop/db';
import type { Subscription } from 'rxjs';
import {
  OrderLifecycleEventBus,
  type OrderLifecycleEvent,
} from '../../lifecycle-events/order-lifecycle-event-bus.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { DeliveredAccrualService } from './delivered-accrual.service';

/**
 * The ONE path by which a delivery is billed. The work itself — tier
 * dispatch, the charges debit, the Instant Pay COD credit, the freight
 * share — is `DeliveredAccrualService`. Both writers of DELIVERED reach
 * it through here: a matrix transition, and god mode (ORD-2), which since
 * 2026-09-12 emits the same lifecycle event (`source: ADMIN_OVERRIDE`)
 * instead of calling the accrual itself. God mode bills on purpose — it
 * opts out of stock compensation, not money — so the source is not
 * consulted here. Exactly-once rests on the accrual's own
 * in-transaction gates, so a second event for one order (a forced
 * DELIVERED → CANCELLED → DELIVERED, a replay) charges nothing twice.
 *
 * A failure cannot undo the status change that prompted it, but it is
 * NOT quiet: it audits HIGH `wallet.delivered_accrual_failed`, naming the
 * order and which writer delivered it. "Bill unbilled orders" on /wallets
 * is the catch-up and bills on the same gates.
 *
 * Phase 1B M22 — COD accrual on DELIVERED. R2b extended this to a
 * per-seller TIMING TIER dispatcher:
 *   INSTANT (a per-seller opt-in since 2026-07-26; was the default) →
 *   executes immediately
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
export class OrderDeliveredAccrualListener implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OrderDeliveredAccrualListener.name);
  private subscription: Subscription | null = null;
  private readonly inFlight = new Set<Promise<void>>();

  constructor(
    private readonly bus: OrderLifecycleEventBus,
    private readonly delivered: DeliveredAccrualService,
    private readonly audit: AuditLogService,
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
    this.logger.log('OrderDeliveredAccrualListener subscribed to OrderLifecycleEventBus');
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
    try {
      await this.delivered.accrueForDelivered(event.orderId);
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      const trigger = event.source === 'ADMIN_OVERRIDE' ? 'force_mutation' : 'lifecycle_transition';
      this.logger.error(
        { orderId: event.orderId, sellerId: event.sellerId, trigger, err: error },
        'Delivery-time accrual FAILED — the order is delivered and unbilled',
      );
      await this.audit
        .log({
          actorType: ActorType.SYSTEM,
          actorId: null,
          sellerId: event.sellerId,
          action: 'wallet.delivered_accrual_failed',
          entityType: 'order',
          entityId: event.orderId,
          severity: 'HIGH',
          metadata: {
            trigger,
            fromStatus: event.from,
            statusEventId: event.statusEventId,
            error,
          },
        })
        .catch(() => undefined);
    }
  }
}
