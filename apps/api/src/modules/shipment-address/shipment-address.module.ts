import { Module } from '@nestjs/common';
import { AuthCommonModule } from '../auth-common/auth-common.module';
import { CourierOpsModule } from '../courier-ops/courier-ops.module';
import { AdminShipmentAddressController } from './controllers/admin-shipment-address.controller';
import { SellerShipmentAddressController } from './controllers/seller-shipment-address.controller';
import { ShipmentAddressService } from './services/shipment-address.service';

/**
 * Correcting the consignee on a parcel that is already moving.
 *
 * A LEAF: nothing imports it. It reaches the courier through
 * `courier-ops`'s dispatcher (CUR-12) rather than an adapter directly,
 * so a third courier needs no change here.
 */
@Module({
  imports: [AuthCommonModule, CourierOpsModule],
  controllers: [SellerShipmentAddressController, AdminShipmentAddressController],
  providers: [ShipmentAddressService],
  exports: [ShipmentAddressService],
})
export class ShipmentAddressModule {}
