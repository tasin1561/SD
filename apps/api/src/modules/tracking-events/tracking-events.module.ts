import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { TrackingStatusMappingService } from './services/tracking-status-mapping.service';

/**
 * Module 10 — tracking-events. The append-side of the public tracking
 * read model + the F2 (TRK-5) ShipmentStatus→OrderStatus mapping.
 *
 *   - TrackingStatusMappingService — single source of truth for the
 *     scan-status → order-transition translation (commit 6, this
 *     commit). Pure logic; no Prisma. Consumed by the tracking-
 *     ingestion processor (commit 8).
 *   - TrackingEventAppendService — scan-time-ordered append to
 *     tracking_events + the monotonic-forward READ helper (commit 7).
 *
 * Exports: TrackingStatusMappingService + (commit 7) the append
 * service. Cross-module consumer: tracking-ingestion's processor and
 * tracking-public's read service.
 */
@Module({
  imports: [PrismaModule],
  providers: [TrackingStatusMappingService],
  exports: [TrackingStatusMappingService],
})
export class TrackingEventsModule {}
