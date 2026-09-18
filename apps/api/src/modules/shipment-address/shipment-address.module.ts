import { Module } from '@nestjs/common';
import { AuthCommonModule } from '../auth-common/auth-common.module';
import { CourierOpsModule } from '../courier-ops/courier-ops.module';
import { ResellerStoreModule } from '../reseller-store/reseller-store.module';
import { StoreOrderRequestModule } from '../store-order-request/store-order-request.module';
import { StoreJwtGuard } from '../../common/guards/store-jwt.guard';
import { AdminShipmentAddressController } from './controllers/admin-shipment-address.controller';
import { SellerShipmentAddressController } from './controllers/seller-shipment-address.controller';
import { StoreShipmentAddressController } from './controllers/store-shipment-address.controller';
import { ShipmentAddressService } from './services/shipment-address.service';

/**
 * Correcting the consignee on a parcel that is already moving.
 *
 * A LEAF: nothing imports it. It reaches the courier through
 * `courier-ops`'s dispatcher (CUR-12) rather than an adapter directly,
 * so a third courier needs no change here.
 */
@Module({
  imports: [
    AuthCommonModule,
    CourierOpsModule,
    // 2026-09-18 — a reseller store may correct a moving parcel too, and
    // whether it may at all is the SELLER's policy for that store. Both
    // imports are one-way: neither imports this leaf back.
    ResellerStoreModule,
    StoreOrderRequestModule,
  ],
  controllers: [
    SellerShipmentAddressController,
    StoreShipmentAddressController,
    AdminShipmentAddressController,
  ],
  providers: [ShipmentAddressService, StoreJwtGuard],
  exports: [ShipmentAddressService],
})
export class ShipmentAddressModule {}
