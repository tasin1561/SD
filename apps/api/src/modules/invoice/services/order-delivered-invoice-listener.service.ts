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
import { InvoiceService } from './invoice.service';

/**
 * Phase 1B — auto-generate the GST invoice on DELIVERED.
 *
 * Bus listener (4th subscriber after NotificationListener,
 * OutboundWebhookListener, OrderDeliveredAccrualListener). Mirrors
 * the same drain discipline so e2e teardown is deterministic.
 *
 * The InvoiceService is idempotent (linkedOrderId-unique) so a
 * bus replay or a manual seller "Regenerate" click never produces
 * duplicate invoices.
 */
@Injectable()
export class OrderDeliveredInvoiceListener
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(OrderDeliveredInvoiceListener.name);
  private subscription: Subscription | null = null;
  private readonly inFlight = new Set<Promise<void>>();

  constructor(
    private readonly bus: OrderLifecycleEventBus,
    private readonly invoices: InvoiceService,
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
            'OrderDeliveredInvoiceListener.handle threw; swallowed',
          );
        })
        .finally(() => {
          this.inFlight.delete(p);
        });
      this.inFlight.add(p);
    });
    this.logger.log(
      'OrderDeliveredInvoiceListener subscribed to OrderLifecycleEventBus',
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

  async drainInFlight(): Promise<void> {
    if (this.inFlight.size > 0) {
      await Promise.allSettled([...this.inFlight]);
    }
  }

  private async handle(event: OrderLifecycleEvent): Promise<void> {
    if (event.to !== OrderStatus.DELIVERED) return;
    await this.invoices.generateForOrder(event.orderId);
  }
}
