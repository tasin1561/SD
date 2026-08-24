import { Module } from '@nestjs/common';
import { SellerRestrictionModule } from '../seller-restriction/seller-restriction.module';
import { OrderModule } from '../order/order.module';
import { InventorySharedModule } from '../inventory-shared/inventory-shared.module';
import { RtoReceiptService } from './services/rto-receipt.service';
import { RtoRestockTargetService } from './services/rto-restock-target.service';
import { RtoInspectionService } from './services/rto-inspection.service';
import { RtoDispositionService } from './services/rto-disposition.service';
import { RtoReadService } from './services/rto-read.service';
import { RtoPutawayService } from './services/rto-putaway.service';
import { InventoryTransferModule } from '../inventory-transfer/inventory-transfer.module';
import { WarehouseRtoController } from './controllers/warehouse-rto.controller';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { TicketModule } from '../ticket/ticket.module';
import { InboundFreightModule } from '../inbound-freight/inbound-freight.module';
import { SellerWalletAccrualModule } from '../seller-wallet-accrual/seller-wallet-accrual.module';

/**
 * Module 8 warehouse-rto module — reverted to MODEL A by Module 9
 * (the bug-1 fix):
 *   - receive (by AWB → RTO_RECEIVED)
 *   - inspect (rtoCondition + rtoDisposition per shipment_item)
 *   - finalize — Model A: RESTOCK → RETURN_RESTOCK +qty re-add;
 *     WRITE_OFF → no movement (dispatch decrement stands). No
 *     reservation release — the reservation was FULFILLED at DISPATCH.
 *   - putaway — the restocked units land in RTO_HOLD, which is not
 *     pickable, because at finalize they are on the returns bench and
 *     not on a shelf. Putaway is the person who inspected them walking
 *     them somewhere and saying where; only then does INV-3 count them
 *     as available.
 *
 * Imports OrderModule (the read + saga transitions) and
 * InventorySharedModule for StockMutationService (INV-1 — the
 * RETURN_RESTOCK movement). InventoryStockModule is no longer imported:
 * Model A's finalize() does not release reservations (Module 9 fulfills
 * them at dispatch), so StockReservationService is no longer used here.
 *
 * LEAF consumer — nothing imports `warehouse-rto`.
 */
@Module({
  imports: [
    OrderModule,
    InventorySharedModule,
    TicketModule,
    // R3: a written-off unit still owes its inbound-freight share.
    InboundFreightModule,
    // Return putaway is an ordinary same-warehouse bin transfer — it
    // goes through the shared transfer service so the move lands in the
    // ledger as a paired OUT/IN like any other (INV-1).
    InventoryTransferModule,
    // A returned parcel is charged delivery + RTO fee at receive.
    SellerWalletAccrualModule,
    SellerRestrictionModule,
  ],
  controllers: [WarehouseRtoController],
  providers: [
    RtoReceiptService,
    RtoRestockTargetService,
    RtoInspectionService,
    RtoDispositionService,
    RtoReadService,
    RtoPutawayService,
    StaffJwtGuard,
  ],
})
export class WarehouseRtoModule {}
