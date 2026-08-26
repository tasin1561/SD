import { Module } from '@nestjs/common';
import { AuthCommonModule } from '../auth-common/auth-common.module';
import { AdminTrackingPollController } from './controllers/admin-tracking-poll.controller';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { CourierDelhiveryModule } from '../courier-delhivery/courier-delhivery.module';
import { TrackingEventsModule } from '../tracking-events/tracking-events.module';
import { OrderModule } from '../order/order.module';
import { TrackingPollService } from './services/tracking-poll.service';
import { TrackingPollQueue } from './queue/tracking-poll.queue';
import { TrackingPollWorker } from './queue/tracking-poll.worker';

/**
 * Module 10 (poll) — the Delhivery tracking poller. Delhivery B2C
 * accounts push no webhooks, so tracking is poll-based; this module is
 * the polling counterpart to tracking-ingestion (webhooks).
 *
 * Reuses the shared primitives:
 *   - CourierDelhiveryModule — DelhiveryTrackingFetchService (network),
 *     DelhiveryTrackingService (normalizeScan), DelhiveryHttpService
 *     (stub-mode gate).
 *   - TrackingEventsModule — TrackingStatusMappingService (TRK-5) +
 *     TrackingEventAppendService (append + watermark read).
 *   - OrderModule — OrderWriteService.transitionStatus (the sole order
 *     WRITE boundary, ORD-3).
 *
 * Cross-module surface: NONE. Leaf consumer — the cron drives it; no
 * other module calls in. `TrackingPollService.pollAll()` is public so
 * ops can trigger a manual cycle.
 */
@Module({
  imports: [
    PrismaModule,
    CourierDelhiveryModule,
    TrackingEventsModule,
    OrderModule,
    AuthCommonModule,
  ],
  controllers: [AdminTrackingPollController],
  providers: [TrackingPollService, TrackingPollQueue, TrackingPollWorker],
  exports: [TrackingPollService],
})
export class TrackingPollModule {}
