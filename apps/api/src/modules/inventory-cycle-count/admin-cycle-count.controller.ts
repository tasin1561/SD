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
  ListCycleCountsQueryDto,
  RecordCountItemsDto,
  ScheduleCycleCountDto,
} from './dto/cycle-count.dto';
import { CycleCountService, type CycleCountView } from './services/cycle-count.service';
import { RequirePermissions } from '../../common/auth/require-permissions.decorator';

const uuid = (): ParseUUIDPipe => new ParseUUIDPipe({ version: '7' });

/**
 * Admin-only cycle counts (locked decision #5). Staff JWT on every route;
 * RBAC scoping defers to Module 12 (phase-1a-debt).
 */
@ApiTags('admin-cycle-counts')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@RequirePermissions('inventory.view')
@Controller('admin/cycle-counts')
export class AdminCycleCountController {
  constructor(private readonly svc: CycleCountService) {}

  @Get()
  @ApiOperation({ summary: 'List cycle counts (filter by warehouse/status)' })
  list(
    @Query() query: ListCycleCountsQueryDto,
  ): Promise<{ items: CycleCountView[]; total: number; page: number; pageSize: number }> {
    return this.svc.list(query);
  }

  @Post()
  @RequirePermissions('inventory.cycle_counts.manage')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Schedule a cycle count' })
  schedule(
    @Body() body: ScheduleCycleCountDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<CycleCountView> {
    return this.svc.schedule(staff.id, body, ctx);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one cycle count' })
  get(@Param('id', uuid()) id: string): Promise<CycleCountView> {
    return this.svc.get(id);
  }

  @Post(':id/start')
  @RequirePermissions('inventory.cycle_counts.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'SCHEDULED -> IN_PROGRESS' })
  start(
    @Param('id', uuid()) id: string,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<CycleCountView> {
    return this.svc.start(staff.id, id, ctx);
  }

  @Post(':id/items')
  @RequirePermissions('inventory.cycle_counts.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record counted items (IN_PROGRESS); systemQty snapshotted now' })
  recordItems(
    @Param('id', uuid()) id: string,
    @Body() body: RecordCountItemsDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<CycleCountView> {
    return this.svc.recordItems(staff.id, id, body.items, ctx);
  }

  @Post(':id/complete')
  @RequirePermissions('inventory.cycle_counts.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'IN_PROGRESS -> COMPLETED; one PENDING CYCLE_COUNT adjustment per discrepancy',
  })
  complete(
    @Param('id', uuid()) id: string,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<CycleCountView> {
    return this.svc.complete(staff.id, id, ctx);
  }
}
