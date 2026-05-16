import { Module } from '@nestjs/common';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { CatalogReadModule } from '../catalog-read/catalog-read.module';
import { InventorySharedModule } from '../inventory-shared/inventory-shared.module';
import { SellerGoodsReceiptController } from './seller-goods-receipt.controller';
import { GoodsReceiptService } from './services/goods-receipt.service';

/**
 * Goods receipts. Seller declaration lifecycle here; admin recording and
 * the stock-writing completion / discrepancy resolution extend this
 * module in commits 17–18.
 */
@Module({
  imports: [InventorySharedModule, CatalogReadModule],
  controllers: [SellerGoodsReceiptController],
  providers: [GoodsReceiptService, SellerJwtGuard],
  exports: [GoodsReceiptService],
})
export class InventoryReceiptModule {}
