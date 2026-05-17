import { Module } from '@nestjs/common';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { CatalogReadModule } from '../catalog-read/catalog-read.module';
import { OrderModule } from '../order/order.module';
import { SellerOrderCsvImportController } from './seller-order-csv-import.controller';
import { OrderCsvParserService } from './services/order-csv-parser.service';
import { OrderCsvImportService } from './services/order-csv-import.service';
import { OrderCsvImportProcessorService } from './services/order-csv-import-processor.service';
import { OrderCsvImportQueue } from './queue/order-csv-import.queue';
import { OrderCsvImportWorker } from './queue/order-csv-import.worker';

/**
 * Order CSV bulk import. Mirrors the Module-4 catalog importer.
 * Consumes OrderService (create / ORD-9 patch) from OrderModule and
 * CatalogReadService (SKU→variant) from CatalogReadModule — both
 * sanctioned cross-module boundaries.
 */
@Module({
  imports: [CatalogReadModule, OrderModule],
  controllers: [SellerOrderCsvImportController],
  providers: [
    OrderCsvParserService,
    OrderCsvImportService,
    OrderCsvImportProcessorService,
    OrderCsvImportQueue,
    OrderCsvImportWorker,
    SellerJwtGuard,
  ],
  exports: [OrderCsvImportService],
})
export class OrderCsvImportModule {}
