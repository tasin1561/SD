import { Module } from '@nestjs/common';
import { RedisModule } from '../../infrastructure/redis/redis.module';
import { CourierShiprocketModule } from '../courier-shiprocket/courier-shiprocket.module';
import { AdminShiprocketCostController } from './controllers/admin-shiprocket-cost.controller';
import { ShiprocketCostSyncService } from './services/shiprocket-cost-sync.service';
import { ShiprocketCostPanelService } from './services/shiprocket-cost-panel.service';
import { ShiprocketCostSyncQueue } from './queue/shiprocket-cost-sync.queue';
import { ShiprocketCostSyncWorker } from './queue/shiprocket-cost-sync.worker';
import { ShiprocketPortalTriggerService } from './services/shiprocket-portal-trigger.service';

/**
 * What Shiprocket charged us, read from their API (the Delhivery sync's
 * counterpart). A LEAF: nothing imports it, and it reaches Shiprocket
 * only through the adapter's own HTTP service.
 */
@Module({
  imports: [RedisModule, CourierShiprocketModule],
  controllers: [AdminShiprocketCostController],
  providers: [
    ShiprocketCostSyncService,
    ShiprocketCostPanelService,
    ShiprocketCostSyncQueue,
    ShiprocketCostSyncWorker,
    ShiprocketPortalTriggerService,
  ],
})
export class ShiprocketCostSyncModule {}
