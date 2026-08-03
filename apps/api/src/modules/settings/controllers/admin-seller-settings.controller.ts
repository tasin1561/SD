import {
  Body,
  Controller,
  Delete,
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
import { SetSellerSettingOverrideDto } from '../dto/set-seller-setting-override.dto';
import {
  SettingsResolverService,
  type ResolvedSetting,
  type SellerSettingOverrideView,
} from '../services/settings-resolver.service';
import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';

/**
 * Admin surface for the generic per-seller settings-override
 * mechanism. RBAC is StaffJwtGuard-only for now (mirrors
 * AdminSystemSettingsController — the service layer is the actual
 * integrity boundary via the sellerOverridable gate + bounds check).
 */
@ApiTags('admin-seller-settings')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@RequirePermissions('sellers.view')
@Controller('admin/sellers/:sellerId/settings')
export class AdminSellerSettingsController {
  constructor(private readonly svc: SettingsResolverService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List overridable settings for a seller (resolved value + source)' })
  list(
    @Param('sellerId') sellerId: string,
  ): Promise<readonly (ResolvedSetting & { systemDefault: unknown })[]> {
    return this.svc.listForSeller(sellerId);
  }

  @Patch(':key')
  @RequirePermissions('sellers.settings.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Set (or replace) a seller override (rejects NOT_SELLER_OVERRIDABLE / VALUE_TYPE_MISMATCH / INVALID_VALUE / OVERRIDE_OUT_OF_BOUNDS)',
  })
  setOverride(
    @Param('sellerId') sellerId: string,
    @Param('key') key: string,
    @Body() body: SetSellerSettingOverrideDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ): Promise<SellerSettingOverrideView> {
    return this.svc.setOverride(sellerId, key, body, staff.id);
  }

  @Delete(':key')
  @RequirePermissions('sellers.settings.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Clear a seller's override, reverting to the system default" })
  clearOverride(
    @Param('sellerId') sellerId: string,
    @Param('key') key: string,
    @CurrentStaff() staff: AuthenticatedStaff,
  ): Promise<void> {
    return this.svc.clearOverride(sellerId, key, staff.id);
  }
}
