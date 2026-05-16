import { Module } from '@nestjs/common';
import { CsvParserService } from './services/csv-parser.service';

/**
 * CSV product/variant import. Commit 13 lands the parser + auto-detection
 * only; preview/mapping endpoints (14), the process worker (15), and the
 * error-report download (16) extend this module.
 */
@Module({
  providers: [CsvParserService],
  exports: [CsvParserService],
})
export class CatalogCsvImportModule {}
