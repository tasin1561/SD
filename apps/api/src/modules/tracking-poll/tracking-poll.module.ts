import { Module } from '@nestjs/common';
import { AuthCommonModule } from '../auth-common/auth-common.module';
import { AdminTrackingPollController } from './controllers/admin-tracking-poll.controller';
import { EmailModule } from '../email/email.module';
import { TrackingRecoveryService } from './services/tracking-recovery.service';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { CourierDelhiveryModule } from '../courier-delhivery/courier-delhivery.module';
import { CourierShiprocketModule } from '../courier-shiprocket/courier-shiprocket.module';
import { DelhiveryTrackingSourceService } from '../courier-delhivery/services/delhivery-tracking-source.service';
import { ShiprocketTrackingSourceService } from '../courier-shiprocket/services/shiprocket-tracking-source.service';
import { COURIER_TRACKING_SOURCES } from '../courier-shared/services/courier-tracking-source';
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
    CourierShiprocketModule,
    PrismaModule,
    CourierDelhiveryModule,
    TrackingEventsModule,
    OrderModule,
    AuthCommonModule,
    // For the stall alert — reuses the existing email substrate rather
    // than adding a second way to send a message.
    EmailModule,
  ],
  controllers: [AdminTrackingPollController],
  providers: [
    {
      // The list of couriers the poller sweeps. Adding a third means
      // implementing CourierTrackingSource and appending it HERE — the
      // poll cycle itself does not change.
      provide: COURIER_TRACKING_SOURCES,
      inject: [DelhiveryTrackingSourceService, ShiprocketTrackingSourceService],
      useFactory: (
        delhivery: DelhiveryTrackingSourceService,
        shiprocket: ShiprocketTrackingSourceService,
      ) => [delhivery, shiprocket],
    },
    TrackingPollService,
    TrackingRecoveryService,
    TrackingPollQueue,
    TrackingPollWorker,
  ],
  exports: [TrackingPollService],
})
export class TrackingPollModule {}
