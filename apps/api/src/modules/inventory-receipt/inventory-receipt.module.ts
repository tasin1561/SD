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
  imports: [InventorySharedModule, CatalogReadModule, EmailModule, ConsignmentCoreModule],
  controllers: [SellerGoodsReceiptController, AdminGoodsReceiptController],
  providers: [GoodsReceiptService, TransitArrivalService, SellerJwtGuard, StaffJwtGuard],
  exports: [GoodsReceiptService],
})
export class InventoryReceiptModule {}
