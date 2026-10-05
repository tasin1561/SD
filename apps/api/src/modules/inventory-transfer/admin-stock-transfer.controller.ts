import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentStaff } from '../../common/decorators/current-staff.decorator';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStaff } from '../../common/types/request';
import { CreateStockTransferDto } from './dto/stock-transfer.dto';
import { StockTransferService, type StockTransferResult } from './services/stock-transfer.service';
import { RequirePermissions } from '../../common/auth/require-permissions.decorator';

/**
 * R6 — admin stock transfer (inter-warehouse, or bin-to-bin within one
 * warehouse). Staff JWT only, matching the sibling admin inventory
 * controllers; the conservation guarantees live in the service (one tx,
 * INV-1 sole writer, paired TRANSFER_OUT/TRANSFER_IN).
 */
@ApiTags('admin-stock-transfer')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@RequirePermissions('inventory.transfers.manage')
@Controller('admin/stock-transfers')
export class AdminStockTransferController {
  constructor(private readonly transfers: StockTransferService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Move stock between warehouses/bins as a paired TRANSFER_OUT + TRANSFER_IN in one transaction. Rejects INVALID_TRANSFER_QTY / TRANSFER_SOURCE_EQUALS_DEST / SOURCE_BIN_NOT_FOUND / DEST_BIN_* / DEST_BATCH_* / INSUFFICIENT_ON_HAND, and TRANSFER_WOULD_MAKE_STOCK_SELLABLE when the source is a bin a picker cannot reach (hold, damaged, quarantine, in transit) and the destination is one they can — use the return put-away, or an adjustment with a reason.',
  })
  create(
    @Body() body: CreateStockTransferDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ): Promise<StockTransferResult> {
    // Built field by field, NOT `transfer(body, …)`. The input carries
    // `allowFromNonPickableBin`, which waives the BIN-2 gate, and
    // handing the request body straight to the service would make that
    // waiver one JSON key away from any caller. The global
    // ValidationPipe's `forbidNonWhitelisted` would reject it today —
    // but that is a setting somewhere else, and an invariant that rests
    // on a setting somewhere else is one deploy from being untrue.
    return this.transfers.transfer(
      {
        sellerId: body.sellerId,
        variantId: body.variantId,
        qty: body.qty,
        sourceWarehouseId: body.sourceWarehouseId,
        sourceBinId: body.sourceBinId,
        sourceBatchId: body.sourceBatchId,
        destWarehouseId: body.destWarehouseId,
        destBinId: body.destBinId,
        destBatchId: body.destBatchId,
        ...(body.reason === undefined ? {} : { reason: body.reason }),
      },
      staff.id,
    );
  }
}
