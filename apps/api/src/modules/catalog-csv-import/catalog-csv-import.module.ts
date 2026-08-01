import { Module } from '@nestjs/common';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { CatalogVariantModule } from '../catalog-variant/catalog-variant.module';
import { SellerCsvImportController } from './seller-csv-import.controller';
import { SellerCsvMappingController } from './seller-csv-mapping.controller';
import { CsvParserService } from './services/csv-parser.service';
import { CsvImportService } from './services/csv-import.service';
import { CsvImportProcessorService } from './services/csv-import-processor.service';
import { CsvMappingService } from './services/csv-mapping.service';
import { CsvImportQueue } from './queue/csv-import.queue';
import { CsvImportWorker } from './queue/csv-import.worker';

/**
 * CSV product/variant import. Parser + auto-detection (13), template /
 * presign / preview (14), process worker + idempotent re-upload (15),
 * error-report download (16), saved column-mapping CRUD wired into
 * preview/process (17).
 */
@Module({
  imports: [CatalogVariantModule],
  controllers: [SellerCsvImportController, SellerCsvMappingController],
  providers: [
    CsvParserService,
    CsvImportService,
    CsvImportProcessorService,
    CsvMappingService,
    CsvImportQueue,
    CsvImportWorker,
    SellerJwtGuard,
  ],
  exports: [CsvParserService, CsvImportService, CsvMappingService],
})
export class CatalogCsvImportModule {}
