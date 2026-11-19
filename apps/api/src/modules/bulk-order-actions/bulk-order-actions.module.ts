import { Module } from '@nestjs/common';

import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { BulkOrderExportService } from './services/bulk-order-export.service';

/**
 * Bulk order actions, Phase A (read-only and non-money). A LEAF: it owns
 * the order CSV and nothing else, and reads orders under a scope handed to
 * it by the console's own controller. The controllers live beside the
 * services they wrap (order, reseller-order, invoice, warehouse-printing).
 */
@Module({
  imports: [PrismaModule],
  providers: [BulkOrderExportService],
  exports: [BulkOrderExportService],
})
export class BulkOrderActionsModule {}
