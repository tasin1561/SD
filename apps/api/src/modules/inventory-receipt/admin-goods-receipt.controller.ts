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
import { CurrentStaff } from '../../common/decorators/current-staff.decorator';
import { ClientInfo, type ClientInfoPayload } from '../../common/decorators/client-info.decorator';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStaff } from '../../common/types/request';
import {
  ListAdminGoodsReceiptsQueryDto,
  RecordReceiptLinesDto,
} from './dto/admin-goods-receipt.dto';
import {
  GoodsReceiptService,
  type GoodsReceiptView,
} from './services/goods-receipt.service';

const uuid = (): ParseUUIDPipe => new ParseUUIDPipe({ version: '7' });

/**
 * Admin goods-receipt recording. Staff JWT on every route; RBAC scoping
 * defers to Module 12 (phase-1a-debt). Stock-writing completion and
 * discrepancy resolution land in commit 18.
 */
@ApiTags('admin-goods-receipts')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@Controller('admin/goods-receipts')
export class AdminGoodsReceiptController {
  constructor(private readonly svc: GoodsReceiptService) {}

  @Get()
  @ApiOperation({ summary: 'List goods receipts (filter by seller/warehouse/status)' })
  list(
    @Query() query: ListAdminGoodsReceiptsQueryDto,
  ): Promise<{ items: GoodsReceiptView[]; total: number; page: number; pageSize: number }> {
    return this.svc.listForAdmin(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one goods receipt' })
  get(@Param('id', uuid()) id: string): Promise<GoodsReceiptView> {
    return this.svc.getForAdmin(id);
  }

  @Post(':id/start-receiving')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'PENDING -> ARRIVING; marks the receiving staff' })
  startReceiving(
    @Param('id', uuid()) id: string,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<GoodsReceiptView> {
    return this.svc.startReceiving(staff.id, id, ctx);
  }

  @Post(':id/lines')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record actual received/damaged counts + putaway bins (ARRIVING)' })
  recordLines(
    @Param('id', uuid()) id: string,
    @Body() body: RecordReceiptLinesDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<GoodsReceiptView> {
    return this.svc.recordLines(staff.id, id, body.lines, ctx);
  }
}
