import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { OrderStatus } from '@skydrop/db';
import type { Subscription } from 'rxjs';
import {
  OrderLifecycleEventBus,
  type OrderLifecycleEvent,
} from '../../lifecycle-events/order-lifecycle-event-bus.service';
import { CallQueueService } from '../../call-queue/services/call-queue.service';

/**
 * A failed delivery puts the customer back in front of an agent.
 *
 * The courier's driver could not hand the parcel over. Somebody has to
 * find out why — a wrong flat number, a customer at work until seven, a
 * phone that was switched off — and the only party who can is us, on the
 * phone. Leaving it to the courier's own retry means the second attempt
 * fails for exactly the reason the first one did.
 *
 * ── WHY A BUS LISTENER, NOT THE WEBHOOK PROCESSOR ────────────────────
 * The processor's saga is delivery_attempts FIRST, tracking_event
 * SECOND, transition LAST, and its correctness rests on that ordering.
 * Hanging a queue write off the end of it would put a fourth step inside
 * a sequence designed around three. The bus is post-commit by
 * construction and best-effort by contract (NOTIF-1), which is exactly
 * what this is: the failed delivery is the durable fact, the call is a
 * consequence, and a queue that could not be written must never undo the
 * scan that caused it.
 *
 * Idempotent by construction — `enqueueOrder` no-ops on an existing OPEN
 * entry via the partial unique (CC-6), so a repeat NDR scan on an order
 * already queued adds nothing.
 */
@Injectable()
export class DeliveryFailedListener implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(DeliveryFailedListener.name);
  private subscription: Subscription | null = null;
  /**
   * In-flight work, drained on shutdown.
   *
   * The M11 listener leak is the reference: `handle()` is spawned
   * detached, so without this the e2e harness's TRUNCATE deadlocks
   * against a queue INSERT that outlived its test.
   */
  private readonly inFlight = new Set<Promise<void>>();

  constructor(
    private readonly bus: OrderLifecycleEventBus,
    private readonly queue: CallQueueService,
  ) {}

  onApplicationBootstrap(): void {
    this.subscription = this.bus.subscribe((event) => {
      const p = this.handle(event)
        .catch((err: unknown) => {
          this.logger.warn(
            { orderId: event.orderId, err: err instanceof Error ? err.message : String(err) },
            'Could not queue a call after a failed delivery — the NDR itself is recorded',
          );
        })
        .finally(() => this.inFlight.delete(p));
      this.inFlight.add(p);
    });
  }

  async onModuleDestroy(): Promise<void> {
    this.subscription?.unsubscribe();
    this.subscription = null;
    await this.drainInFlight();
  }

  /** Public so the e2e harness can quiesce between tests (M11 discipline). */
  async drainInFlight(): Promise<void> {
    await Promise.allSettled([...this.inFlight]);
  }

  private async handle(event: OrderLifecycleEvent): Promise<void> {
    if (event.to !== OrderStatus.DELIVERY_FAILED) return;
    const result = await this.queue.enqueueOrder(event.orderId);
    this.logger.log(
      { orderId: event.orderId, created: result.created },
      'Failed delivery queued for a call',
    );
  }
}
