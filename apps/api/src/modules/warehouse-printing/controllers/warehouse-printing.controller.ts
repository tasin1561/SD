import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentStaff } from '../../../common/decorators/current-staff.decorator';
import {
  ClientInfo,
  type ClientInfoPayload,
} from '../../../common/decorators/client-info.decorator';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStaff } from '../../../common/types/request';
import { PrintQueueService, type PrintQueueRow } from '../services/print-queue.service';
import { LabelPrintService, type LabelSheetResult } from '../services/label-print.service';
import {
  PickBatchService,
  type PickBatchView,
  type PickListResult,
} from '../services/pick-batch.service';
import {
  ProductLocationService,
  type ProductLocationRow,
} from '../services/product-location.service';
import {
  PickBatchQueryDto,
  ProductLocationQueryDto,
  QueueQueryDto,
  ShipmentSelectionDto,
} from '../dto/warehouse-printing.dto';

/**
 * Print-first picking (2026-09-03).
 *
 * Two tabs, in the order the floor works:
 *
 *   1. LABELS — select parcels, print the sheet, confirm it came out.
 *      Only then can a parcel join a picking batch, because a picked
 *      parcel with no label sits on the bench with nothing saying where
 *      it goes.
 *   2. PICKING — select labelled parcels, print the consolidated list,
 *      confirm it came out. Confirming ALLOCATES the stock and sends the
 *      orders to be picked and packed.
 *
 * Building a sheet and confirming it was printed are deliberately
 * separate calls. A printer jams; a browser eats a download. Recording
 * "printed" because a PDF was generated moves parcels forward on the
 * strength of paper nobody held.
 */
@ApiTags('admin-warehouse-printing')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@RequirePermissions('warehouse.pick')
@Controller('admin/warehouse/printing')
export class WarehousePrintingController {
  constructor(
    private readonly queues: PrintQueueService,
    private readonly labels: LabelPrintService,
    private readonly batches: PickBatchService,
    private readonly locations: ProductLocationService,
  ) {}

  // ---------- tab 1: labels ----------

  @Get('label-queue')
  @ApiOperation({ summary: 'Parcels with a waybill whose label has not been printed' })
  labelQueue(@Query() q: QueueQueryDto): Promise<PrintQueueRow[]> {
    return this.queues.awaitingLabel(q.warehouseId);
  }

  @Post('labels/build')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'One A4 PDF of every selected label — stored courier labels for integrated parcels, a generated universal label for manual ones. Does NOT mark anything printed',
  })
  buildLabels(
    @Body() body: ShipmentSelectionDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ): Promise<LabelSheetResult> {
    return this.labels.build(body.shipmentIds, staff.id);
  }

  @Post('labels/confirm-printed')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'The operator confirms the labels are on paper; the parcels move to the picking tab',
  })
  confirmLabels(
    @Body() body: ShipmentSelectionDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<{ confirmed: number; alreadyPrinted: number }> {
    return this.labels.confirmPrinted(body.shipmentIds, staff.id, ctx);
  }

  // ---------- tab 2: picking ----------

  @Get('pick-queue')
  @ApiOperation({ summary: 'Labelled parcels not yet on a picking batch' })
  pickQueue(@Query() q: QueueQueryDto): Promise<PrintQueueRow[]> {
    return this.queues.awaitingPick(q.warehouseId);
  }

  @Post('pick-batches')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Claim the selected parcels for one walk' })
  createBatch(
    @Body() body: ShipmentSelectionDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<PickBatchView> {
    return this.batches.create(body.shipmentIds, staff.id, ctx);
  }

  @Post('pick-batches/:id/build-list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'The picking sheet: one row per variant, ordered by shelf, with locations and (in NORMAL mode) barcodes. ALLOCATES the stock so the printed locations are real',
  })
  buildList(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @CurrentStaff() staff: AuthenticatedStaff,
  ): Promise<PickListResult> {
    return this.batches.buildList(id, staff.id);
  }

  @Post('pick-batches/:id/confirm-printed')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'The picker confirms the sheet is in hand; the orders go to be picked' })
  confirmList(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<{ batchNumber: string; alreadyPrinted: boolean; transitioned: number }> {
    return this.batches.confirmPrinted(id, staff.id, ctx);
  }

  @Post('pick-batches/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Abandon a batch that was never printed; its parcels return to the queue',
  })
  cancelBatch(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<void> {
    return this.batches.cancel(id, staff.id, ctx);
  }

  @Get('pick-batches')
  @ApiOperation({
    summary: 'Past batches, newest first; search by batch number, order number or AWB',
  })
  listBatches(@Query() q: PickBatchQueryDto): Promise<PickBatchView[]> {
    return this.batches.list({ search: q.search, status: q.status, limit: q.limit });
  }

  @Get('pick-batches/:id')
  @ApiOperation({ summary: 'One batch, with its parcels — for reprinting' })
  getBatch(@Param('id', new ParseUUIDPipe({ version: '7' })) id: string): Promise<PickBatchView> {
    return this.batches.getById(id);
  }

  // ---------- the lookup a picker needs mid-walk ----------

  @Get('product-locations')
  @ApiOperation({
    summary:
      'Where a product is, by name, SKU or barcode. Non-pickable bins are included and marked — stock on the returns bench is still where it is',
  })
  productLocations(@Query() q: ProductLocationQueryDto): Promise<ProductLocationRow[]> {
    return this.locations.search(q.q, q.limit);
  }
}
