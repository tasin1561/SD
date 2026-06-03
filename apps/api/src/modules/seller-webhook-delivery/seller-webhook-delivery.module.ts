import { Module } from '@nestjs/common';
import { LifecycleEventsModule } from '../lifecycle-events/lifecycle-events.module';
import { WebhookEventMappingService } from './services/webhook-event-mapping.service';
import { OutboundWebhookDispatchService } from './services/outbound-webhook-dispatch.service';
import { OutboundWebhookListener } from './services/outbound-webhook-listener.service';
import { OutboundWebhookQueue } from './queue/outbound-webhook.queue';
import { OutboundWebhookWorker } from './queue/outbound-webhook.worker';

/**
 * Outbound webhook delivery — fires HMAC-signed POSTs at configured
 * SellerWebhookEndpoint URLs on every order lifecycle event the
 * endpoint subscribes to.
 *
 * Architecture (mirrors M11 NotificationsModule):
 *   - OrderLifecycleEventBus subscriber (OutboundWebhookListener)
 *     resolves the event code via WebhookEventMappingService
 *     (FOURTH single-source-mapping instance after CC-2 / TRK-5 /
 *     NOTIF-4) and enqueues one BullMQ job per matching endpoint.
 *   - OutboundWebhookWorker drains the queue with default retry
 *     policy (5 attempts exp backoff); OutboundWebhookDispatchService
 *     does the HTTP I/O + persists OutboundWebhookDelivery rows +
 *     handles endpoint bookkeeping (consecutiveFailureCount,
 *     auto-disable on threshold).
 *
 * Exports OutboundWebhookQueue so the admin webhook-deliveries
 * controller can enqueue manual retries (Phase 1B bundle #4). All
 * other providers stay internal.
 */
@Module({
  imports: [LifecycleEventsModule],
  providers: [
    WebhookEventMappingService,
    OutboundWebhookDispatchService,
    OutboundWebhookListener,
    OutboundWebhookQueue,
    OutboundWebhookWorker,
  ],
  exports: [OutboundWebhookQueue],
})
export class SellerWebhookDeliveryModule {}
