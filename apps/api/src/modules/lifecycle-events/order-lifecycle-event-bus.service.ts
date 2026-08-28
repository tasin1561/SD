import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import type Redis from 'ioredis';
import { Subject } from 'rxjs';
import type { Observable, Subscription } from 'rxjs';
import { ActorType, type OrderStatus } from '@skydrop/db';

/** Redis channel carrying lifecycle events between API instances. */
const CHANNEL = 'skydrop:order-lifecycle';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { WorkerRoleService } from '../../common/queue/worker-role.service';

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
export class OrderLifecycleEventBus implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OrderLifecycleEventBus.name);
  private readonly subject = new Subject<OrderLifecycleEvent>();
  private subscriber: Redis | null = null;

  constructor(
    private readonly redis: RedisService,
    private readonly role: WorkerRoleService,
  ) {}

  /**
   * Where listeners actually run.
   *
   * The same instance that owns the BullMQ queues (SCALE-1) owns the
   * listeners, for the same reason: firing them on every instance would
   * fan every event out N times. The dedup gates downstream would mostly
   * absorb that — NOTIF-2's composite key, CUR-9's AWB gate — but
   * "mostly" is not a design, and a listener added later would inherit a
   * hazard nobody wrote down.
   */
  private get handlesEvents(): boolean {
    return this.role.enabled;
  }

  onApplicationBootstrap(): void {
    if (!this.handlesEvents) {
      this.logger.log(
        'Lifecycle listeners are off here; events go to Redis for the worker instance',
      );
      return;
    }
    // Only the listening instance opens a subscriber. On a
    // single-instance deployment nothing is ever published, so this
    // connection sits idle — the price of a second instance being a
    // config change rather than a rewrite.
    const sub = this.redis.createConnection();
    this.subscriber = sub;
    void sub.subscribe(CHANNEL).catch((err: unknown) => {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'Could not subscribe to the lifecycle channel — events from OTHER instances will be missed',
      );
    });
    sub.on('message', (_channel: string, raw: string) => {
      try {
        const parsed = JSON.parse(raw) as OrderLifecycleEvent & { occurredAt: string };
        this.deliverLocally({ ...parsed, occurredAt: new Date(parsed.occurredAt) });
      } catch (err) {
        this.logger.error(
          { err: err instanceof Error ? err.message : String(err) },
          'Unreadable lifecycle event on the channel; dropped',
        );
      }
    });
  }

  private publish(event: OrderLifecycleEvent): void {
    // Fire-and-forget, like every other post-commit hook: the
    // transition is the durable fact and a broker that will not take the
    // message must never undo it (NOTIF-1).
    void this.redis.client.publish(CHANNEL, JSON.stringify(event)).catch((err: unknown) => {
      this.logger.error(
        {
          orderId: event.orderId,
          to: event.to,
          err: err instanceof Error ? err.message : String(err),
        },
        'Could not publish a lifecycle event; its listeners will not run',
      );
    });
  }

  /**
   * Fire a lifecycle event to all subscribers. Best-effort by
   * contract: a subscriber that throws is caught + logged here and
   * the exception is NEVER re-thrown to the emitter (NOTIF-1). The
   * emit call is therefore safe to put as a `await` post-commit hook
   * in OrderWriteService.transitionStatus without an outer try/catch
   * — though we still add one there for defence in depth.
   */
  emit(event: OrderLifecycleEvent): void {
    // On the instance that runs listeners this is a direct in-process
    // hand-off, with no Redis on the path — so the common
    // single-instance deployment cannot lose an event to a broker being
    // down. An HTTP-only instance has no listeners to call and puts it
    // on the channel instead.
    if (!this.handlesEvents) {
      this.publish(event);
      return;
    }
    this.deliverLocally(event);
  }

  private deliverLocally(event: OrderLifecycleEvent): void {
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

  async onModuleDestroy(): Promise<void> {
    // The subscriber first: a message arriving after the Subject has
    // completed would be delivered to nobody and logged as an error the
    // next reader would waste time on.
    if (this.subscriber !== null) {
      const sub = this.subscriber;
      this.subscriber = null;
      try {
        await sub.quit();
      } catch {
        // Already gone. Nothing to do and nothing worth saying.
        sub.disconnect();
      }
    }
    // Complete the Subject so any active subscriptions teardown
    // cleanly when Nest tears down the app (important for the e2e
    // harness which repeatedly inits + closes apps in the same
    // process — a leaked Subject would accumulate subscribers).
    this.subject.complete();
  }
}
