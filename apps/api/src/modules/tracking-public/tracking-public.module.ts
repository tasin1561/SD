import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { PublicTrackingReadService } from './services/public-tracking-read.service';
import { PublicTrackingController } from './controllers/public-tracking.controller';

/**
 * Module 10 (TRK-8) — public AWB tracking lookup. Open endpoint
 * (no auth, AWB is the access token); customer-safe projection;
 * rate-limited.
 *
 * Cross-module surface: `PublicTrackingReadService` ONLY, for the public
 * parcel helper (assistant Batch C), which must answer from the SAME
 * customer-safe projection the page renders and nothing else. The PUBLIC
 * controller it owns is its other external surface.
 */
@Module({
  imports: [PrismaModule],
  controllers: [PublicTrackingController],
  providers: [PublicTrackingReadService],
  exports: [PublicTrackingReadService],
})
export class TrackingPublicModule {}
