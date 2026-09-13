import { Module } from '@nestjs/common';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { CatalogReadModule } from '../catalog-read/catalog-read.module';
import { EmailModule } from '../email/email.module';
import { InventorySharedModule } from '../inventory-shared/inventory-shared.module';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { SellerGoodsReceiptController } from './seller-goods-receipt.controller';
import { AdminGoodsReceiptController } from './admin-goods-receipt.controller';
import { GoodsReceiptService } from './services/goods-receipt.service';
import { TransitArrivalService } from './services/transit-arrival.service';
import { ConsignmentCoreModule } from '../consignment-core/consignment-core.module';
import { TicketModule } from '../ticket/ticket.module';
import { NotificationAudienceModule } from '../notification-audience/notification-audience.module';
import { SellerNotificationPreferenceModule } from '../seller-notification-preference/seller-notification-preference.module';
import { ReceiptShortfallTicketService } from './services/receipt-shortfall-ticket.service';

/**
 * Goods receipts — the counting station, invoked once per consignment LEG.
 *
 * Imports `consignment-core` (the R3 primitive) rather than the
 * consignment module, which imports THIS one: completing a leg has to
 * move the consignment's derived status and write its timeline event, and
 * the reverse import would close a cycle.
 */
@Module({
  // StockAlertService + StockCacheService come from InventorySharedModule
  // now (deviation #7) — no InventoryStockModule dependency needed.
  imports: [
    InventorySharedModule,
    CatalogReadModule,
    EmailModule,
    ConsignmentCoreModule,
    // TKT-3: a short count opens a ticket; a surplus tells the seller.
    // The ticket module imports nothing inventory-shaped, so no cycle.
    TicketModule,
    NotificationAudienceModule,
    SellerNotificationPreferenceModule,
  ],
  controllers: [SellerGoodsReceiptController, AdminGoodsReceiptController],
  providers: [
    GoodsReceiptService,
    TransitArrivalService,
    ReceiptShortfallTicketService,
    SellerJwtGuard,
    StaffJwtGuard,
  ],
  exports: [GoodsReceiptService],
})
export class InventoryReceiptModule {}
