import { Module } from '@nestjs/common';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { ConsignmentCoreModule } from '../consignment-core/consignment-core.module';
import { EmailModule } from '../email/email.module';
import { InventoryReceiptModule } from '../inventory-receipt/inventory-receipt.module';
import { InventorySharedModule } from '../inventory-shared/inventory-shared.module';
import { ShipmentProvisionModule } from '../shipment-provision/shipment-provision.module';
import { AdminConsignmentController } from './controllers/admin-consignment.controller';
import { SellerConsignmentController } from './controllers/seller-consignment.controller';
import { ConsignmentCancelService } from './services/consignment-cancel.service';
import { ConsignmentDispatchService } from './services/consignment-dispatch.service';
import { ConsignmentLabelService } from './services/consignment-label.service';
import { ConsignmentService } from './services/consignment.service';

/**
 * Two-leg consignments — the journey a seller's stock takes to reach
 * India. See docs/consignment-two-leg.md.
 *
 * A LEAF module: nothing imports it and it exports nothing. It composes
 * `inventory-receipt` (the counting station, invoked once per leg) with
 * `consignment-core` (the R3 primitive that both this module and the
 * receipt module write the timeline and derived status through).
 */
@Module({
  imports: [
    ConsignmentCoreModule,
    InventoryReceiptModule,
    InventorySharedModule,
    ShipmentProvisionModule,
    EmailModule,
  ],
  controllers: [SellerConsignmentController, AdminConsignmentController],
  providers: [
    ConsignmentService,
    ConsignmentDispatchService,
    ConsignmentLabelService,
    ConsignmentCancelService,
    SellerJwtGuard,
    StaffJwtGuard,
  ],
})
export class ConsignmentModule {}
