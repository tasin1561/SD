import { Module } from '@nestjs/common';
import { RedisModule } from '../../infrastructure/redis/redis.module';
import { CourierSharedModule } from '../courier-shared/courier-shared.module';
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
 * ── NOT YET REACHABLE, AND THAT IS DELIBERATE ────────────────────────
 * `courier.shiprocket_api_base_url` is seeded EMPTY, which is stub
 * mode. No account is provisioned and no call has ever been made, so
 * every wire shape here is transcribed-from-their-docs rather than
 * verified — the position Delhivery was in before 2026-07-27. It ends
 * the same way: one controlled first parcel, then the base URL.
 */
@Module({
  imports: [RedisModule, CourierSharedModule],
  providers: [
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
