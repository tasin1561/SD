import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
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
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStaff } from '../../../common/types/request';
import { MarginReportQueryDto, RegisterCourierWarehouseDto } from '../dto/courier-ops.dto';
import {
  CourierMarginReportService,
  type MarginReport,
} from '../services/courier-margin-report.service';
import {
  CourierWarehouseRegistrationService,
  type WarehouseRegistrationOutcome,
} from '../services/courier-warehouse-registration.service';
import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';

const DEFAULT_WINDOW_DAYS = 30;
const DEFAULT_LIMIT = 25;

/**
 * Account-level courier operations: what our lanes really earn, and
 * registering the buildings parcels leave from.
 *
 * Separate from the per-shipment and per-pickup controllers because the
 * grain is the ACCOUNT — these are things you do once, or periodically,
 * not per parcel.
 */
@ApiTags('admin-courier-network')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@RequirePermissions('courier.ops.view')
@Controller('admin/courier-ops')
export class AdminCourierNetworkController {
  constructor(
    private readonly margin: CourierMarginReportService,
    private readonly warehouses: CourierWarehouseRegistrationService,
  ) {}

  @Get('margin-report')
  @RequirePermissions('courier.margin.view')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'What we billed versus what Delhivery actually charged. SAMPLED — each row is a live rate-limited call, so the report states how many it priced and lists what it skipped. Never adjusts anything.',
  })
  marginReport(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Query() query: MarginReportQueryDto,
  ): Promise<MarginReport> {
    // Real courier cost is commercially sensitive and this is a P&L
    // question, so it stops at finance and the top.
    const to = query.to === undefined ? new Date() : new Date(query.to);
    const from =
      query.from === undefined
        ? new Date(to.getTime() - DEFAULT_WINDOW_DAYS * 86_400_000)
        : new Date(query.from);
    return this.margin.report(staff.id, {
      from,
      to,
      limit: query.limit ?? DEFAULT_LIMIT,
    });
  }

  @Post('warehouses')
  @RequirePermissions('courier.accounts.manage')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Register a warehouse as a Delhivery pickup location. The NAME is matched exactly on every shipment and is IMMUTABLE once registered — a stray space permanently breaks manifesting.',
  })
  registerWarehouse(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Body() body: RegisterCourierWarehouseDto,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<WarehouseRegistrationOutcome> {
    // The account is pulled OUT of the body: it selects which Delhivery
    // account to talk to, it is not part of the warehouse payload sent
    // to them.
    const { courierAccountId, ...warehouse } = body;
    return this.warehouses.register(staff.id, warehouse, ctx, courierAccountId ?? null);
  }

  @Put('warehouses')
  @RequirePermissions('courier.accounts.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Update a registered pickup location. Everything but the name can change; the name is the key.',
  })
  updateWarehouse(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Body() body: RegisterCourierWarehouseDto,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<WarehouseRegistrationOutcome> {
    const { courierAccountId, ...warehouse } = body;
    return this.warehouses.update(staff.id, warehouse, ctx, courierAccountId ?? null);
  }
}
