import { Module } from '@nestjs/common';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { CatalogReadModule } from '../catalog-read/catalog-read.module';
import { OrderCoreModule } from '../order/order-core.module';
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
  imports: [CatalogReadModule, OrderCoreModule],
  controllers: [SellerOrderCsvImportController, SellerStagedOrderController],
  providers: [
    OrderCsvParserService,
    OrderCsvImportService,
    OrderCsvImportProcessorService,
    StagedOrderRowService,
    OrderCsvImportQueue,
    OrderCsvImportWorker,
    SellerJwtGuard,
  ],
  exports: [OrderCsvImportService],
})
export class OrderCsvImportModule {}
