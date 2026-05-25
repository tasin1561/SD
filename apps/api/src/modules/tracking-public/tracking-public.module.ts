import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { PublicTrackingReadService } from './services/public-tracking-read.service';
import { PublicTrackingController } from './controllers/public-tracking.controller';

/**
 * Module 10 (TRK-8) — public AWB tracking lookup. Open endpoint
 * (no auth, AWB is the access token); customer-safe projection;
 * rate-limited.
 *
 * Cross-module surface: NONE. Leaf consumer module (mirrors the
 * warehouse-* + tracking-ingestion modules). The PUBLIC controller it
 * owns is its only external surface.
 */
@Module({
  imports: [PrismaModule],
  controllers: [PublicTrackingController],
  providers: [PublicTrackingReadService],
  exports: [],
})
export class TrackingPublicModule {}
