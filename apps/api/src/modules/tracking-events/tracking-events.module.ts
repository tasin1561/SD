import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { TrackingStatusMappingService } from './services/tracking-status-mapping.service';
import { TrackingEventAppendService } from './services/tracking-event-append.service';

/**
 * Module 10 — tracking-events. The append-side of the public tracking
 * read model + the F2 (TRK-5) ShipmentStatus→OrderStatus mapping.
 *
 *   - TrackingStatusMappingService — single source of truth for the
 *     scan-status → order-transition translation (commit 6). Pure
 *     logic; no Prisma. Consumed by the tracking-ingestion processor
 *     (commit 8).
 *   - TrackingEventAppendService — scan-time-ordered append to
 *     tracking_events + the eventAt-DESC read primitive that backs
 *     the processor's monotonic-forward guard and the public
 *     timeline (commit 7, this commit).
 *
 * Cross-module consumers: the tracking-ingestion processor (commit 8)
 * and the tracking-public read service (commit 10).
 */
@Module({
  imports: [PrismaModule],
  providers: [TrackingStatusMappingService, TrackingEventAppendService],
  exports: [TrackingStatusMappingService, TrackingEventAppendService],
})
export class TrackingEventsModule {}
