import { createHmac } from 'node:crypto';
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { Subscription } from 'rxjs';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  OrderLifecycleEventBus,
  type OrderLifecycleEvent,
} from '../../lifecycle-events/order-lifecycle-event-bus.service';
import { WebhookEventMappingService } from './webhook-event-mapping.service';
import { OutboundWebhookQueue } from '../queue/outbound-webhook.queue';

/**
 * Module 24 (outbound webhook delivery fan-out point) — the bus
 * subscriber that translates one OrderLifecycleEvent into N
 * BullMQ jobs (one per matching, active SellerWebhookEndpoint).
 *
 * Discipline mirrors NotificationListener (M11):
 *   - SAME R3 bus, so wiring is via shared primitive — no order ↔
 *     webhook-delivery direct dep.
 *   - emit() in the bus is already wrapped; this listener wraps each
 *     handle() in `.catch` so a fault NEVER reaches back to the
 *     transition.
 *   - In-flight Promise tracking with onModuleDestroy drain mirrors
 *     M11's NOTIF-1 follow-up so e2e teardown is deterministic.
 *
 * For each event:
 *   1. Resolve event-code via WebhookEventMappingService. null → skip.
 *   2. Load every ACTIVE SellerWebhookEndpoint for the seller that
 *      subscribes to that code (subscribedEvents includes the code).
 *      Auto-disabled / soft-deleted endpoints are excluded.
 *   3. Build a small canonical JSON payload (orderId, sellerId, event
 *      code, from/to, statusEventId, occurredAt). Sign with the
 *      endpoint's secret (HMAC-SHA256). Enqueue ONE job per endpoint.
 *
 * Payload is deliberately MINIMAL (no recipient PII / no nested
 * shipment info) — the seller's integration is expected to call
 * back into the API for full order detail using the standard
 * seller auth. This keeps the payload signed-blob small + avoids
 * leaking PII to whatever HTTPS endpoint they configured.
 */
@Injectable()
export class OutboundWebhookListener
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(OutboundWebhookListener.name);
  private subscription: Subscription | null = null;
  private readonly inFlight = new Set<Promise<void>>();

  constructor(
    private readonly bus: OrderLifecycleEventBus,
    private readonly mapping: WebhookEventMappingService,
    private readonly prisma: PrismaService,
    private readonly queue: OutboundWebhookQueue,
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
            'OutboundWebhookListener.handle threw; swallowed (NOTIF-1 discipline)',
          );
        })
        .finally(() => {
          this.inFlight.delete(p);
        });
      this.inFlight.add(p);
    });
    this.logger.log('OutboundWebhookListener subscribed to OrderLifecycleEventBus');
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

  /** Test-harness drain seam (mirrors NotificationListener.drainInFlight). */
  async drainInFlight(): Promise<void> {
    if (this.inFlight.size > 0) {
      await Promise.allSettled([...this.inFlight]);
    }
  }

  private async handle(event: OrderLifecycleEvent): Promise<void> {
    const eventCode = this.mapping.resolveForOrderStatus(event.to);
    if (eventCode === null) return;

    // Load active endpoints subscribing to this code.
    const endpoints = await this.prisma.client.sellerWebhookEndpoint.findMany({
      where: {
        sellerId: event.sellerId,
        isActive: true,
        deletedAt: null,
        autoDisabledAt: null,
        subscribedEvents: { has: eventCode },
      },
      select: {
        id: true,
        url: true,
        secretKey: true,
      },
    });
    if (endpoints.length === 0) return;

    const payload = {
      eventType: eventCode,
      eventId: event.statusEventId,
      orderId: event.orderId,
      sellerId: event.sellerId,
      from: event.from,
      to: event.to,
      occurredAt: event.occurredAt.toISOString(),
    };
    const body = JSON.stringify(payload);

    for (const ep of endpoints) {
      // Per-endpoint try/catch — NOTIF-3 independence: one bad
      // endpoint never aborts the loop.
      try {
        const signature = createHmac('sha256', ep.secretKey)
          .update(body)
          .digest('hex');
        await this.queue.enqueue({
          endpointId: ep.id,
          eventType: eventCode,
          eventId: event.statusEventId,
          requestUrl: ep.url,
          payload,
          signature,
          attemptNumber: 1,
        });
      } catch (err) {
        this.logger.error(
          {
            err: (err as Error).message,
            endpointId: ep.id,
            eventType: eventCode,
          },
          'Failed to enqueue outbound webhook job; skipping endpoint',
        );
      }
    }
  }
}
