import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PickupRequestStatus } from '@skydrop/db';
import { CurrentStaff } from '../../../common/decorators/current-staff.decorator';
import {
  ClientInfo,
  type ClientInfoPayload,
} from '../../../common/decorators/client-info.decorator';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStaff } from '../../../common/types/request';
import { ClosePickupDto, RaisePickupDto, ReleasePickupDayDto } from '../dto/courier-ops.dto';
import { CourierPickupService, type PickupRequestView } from '../services/courier-pickup.service';
import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';

/**
 * Pickup requests — the van, not the parcel.
 *
 * Separate from the per-shipment controller because the grain is
 * genuinely different: one request covers a warehouse's whole handover
 * for a day. Supervisors only — this summons a vehicle, and the
 * one-per-day rule means a mistaken request blocks the real one.
 */
@ApiTags('admin-courier-pickups')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@RequirePermissions('courier.pickups.manage')
@Controller('admin/courier-ops/pickups')
export class AdminPickupController {
  constructor(private readonly pickups: CourierPickupService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Recent pickup requests, newest first.' })
  list(
    @Query('warehouseId') warehouseId?: string,
    @Query('fromDate') fromDate?: string,
  ): Promise<readonly PickupRequestView[]> {
    return this.pickups.list({
      ...(warehouseId === undefined ? {} : { warehouseId }),
      ...(fromDate === undefined ? {} : { fromDate }),
    });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Ask the courier to collect from a warehouse. ONE request covers the whole handover — 409 PICKUP_ALREADY_REQUESTED if the day is taken.',
  })
  raise(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Body() body: RaisePickupDto,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<PickupRequestView> {
    return this.pickups.raise(
      staff.id,
      {
        warehouseId: body.warehouseId,
        pickupDate: body.pickupDate,
        pickupTime: body.pickupTime,
        expectedPackageCount: body.expectedPackageCount,
      },
      ctx,
    );
  }

  @Patch(':requestId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mark a request collected, called off, or failed.',
  })
  close(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('requestId', new ParseUUIDPipe({ version: '7' })) requestId: string,
    @Body() body: ClosePickupDto,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<PickupRequestView> {
    return this.pickups.close(staff.id, requestId, PickupRequestStatus[body.status], ctx);
  }

  @Post(':requestId/release-day')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Free the day after confirming with the courier that a failed attempt never registered. Refused when Delhivery returned an id — cancel it in their panel instead. Audited HIGH.',
  })
  releaseDay(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('requestId', new ParseUUIDPipe({ version: '7' })) requestId: string,
    @Body() body: ReleasePickupDayDto,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<{ released: boolean }> {
    return this.pickups.releaseDay(staff.id, requestId, body.reason, ctx);
  }
}
