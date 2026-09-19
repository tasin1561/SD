import { Module } from '@nestjs/common';
import { RedisModule } from '../../infrastructure/redis/redis.module';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { AuthCommonModule } from '../auth-common/auth-common.module';
import { CourierSharedModule } from '../courier-shared/courier-shared.module';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { AdminShiprocketOpsController } from './controllers/admin-shiprocket-ops.controller';
import { ShiprocketSupportAdapterService } from './services/shiprocket-support-adapter.service';
import { ShiprocketTrackingSourceService } from './services/shiprocket-tracking-source.service';
import { ShiprocketNdrService } from './services/shiprocket-ndr.service';
import { ShiprocketClientService } from './services/shiprocket-client.service';
import { ShiprocketHttpService } from './services/shiprocket-http.service';

/**
 * The Shiprocket adapter.
 *
 * Same shape as `courier-delhivery` and for the same reason: the AWB
 * saga, the label persistence and the tracking poller talk to a
 * capability surface, not to a courier. Where Shiprocket differs — two
 * calls to get an AWB, a token that expires, a numeric shipment id of
 * its own, weights in kilograms — the difference is absorbed inside.
 *
 * ── IT IS LIVE (corrected 2026-09-19) ───────────────────────────────
 * This said "NOT YET REACHABLE, AND THAT IS DELIBERATE — seeded EMPTY,
 * which is stub mode, no account provisioned, no call ever made". None
 * of that is still true: production carries a real base URL, an active
 * account, `Courier.isActive` true and
 * `courier.shiprocket_live_writes_enabled` true, and a real parcel was
 * booked through this adapter on 2026-09-09 (AWB 90658129413, Blue Dart
 * Air) and cancelled cleanly. Failover reaches Shiprocket for real.
 *
 * Reason about the posture from the DATABASE, never from this comment:
 * the two questions are `courier.shiprocket_live_writes_enabled` and
 * `courier.shiprocket_api_base_url`, and `/shiprocket` now shows both.
 *
 * What is still UNPROVEN by a live call is the RETURN leg
 * (`/orders/create/return`, built 2026-09-19): no return has been
 * booked on this account, so its request shape is their documented one
 * rather than an observed one — see the notes on `createReturn`.
 */
@Module({
  imports: [RedisModule, PrismaModule, AuthCommonModule, CourierSharedModule],
  // The ops console. `/delhivery` has had one for months and this
  // courier had none, which left the one that failover reaches without
  // anybody choosing it as the one with no page.
  controllers: [AdminShiprocketOpsController],
  providers: [
    StaffJwtGuard,
    ShiprocketHttpService,
    ShiprocketClientService,
    ShiprocketNdrService,
    ShiprocketTrackingSourceService,
    ShiprocketSupportAdapterService,
  ],
  exports: [
    // Exported so the AWB dispatcher can ask whether this courier is
    // answering from a stub before trusting it as a failover target.
    ShiprocketHttpService,
    ShiprocketClientService,
    ShiprocketNdrService,
    ShiprocketTrackingSourceService,
    ShiprocketSupportAdapterService,
  ],
})
export class CourierShiprocketModule {}
