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
import { TrackingEventsModule } from '../tracking-events/tracking-events.module';
import { CatalogReadModule } from '../catalog-read/catalog-read.module';
import { SystemIssuesModule } from '../system-issues/system-issues.module';

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
 *   - WMS-8e (2026-09-14): receive BOOKS the returned units into the
 *     receiving warehouse's RTO_HOLD bin (RETURN_RECEIVE +qty), so a
 *     received-but-undecided return is on the ledger where it physically
 *     is; finalize MOVES them out — to a sellable bin (FLOOR, or the
 *     shelf they were picked from when bin tracking is on), to the
 *     DAMAGED bin, or out of stock by an adjustment.
 *   - putaway — kept only for units a pre-WMS-8e finalize restocked into
 *     RTO_HOLD; a return finalized since is already on a sellable bin.
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
    // M10's shared primitive — the courier's scan times, which is what
    // "how long has this been waiting" actually means.
    TrackingEventsModule,
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
    // The product picture beside each line on the inspect screen.
    CatalogReadModule,
    // WMS-8e: a receive that could not book into a returns hold says so.
    SystemIssuesModule,
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
