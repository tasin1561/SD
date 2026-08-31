import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { ActorType } from '@skydrop/db';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentStaff } from '../../../common/decorators/current-staff.decorator';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStaff } from '../../../common/types/request';
import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { CourierEnablementService } from '../../courier-shared/services/courier-enablement.service';
import { SetCourierActiveDto } from '../dto/courier-enablement.dto';

/**
 * The master on/off per courier.
 *
 * Separate from `admin/courier-accounts`, which manages the CREDENTIALS
 * of one account at one courier. This is a level above: whether the
 * courier is in service for us at all.
 *
 * OFF stops new intake and nothing else — see CourierEnablementService
 * for why in-flight parcels must keep being tracked.
 */
@ApiTags('admin-couriers')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@RequirePermissions('courier.accounts.view')
@Controller('admin/couriers')
export class AdminCourierController {
  constructor(
    private readonly enablement: CourierEnablementService,
    private readonly audit: AuditLogService,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Every courier and whether it is taking new parcels' })
  async list(): Promise<{
    readonly couriers: ReadonlyArray<{
      readonly code: string;
      readonly name: string;
      readonly isActive: boolean;
      readonly supportsCod: boolean;
      readonly supportsPrepaid: boolean;
      readonly integrationType: string;
    }>;
  }> {
    return { couriers: await this.enablement.list() };
  }

  @Patch(':courierCode')
  @RequirePermissions('courier.accounts.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Switch a courier on or off for NEW parcels' })
  async setActive(
    @Param('courierCode') courierCode: string,
    @Body() body: SetCourierActiveDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ): Promise<{
    readonly courierCode: string;
    readonly isActive: boolean;
    readonly changed: boolean;
  }> {
    const { changed } = await this.enablement.setActive(courierCode, body.isActive);

    // HIGH either way: switching one off diverts every parcel that
    // would have gone to them, and switching one on starts sending
    // real parcels to a company. Both are worth finding in the log
    // later without knowing what to search for.
    await this.audit.log({
      actorType: ActorType.STAFF,
      staffUserId: staff.id,
      action: body.isActive ? 'courier.enabled' : 'courier.disabled',
      entityType: 'courier',
      entityId: null,
      severity: 'HIGH',
      metadata: { courierCode, isActive: body.isActive, changed, reason: body.reason },
    });

    return { courierCode, isActive: body.isActive, changed };
  }
}
