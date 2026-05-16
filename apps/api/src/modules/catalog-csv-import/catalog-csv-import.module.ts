import { Module } from '@nestjs/common';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { CatalogAttributeModule } from '../catalog-attribute/catalog-attribute.module';
import { CatalogVariantModule } from '../catalog-variant/catalog-variant.module';
import { SellerCsvImportController } from './seller-csv-import.controller';
import { CsvParserService } from './services/csv-parser.service';
import { CsvImportService } from './services/csv-import.service';
import { CsvImportProcessorService } from './services/csv-import-processor.service';
import { CsvImportQueue } from './queue/csv-import.queue';
import { CsvImportWorker } from './queue/csv-import.worker';

/**
 * CSV product/variant import. Parser + auto-detection (13), template /
 * presign / preview (14), process worker + idempotent re-upload (15);
 * the error-report download endpoint (16) extends this module.
 */
@Module({
  imports: [CatalogAttributeModule, CatalogVariantModule],
  controllers: [SellerCsvImportController],
  providers: [
    CsvParserService,
    CsvImportService,
    CsvImportProcessorService,
    CsvImportQueue,
    CsvImportWorker,
    SellerJwtGuard,
  ],
  exports: [CsvParserService, CsvImportService],
})
export class CatalogCsvImportModule {}
