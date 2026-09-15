import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ActorType, OrderStatus } from '@skydrop/db';
import type { Subscription } from 'rxjs';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import {
  OrderLifecycleEventBus,
  type OrderLifecycleEvent,
} from '../../lifecycle-events/order-lifecycle-event-bus.service';
import {
  ADMIN_OVERRIDE_SOURCE,
  parcelLeftWithCourier,
  REFUNDABLE_FROM_STATES,
  VOIDABLE_TERMINAL_STATES,
} from '../../order/order-carriage';
import { ResellerOrderMoneyService } from './reseller-order-money.service';

/** The statuses that mean the parcel is physically back with us. */
const RETURNED: ReadonlySet<OrderStatus> = new Set([
  OrderStatus.RTO_RECEIVED,
  OrderStatus.RTO_RESTOCKED,
  OrderStatus.RTO_DAMAGED,
]);

/**
 * RS-6 phase 3c — the reseller order money's hook on the lifecycle bus.
 *
 * Both writers of `orders.status` emit here (ORD-2 / WAL-8), so a god-mode
 * move reaches the same money as a matrix transition. A CHANNEL order
 * falls straight through (`ResellerOrderMoneyService.head` is null) — its
 * money path is exactly what it was.
 *
 *   CONFIRMED            → plan, prepaid debit, AFTER_CONFIRMATION credits
 *   DELIVERED            → INSTANT / AFTER_DELIVERY credits (with proof of carriage)
 *   cancel / reject      → skip pending, give back what a parcel that never left owes
 *   LOST_IN_TRANSIT      → the same, whatever the carriage
 *   RTO_RECEIVED (etc.)  → a return: undelivered credits back, prepaid refunded
 *
 * The delivery / return fee shares are NOT here: they are billed by the
 * channel's own services, which branch into the same money service.
 *
 * NOTIF-1 discipline: best-effort, never rethrows into the bus, every
 * failure audited HIGH; in-flight work is tracked and drained
 * (`drainInFlight`, awaited by the e2e reset — NOTIF-19).
 */
@Injectable()
export class ResellerOrderMoneyListener implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ResellerOrderMoneyListener.name);
  private subscription: Subscription | null = null;
  private readonly inFlight = new Set<Promise<void>>();

  constructor(
    private readonly bus: OrderLifecycleEventBus,
    private readonly money: ResellerOrderMoneyService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  onApplicationBootstrap(): void {
    this.subscription = this.bus.subscribe((event) => {
      const p = this.handle(event)
        .catch((err: unknown) => {
          this.logger.error(
            { orderId: event.orderId, err: err instanceof Error ? err.message : String(err) },
            'ResellerOrderMoneyListener.handle threw; swallowed',
          );
        })
        .finally(() => {
          this.inFlight.delete(p);
        });
      this.inFlight.add(p);
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = null;
    }
    await this.drainInFlight();
  }

  /** Test-harness drain seam (NOTIF-19). */
  async drainInFlight(): Promise<void> {
    if (this.inFlight.size > 0) await Promise.allSettled([...this.inFlight]);
  }

  /** Public — testable directly, and a manual re-trigger (every step is idempotent). */
  async handle(event: OrderLifecycleEvent): Promise<void> {
    if (event.from === event.to) return;
    const head = await this.money.head(this.prisma.client, event.orderId);
    if (head === null) return;
    try {
      if (event.to === OrderStatus.CONFIRMED) {
        await this.money.onConfirmed(event.orderId, event.occurredAt);
      } else if (event.to === OrderStatus.DELIVERED) {
        const carried = await parcelLeftWithCourier(this.prisma.client, event.orderId);
        await this.money.onDelivered(event.orderId, event.occurredAt, carried);
      } else if (VOIDABLE_TERMINAL_STATES.has(event.to)) {
        const label = event.to.toLowerCase().replaceAll('_', ' ');
        const left =
          event.source === ADMIN_OVERRIDE_SOURCE
            ? await parcelLeftWithCourier(this.prisma.client, event.orderId)
            : !REFUNDABLE_FROM_STATES.has(event.from);
        await this.money.onEnded(event.orderId, {
          kind: 'CALLED_OFF',
          parcelLeft: left,
          note: `order ${label} before its parcel reached a customer`,
        });
      } else if (event.to === OrderStatus.LOST_IN_TRANSIT) {
        await this.money.onEnded(event.orderId, {
          kind: 'LOST',
          parcelLeft: true,
          note: 'parcel lost in transit',
        });
      } else if (RETURNED.has(event.to) && !RETURNED.has(event.from)) {
        await this.money.onReturned(event.orderId, 'the parcel came back to us');
      }
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      this.logger.error(
        { orderId: event.orderId, to: event.to, err: error },
        'Reseller order money step FAILED — the order moved and its money did not',
      );
      await this.audit
        .log({
          actorType: ActorType.SYSTEM,
          actorId: null,
          sellerId: event.sellerId,
          action: 'reseller_order.money_failed',
          entityType: 'order',
          entityId: event.orderId,
          severity: 'HIGH',
          metadata: {
            fromStatus: event.from,
            toStatus: event.to,
            trigger:
              event.source === ADMIN_OVERRIDE_SOURCE ? 'force_mutation' : 'lifecycle_transition',
            error,
          },
        })
        .catch(() => undefined);
    }
  }
}
