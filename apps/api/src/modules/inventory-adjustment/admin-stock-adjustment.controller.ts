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
  CreateStockAdjustmentDto,
  ListStockAdjustmentsQueryDto,
  RejectAdjustmentDto,
} from './dto/stock-adjustment.dto';
import {
  StockAdjustmentService,
  type StockAdjustmentView,
} from './services/stock-adjustment.service';

const uuid = (): ParseUUIDPipe => new ParseUUIDPipe({ version: '7' });

/**
 * Admin stock adjustments. Staff JWT on every route; RBAC scoping defers
 * to Module 12 (phase-1a-debt). Approve/reject + executor worker land in
 * commit 20.
 */
@ApiTags('admin-stock-adjustments')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@Controller('admin/stock-adjustments')
export class AdminStockAdjustmentController {
  constructor(private readonly svc: StockAdjustmentService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Initiate an adjustment; auto-executes if below the approval threshold' })
  initiate(
    @Body() body: CreateStockAdjustmentDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<StockAdjustmentView> {
    return this.svc.initiate(staff.id, body, ctx);
  }

  @Get()
  @ApiOperation({ summary: 'List stock adjustments (filter by seller/warehouse/status)' })
  list(
    @Query() query: ListStockAdjustmentsQueryDto,
  ): Promise<{ items: StockAdjustmentView[]; total: number; page: number; pageSize: number }> {
    return this.svc.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one stock adjustment' })
  get(@Param('id', uuid()) id: string): Promise<StockAdjustmentView> {
    return this.svc.get(id);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve a PENDING adjustment (enqueues the executor)' })
  approve(
    @Param('id', uuid()) id: string,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<StockAdjustmentView> {
    return this.svc.approve(staff.id, id, ctx);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject a PENDING adjustment' })
  reject(
    @Param('id', uuid()) id: string,
    @Body() body: RejectAdjustmentDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<StockAdjustmentView> {
    return this.svc.reject(staff.id, id, body.reason, ctx);
  }
}
