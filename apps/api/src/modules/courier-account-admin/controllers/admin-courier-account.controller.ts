import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CredentialEnvironment } from '@skydrop/db';
import { CurrentStaff } from '../../../common/decorators/current-staff.decorator';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStaff } from '../../../common/types/request';
import { CreateCourierAccountDto, UpdateCourierAccountDto } from '../dto/courier-account-admin.dto';
import {
  CourierAccountAdminService,
  type CourierAccountView,
} from '../services/courier-account-admin.service';
import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';

/**
 * Admin CRUD for CourierAccount (R1). RBAC is StaffJwtGuard-only for
 * now (mirrors AdminSystemSettingsController / AdminSellerSettingsController
 * — the service layer, plus CUR-1's decrypt-with-audit discipline, is
 * the actual integrity boundary).
 */
@ApiTags('admin-courier-accounts')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@RequirePermissions('courier.accounts.view')
@Controller('admin/courier-accounts')
export class AdminCourierAccountController {
  constructor(private readonly svc: CourierAccountAdminService) {}

  @Post()
  @RequirePermissions('courier.accounts.manage')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a courier account (encrypts + stores a new credential)' })
  create(
    @Body() body: CreateCourierAccountDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ): Promise<CourierAccountView> {
    return this.svc.createAccount(body, staff.id);
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List courier accounts, optionally filtered by courier/environment' })
  list(
    @Query('courierCode') courierCode?: string,
    @Query('environment') environment?: CredentialEnvironment,
  ): Promise<readonly CourierAccountView[]> {
    return this.svc.listAccounts(courierCode, environment);
  }

  @Patch(':accountId')
  @RequirePermissions('courier.accounts.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update a courier account (label/isActive/isDefault/notes)' })
  update(
    @Param('accountId') accountId: string,
    @Body() body: UpdateCourierAccountDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ): Promise<CourierAccountView> {
    return this.svc.updateAccount(accountId, body, staff.id);
  }
}
