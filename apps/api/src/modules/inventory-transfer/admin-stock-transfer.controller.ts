import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentStaff } from '../../common/decorators/current-staff.decorator';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStaff } from '../../common/types/request';
import { CreateStockTransferDto } from './dto/stock-transfer.dto';
import {
  StockTransferService,
  type StockTransferResult,
} from './services/stock-transfer.service';

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
@Controller('admin/stock-transfers')
export class AdminStockTransferController {
  constructor(private readonly transfers: StockTransferService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Move stock between warehouses/bins as a paired TRANSFER_OUT + TRANSFER_IN in one transaction. Rejects INVALID_TRANSFER_QTY / TRANSFER_SOURCE_EQUALS_DEST / DEST_BIN_* / DEST_BATCH_* / INSUFFICIENT_ON_HAND',
  })
  create(
    @Body() body: CreateStockTransferDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ): Promise<StockTransferResult> {
    return this.transfers.transfer(body, staff.id);
  }
}
