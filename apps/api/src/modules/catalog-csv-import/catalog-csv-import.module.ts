import { Module } from '@nestjs/common';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { SellerCsvImportController } from './seller-csv-import.controller';
import { CsvParserService } from './services/csv-parser.service';
import { CsvImportService } from './services/csv-import.service';

/**
 * CSV product/variant import. Parser + auto-detection (13), template /
 * presign / preview endpoints (14); the process worker (15) and the
 * error-report download (16) extend this module.
 */
@Module({
  controllers: [SellerCsvImportController],
  providers: [CsvParserService, CsvImportService, SellerJwtGuard],
  exports: [CsvParserService, CsvImportService],
})
export class CatalogCsvImportModule {}
