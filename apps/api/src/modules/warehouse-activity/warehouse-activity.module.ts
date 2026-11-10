import { Module } from '@nestjs/common';
import { AdminParcelActivityController } from './controllers/admin-parcel-activity.controller';
import { AdminParcelLastTouchController } from './controllers/admin-parcel-last-touch.controller';
import { AdminWarehouseHoldsController } from './controllers/admin-warehouse-holds.controller';
import { ParcelActivityService } from './services/parcel-activity.service';
import { WarehouseHoldsService } from './services/warehouse-holds.service';

/**
 * Module — the warehouse activity trail and the live holds board.
 *
 * A LEAF, and READ-ONLY: nothing imports it, it exports nothing, it owns
 * no table and it writes nothing at all. Every fact it serves was
 * already recorded by the station that did the work — the operational
 * who/when stamps on `shipments`, `pick_batches`, `pack_boxes`,
 * `awb_labels` and `manifests`, plus the append-only `order_events` row
 * for the two steps that keep no actor column of their own.
 *
 * Same shape and the same reason as `order-journey`: the story is
 * assembled where it is read, so no second copy can drift from the
 * stations it describes.
 */
@Module({
  controllers: [
    AdminParcelActivityController,
    AdminParcelLastTouchController,
    AdminWarehouseHoldsController,
  ],
  providers: [ParcelActivityService, WarehouseHoldsService],
})
export class WarehouseActivityModule {}
