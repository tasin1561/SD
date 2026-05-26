import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Subject } from 'rxjs';
import type { Observable, Subscription } from 'rxjs';
import { ActorType, type OrderStatus } from '@skydrop/db';

/**
 * A single order lifecycle event — a transition that committed.
 *
 * `statusEventId` is the OrderEvent.id (uuidv7) of the STATUS_CHANGED
 * row written in the same tx as the order status update. It is the
 * occurrence-unique key the downstream notification ledger uses to
 * dedup re-emits WITHOUT dedup'ing distinct repeat-of-same-edge
 * occurrences (NDR retry cycle: DELIVERY_FAILED → OUT_FOR_DELIVERY →
 * DELIVERY_FAILED produces THREE STATUS_CHANGED rows → three distinct
 * statusEventIds → both DELIVERY_FAILED occurrences fan out; a bus
 * replay of the same emit carries the same statusEventId and is
 * deduped).
 *
 * `from`/`to` carry the edge (used for descriptive log lines /
 * triggerEvent strings). `actorType`/`actorId` are forwarded for
 * potential filtering (e.g. listeners that want to ignore SYSTEM /
 * god-mode transitions). Order id + seller id let the listener
 * resolve addresses without re-fetching just the order header.
 */
export interface OrderLifecycleEvent {
  readonly orderId: string;
  readonly sellerId: string;
  readonly from: OrderStatus;
  readonly to: OrderStatus;
  readonly statusEventId: string;
  readonly actorType: ActorType;
  readonly actorId: string | null;
  readonly occurredAt: Date;
}

/**
 * Module 11 — the order lifecycle event PRIMITIVE module (R3).
 *
 * The FOURTH application of the R3 dependency-free shared-primitive
 * pattern in the codebase, after:
 *   - call-queue (M7 — CallQueueService)
 *   - shipment-provision (M8 — ShipmentProvisionService)
 *   - inventory-shared (M5 — the StockMutationService primitive
 *     family; technically the first instance of the "shared
 *     internal" + "narrow external" split)
 *
 * Why R3 here: the order module needs to PUBLISH lifecycle events; the
 * notifications module needs to SUBSCRIBE to them. A direct dep
 * (order → notifications) would violate NOTIF-5 (the order module
 * stays unaware of notifications); a direct dep the other way
 * (notifications → order) is fine but a notification-side subscriber
 * still needs the order module to KNOW where to publish — which means
 * importing notifications. Extracting the bus into its OWN dep-free
 * module that BOTH sides import breaks the cycle exactly as M7's
 * call-queue / M8's shipment-provision did.
 *
 * The bus is rxjs Subject-backed — synchronous delivery to subscribers
 * (no microtask hop). Two consequences flow from sync delivery, and
 * the emit-path discipline below addresses both:
 *
 *   1. NOTIF-1 (best-effort): a subscriber that throws would, in raw
 *      Subject semantics, propagate the throw back to the caller of
 *      `next()`. `emit()` here wraps `next()` in try/catch and logs
 *      so the caller — `OrderWriteService.transitionStatus()` — never
 *      sees the exception. The order transition is the durable fact;
 *      a listener failure must not roll it back. (The listener is
 *      ALSO expected to wrap its own work in try/catch for defence-
 *      in-depth, but this layer is the contractual guarantee.)
 *
 *   2. Slow listener: a long-running synchronous subscriber would
 *      stretch the order transition's call stack. The listener's
 *      only synchronous work is the ledger enqueue (DB write +
 *      BullMQ enqueue) — both are async; the actual send is BullMQ-
 *      driven. So sync delivery is fine in practice. If a future
 *      listener does CPU-heavy work, it should defer to a microtask
 *      via `queueMicrotask(...)` or BullMQ.
 *
 * Production code MUST import this module (not the underlying rxjs
 * Subject) so the emit-wrapping discipline is enforced.
 */
@Injectable()
export class OrderLifecycleEventBus implements OnModuleDestroy {
  private readonly logger = new Logger(OrderLifecycleEventBus.name);
  private readonly subject = new Subject<OrderLifecycleEvent>();

  /**
   * Fire a lifecycle event to all subscribers. Best-effort by
   * contract: a subscriber that throws is caught + logged here and
   * the exception is NEVER re-thrown to the emitter (NOTIF-1). The
   * emit call is therefore safe to put as a `await` post-commit hook
   * in OrderWriteService.transitionStatus without an outer try/catch
   * — though we still add one there for defence in depth.
   */
  emit(event: OrderLifecycleEvent): void {
    try {
      this.subject.next(event);
    } catch (err) {
      // Subject.next propagates the FIRST subscriber's throw. We log
      // it (with the event context for forensics) and swallow — a
      // notification fault never rolls back the committed transition.
      this.logger.error(
        {
          orderId: event.orderId,
          from: event.from,
          to: event.to,
          statusEventId: event.statusEventId,
          err: (err as Error).message,
        },
        'OrderLifecycleEventBus: subscriber threw on emit; swallowed (NOTIF-1)',
      );
    }
  }

  /**
   * Subscribe to lifecycle events. The returned `Subscription` should
   * be retained by the subscriber and cleaned up via `unsubscribe()`
   * in its `onModuleDestroy()` to avoid leaking handlers across
   * Nest test-harness lifecycles.
   *
   * Subscribers SHOULD wrap their handler in try/catch — the emit
   * boundary already swallows exceptions, but defence-in-depth
   * prevents a single subscriber's throw from blocking OTHER
   * subscribers' delivery (rxjs Subject calls subscribers in order;
   * the first one to throw aborts the rest).
   */
  subscribe(handler: (event: OrderLifecycleEvent) => void): Subscription {
    return this.subject.subscribe({
      next: (event) => {
        try {
          handler(event);
        } catch (err) {
          this.logger.error(
            {
              orderId: event.orderId,
              from: event.from,
              to: event.to,
              statusEventId: event.statusEventId,
              err: (err as Error).message,
            },
            'OrderLifecycleEventBus: subscribe-handler threw; swallowed',
          );
        }
      },
    });
  }

  /** Test/observability helper — the observable stream. */
  asObservable(): Observable<OrderLifecycleEvent> {
    return this.subject.asObservable();
  }

  onModuleDestroy(): void {
    // Complete the Subject so any active subscriptions teardown
    // cleanly when Nest tears down the app (important for the e2e
    // harness which repeatedly inits + closes apps in the same
    // process — a leaked Subject would accumulate subscribers).
    this.subject.complete();
  }
}
