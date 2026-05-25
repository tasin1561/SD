import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { ConfigModule } from '../../config/config.module';
import { RedisModule } from '../../infrastructure/redis/redis.module';
import { WebhookAuthService } from './services/webhook-auth.service';
import { WebhookIngestService } from './services/webhook-ingest.service';
import { TrackingWebhookQueue } from './queue/tracking-webhook.queue';
import { PublicWebhookController } from './controllers/public-webhook.controller';

/**
 * Module 10 — tracking-ingestion. M10 commit 4 added the auth skeleton;
 * commit 5 (this commit) adds the ingest service + public controller +
 * BullMQ queue. The processing WORKER lands commit 8.
 *
 * Cross-module surface: NONE. Leaf consumer module (mirrors the
 * warehouse-* modules). The PUBLIC controller it owns is its only
 * external surface — TRK-1's HMAC check IS the auth boundary.
 */
@Module({
  imports: [PrismaModule, ConfigModule, RedisModule],
  controllers: [PublicWebhookController],
  providers: [WebhookAuthService, WebhookIngestService, TrackingWebhookQueue],
  exports: [],
})
export class TrackingIngestionModule {}
