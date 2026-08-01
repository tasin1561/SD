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
import { AwbGenerationQueue } from '../queue/awb-generation.queue';

/**
 * Fires AWB generation when an order reaches CONFIRMED.
 *
 * ── WHY A BUS LISTENER AND NOT A CALL FROM transitionStatus ─────────
 * `courier-awb` already imports `OrderWriteService` (it routes a
 * refused shipment to PENDING_MANUAL_PLACEMENT). Having the order
 * module call the AWB queue back would close a module cycle. The
 * codebase's answer to that shape is the R3 dependency-free primitive:
 * order publishes to `OrderLifecycleEventBus`, and whoever cares
 * subscribes. This is the SECOND subscriber, after M11's
 * NotificationListener, and follows its shape deliberately.
 *
 * ── WHY AT CONFIRMATION AT ALL ─────────────────────────────────────
 * The AWB used to be created when a supervisor closed the manifest —
 * after the parcel was picked and packed. That left the pack bench
 * with nothing meaningful to scan, and meant an unserviceable pincode
 * was found only once the goods had been handled. Creating it here
 * puts a real shipping label on the bench before picking starts.
 * `AwbGenerationJobService.processOrder` carries the full rationale
 * and the cost.
 *
 * ── BEST-EFFORT, LIKE EVERY OTHER POST-COMMIT HOOK ─────────────────
 * A failure to enqueue must never undo a committed confirmation. It is
 * swallowed at three layers (the bus' own emit wrapper, the subscribe
 * wrapper here, and the catch on the handler), and it is recoverable:
 * manifest close still enqueues its own job, and CUR-9's
 * already-has-an-AWB gate makes that a catch-up rather than a second
 * courier call.
 */
@Injectable()
export class OrderConfirmedAwbListener implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OrderConfirmedAwbListener.name);
  private subscription: Subscription | null = null;

  /**
   * In-flight handlers, tracked so teardown can wait for them.
   *
   * The M11 listener learned this the hard way: fire-and-forget work
   * that touches the database leaks past a test's boundary, and its FK
   * locks then deadlock the harness's TRUNCATE. Any post-commit
   * fire-and-forget doing async work owes the same drain.
   */
  private readonly inFlight = new Set<Promise<void>>();

  constructor(
    private readonly bus: OrderLifecycleEventBus,
    private readonly queue: AwbGenerationQueue,
  ) {}

  onApplicationBootstrap(): void {
    this.subscription = this.bus.subscribe((event) => {
      const p = this.handle(event)
        .catch((err: unknown) => {
          this.logger.warn(
            { orderId: event.orderId, err: err instanceof Error ? err.message : String(err) },
            'AWB enqueue on CONFIRMED failed — manifest close will catch up',
          );
        })
        .finally(() => {
          this.inFlight.delete(p);
        });
      this.inFlight.add(p);
    });
    this.logger.log('OrderConfirmedAwbListener subscribed to OrderLifecycleEventBus');
  }

  async onModuleDestroy(): Promise<void> {
    this.subscription?.unsubscribe();
    this.subscription = null;
    await this.drainInFlight();
  }

  /** Public so the e2e harness can quiesce this listener between tests. */
  async drainInFlight(): Promise<void> {
    await Promise.allSettled([...this.inFlight]);
  }

  private async handle(event: OrderLifecycleEvent): Promise<void> {
    // Entry to CONFIRMED only. A matrix self-loop or a re-emit for an
    // order already confirmed must not queue a second job — though
    // CUR-9 would make that harmless anyway.
    if (event.to !== OrderStatus.CONFIRMED || event.from === OrderStatus.CONFIRMED) return;

    await this.queue.enqueueOrder(event.orderId);
  }
}
