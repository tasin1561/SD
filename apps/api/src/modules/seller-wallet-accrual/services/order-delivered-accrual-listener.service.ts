import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ActorType, OrderStatus, SystemIssueKind, SystemIssueSeverity } from '@skydrop/db';
import type { Subscription } from 'rxjs';
import {
  OrderLifecycleEventBus,
  type OrderLifecycleEvent,
} from '../../lifecycle-events/order-lifecycle-event-bus.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { SystemIssueService } from '../../system-issues/services/system-issue.service';
import { DeliveredAccrualService } from './delivered-accrual.service';

/**
 * One open issue per order whose delivery-time money did not run
 * (2026-09-19). Every failure here used to be a HIGH audit row and
 * nothing else, and nothing reads audit rows: a delivered order could
 * stay unbilled, an Instant Pay seller uncredited and a freight share
 * uncollected, with the first sign being a figure somebody queried
 * weeks later. It clears itself the next time the accrual runs.
 */
export function deliveredAccrualFailedKey(orderId: string): string {
  return `delivered-accrual-failed:${orderId}`;
}

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
    private readonly issues: SystemIssueService,
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
      await this.issues.resolveByKey(
        deliveredAccrualFailedKey(event.orderId),
        'The delivery-time money ran.',
      );
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
      // The audit row is the HISTORY. It is NOT the alarm — nothing
      // reads audit rows, which is exactly how a delivered order could
      // stay unbilled until somebody queried a figure weeks later. Every
      // step of the accrual is idempotent under the WALLET lock, so
      // re-running `handle` once the cause is dealt with is the fix, and
      // that success clears this.
      await this.issues.raise({
        kind: SystemIssueKind.MONEY,
        severity: SystemIssueSeverity.HIGH,
        title: 'A delivered order was not billed',
        detail:
          `This order reached DELIVERED and the money that goes with it failed: ${error}\n\n` +
          'Depending on how far it got, the delivery charge may not have been taken, an Instant ' +
          'Pay seller may not have been credited their COD, and the inbound-freight share of the ' +
          'units that left may still be owed. Every step is idempotent under the wallet lock, so ' +
          'the fix is to re-run it; this clears itself once the delivery-time money runs.',
        source: 'OrderDeliveredAccrualListener',
        dedupeKey: deliveredAccrualFailedKey(event.orderId),
        metadata: {
          orderId: event.orderId,
          sellerId: event.sellerId,
          trigger,
          fromStatus: event.from,
          statusEventId: event.statusEventId,
          error,
        },
      });
    }
  }
}
