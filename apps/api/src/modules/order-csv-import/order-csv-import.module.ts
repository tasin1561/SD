import { Module } from '@nestjs/common';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { StoreJwtGuard } from '../../common/guards/store-jwt.guard';
import { AuthCommonModule } from '../auth-common/auth-common.module';
import { CatalogReadModule } from '../catalog-read/catalog-read.module';
import { OrderCoreModule } from '../order/order-core.module';
import { StoreOrderCsvImportController } from './controllers/store-order-csv-import.controller';
import { StoreOrderCsvImportService } from './services/store-order-csv-import.service';
import { SellerOrderCsvImportController } from './seller-order-csv-import.controller';
import { OrderCsvParserService } from './services/order-csv-parser.service';
import { OrderCsvImportService } from './services/order-csv-import.service';
import { StagedOrderRowService } from './services/staged-order-row.service';
import { SellerStagedOrderController } from './controllers/seller-staged-order.controller';
import { OrderCsvImportProcessorService } from './services/order-csv-import-processor.service';
import { OrderCsvImportQueue } from './queue/order-csv-import.queue';
import { OrderCsvImportWorker } from './queue/order-csv-import.worker';

/**
 * Order CSV bulk import. Mirrors the Module-4 catalog importer. As an
 * INTRA-Module-6 submodule it imports OrderCoreModule (NOT the public
 * OrderModule) to consume OrderService (create / ORD-9 patch);
 * CatalogReadService (SKU→variant) comes from CatalogReadModule. Other
 * domains never get OrderService — they see only the OrderModule facade.
 */
@Module({
  // RS-5: a reseller store's CSV runs on this same machinery
  // (StoreOrderCsvImportController / Service); AuthCommonModule gives the
  // store guard its JWT verifier.
  imports: [AuthCommonModule, CatalogReadModule, OrderCoreModule],
  controllers: [
    SellerOrderCsvImportController,
    SellerStagedOrderController,
    StoreOrderCsvImportController,
  ],
  providers: [
    OrderCsvParserService,
    OrderCsvImportService,
    StoreOrderCsvImportService,
    OrderCsvImportProcessorService,
    StagedOrderRowService,
    OrderCsvImportQueue,
    OrderCsvImportWorker,
    SellerJwtGuard,
    StoreJwtGuard,
  ],
  exports: [OrderCsvImportService],
})
export class OrderCsvImportModule {}
