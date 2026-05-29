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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentStaff } from '../../../common/decorators/current-staff.decorator';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStaff } from '../../../common/types/request';
import { UpdateSystemSettingDto } from '../dto/update-system-setting.dto';
import {
  SystemSettingsService,
  type SystemSettingFull,
  type SystemSettingsCategoryGroup,
} from '../services/system-settings.service';

/**
 * Admin system-settings endpoints (Module 14). RBAC is currently
 * StaffJwtGuard-only (the broader requireStaffRoles sweep is a M12
 * fast-follow); the service layer is the actual integrity boundary
 * (audit log + isEditableByAdmin gate).
 */
@ApiTags('admin-system-settings')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@Controller('admin/system-settings')
export class AdminSystemSettingsController {
  constructor(private readonly svc: SystemSettingsService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List all settings, grouped by category' })
  list(): Promise<readonly SystemSettingsCategoryGroup[]> {
    return this.svc.list();
  }

  @Get(':key')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get one setting WITH the raw value (for the edit modal)',
  })
  getByKey(@Param('key') key: string): Promise<SystemSettingFull> {
    return this.svc.getByKey(key);
  }

  @Patch(':key')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Update a setting (type-aware; rejects NOT_EDITABLE / VALUE_TYPE_MISMATCH / INVALID_VALUE)',
  })
  update(
    @Param('key') key: string,
    @Body() body: UpdateSystemSettingDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ): Promise<SystemSettingFull> {
    return this.svc.updateValue(key, body, staff.id);
  }
}
