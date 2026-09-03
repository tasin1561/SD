import { Module } from '@nestjs/common';
import { OrderChargesModule } from '../order-charges/order-charges.module';
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
 * Module 8 warehouse-rto module — reverted to a dispatch/pack-time
 * decrement model by Module 9 (the bug-1 fix; Model C, 2026-09-03,
 * later moved WHEN that decrement fires without touching this module):
 *   - receive (by AWB → RTO_RECEIVED)
 *   - inspect (rtoCondition + rtoDisposition per shipment_item)
 *   - finalize — RESTOCK → RETURN_RESTOCK +qty re-add; WRITE_OFF → no
 *     movement (the original decrement stands). No reservation release
 *     — the reservation was FULFILLED before RTO_RECEIVED is ever
 *     reachable (see rto-disposition.service.ts's top-of-file doc for
 *     why finalize does not need to know which matrix edge fulfilled
 *     it).
 *   - putaway — the restocked units land in RTO_HOLD, which is not
 *     pickable, because at finalize they are on the returns bench and
 *     not on a shelf. Putaway is the person who inspected them walking
 *     them somewhere and saying where; only then does INV-3 count them
 *     as available.
 *
 * Imports OrderModule (the read + saga transitions) and
 * InventorySharedModule for StockMutationService (INV-1 — the
 * RETURN_RESTOCK movement). InventoryStockModule is no longer imported:
 * finalize() does not release reservations (they are FULFILLED upstream
 * of RTO_RECEIVED), so StockReservationService is no longer used here.
 *
 * LEAF consumer — nothing imports `warehouse-rto`.
 */
@Module({
  imports: [
    OrderChargesModule,
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
