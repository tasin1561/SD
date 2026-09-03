import { Module } from '@nestjs/common';

import { AuthCommonModule } from '../auth-common/auth-common.module';
import { InventorySharedModule } from '../inventory-shared/inventory-shared.module';
import { InventoryStockModule } from '../inventory-stock/inventory-stock.module';
import { OrderModule } from '../order/order.module';
import { PickAllocationModule } from '../pick-allocation/pick-allocation.module';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { WarehousePrintingController } from './controllers/warehouse-printing.controller';
import { LabelPrintService } from './services/label-print.service';
import { LabelSheetService } from './services/label-sheet.service';
import { ManualLabelPdfService } from './services/manual-label-pdf.service';
import { SkuLabelService } from './services/sku-label.service';
import { PickBatchNumberingService } from './services/pick-batch-numbering.service';
import { PickBatchService } from './services/pick-batch.service';
import { PickListPdfService } from './services/pick-list-pdf.service';
import { PrintQueueService } from './services/print-queue.service';
import { ProductLocationService } from './services/product-location.service';

/**
 * Print-first picking.
 *
 * A LEAF module: it exports nothing and nothing imports it. It reaches
 * the warehouse and stock layers through their published surfaces —
 * `OrderWriteService` for the lifecycle (ORD-3), `PickAllocationService`
 * for the WMS-3 retry wrapper, `StockReservationService` for the reads.
 * It writes no stock of its own.
 */
@Module({
  imports: [
    AuthCommonModule,
    InventorySharedModule,
    InventoryStockModule,
    OrderModule,
    // The R3 primitive, not the leaf module that also uses it.
    PickAllocationModule,
  ],
  controllers: [WarehousePrintingController],
  providers: [
    PrintQueueService,
    LabelPrintService,
    LabelSheetService,
    ManualLabelPdfService,
    SkuLabelService,
    PickBatchService,
    PickBatchNumberingService,
    PickListPdfService,
    ProductLocationService,
    StaffJwtGuard,
  ],
})
export class WarehousePrintingModule {}
