import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { OrderModule } from '../order/order.module';
import { TrackingEventsModule } from '../tracking-events/tracking-events.module';
import { ManualTrackingService } from './services/manual-tracking.service';
import { AdminManualTrackingController } from './controllers/admin-manual-tracking.controller';

/**
 * Module 10 (TRK-9) — manual tracking-event recording for
 * manual-courier shipments. RBAC-gated admin endpoint; reuses the
 * shared mapping (TrackingStatusMappingService) + append
 * (TrackingEventAppendService) + order WRITE boundary
 * (OrderWriteService.transitionStatus) so manual scans drive the
 * SAME lifecycle the webhook flow does.
 *
 * Cross-module surface: NONE. Leaf consumer.
 */
@Module({
  imports: [PrismaModule, TrackingEventsModule, OrderModule],
  controllers: [AdminManualTrackingController],
  providers: [ManualTrackingService],
  exports: [],
})
export class TrackingManualModule {}
