import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { ConfigModule } from '../../config/config.module';
import { RedisModule } from '../../infrastructure/redis/redis.module';
import { CourierDelhiveryModule } from '../courier-delhivery/courier-delhivery.module';
import { CourierSharedModule } from '../courier-shared/courier-shared.module';
import { OrderModule } from '../order/order.module';
import { TrackingEventsModule } from '../tracking-events/tracking-events.module';
import { WebhookAuthService } from './services/webhook-auth.service';
import { WebhookIngestService } from './services/webhook-ingest.service';
import { WebhookProcessorService } from './services/webhook-processor.service';
import { WebhookPayloadRetentionService } from './services/webhook-payload-retention.service';
import { WebhookRetentionQueue } from './queue/webhook-retention.queue';
import { WebhookRetentionWorker } from './queue/webhook-retention.worker';
import { TrackingWebhookQueue } from './queue/tracking-webhook.queue';
import { TrackingWebhookWorker } from './queue/tracking-webhook.worker';
import { PublicWebhookController } from './controllers/public-webhook.controller';

/**
 * Module 10 — tracking-ingestion. M10 commit 4 added the auth skeleton;
 * commit 5 added the ingest service + public controller + BullMQ queue;
 * commit 8 (this commit) adds the processor + the in-process worker.
 *
 * Cross-module surface: NONE. Leaf consumer module (mirrors the
 * warehouse-* modules + courier-awb/dispatch). The PUBLIC controller it
 * owns is its only external surface — TRK-1's HMAC check IS the auth
 * boundary.
 *
 * Module imports
 *   - TrackingEventsModule — for TrackingStatusMappingService (commit 6)
 *     and TrackingEventAppendService (commit 7).
 *   - CourierDelhiveryModule — for DelhiveryTrackingService.normalizeScan
 *     (commit 6 / F8).
 *   - OrderModule — for OrderWriteService.transitionStatus (ORD-3 sole
 *     cross-module order WRITE boundary).
 *   - CourierSharedModule — AuditLogService is @Global, but this also
 *     keeps the dependency direction explicit (we audit REJECT scans).
 */
@Module({
  imports: [
    PrismaModule,
    ConfigModule,
    RedisModule,
    TrackingEventsModule,
    CourierDelhiveryModule,
    CourierSharedModule,
    OrderModule,
  ],
  controllers: [PublicWebhookController],
  providers: [
    WebhookAuthService,
    WebhookIngestService,
    WebhookProcessorService,
    TrackingWebhookQueue,
    TrackingWebhookWorker,
    // Bounds the size of courier_webhooks, the largest table per order.
    WebhookPayloadRetentionService,
    WebhookRetentionQueue,
    WebhookRetentionWorker,
  ],
  // The capacity monitor reports how much payload is still retained.
  exports: [WebhookPayloadRetentionService],
})
export class TrackingIngestionModule {}
