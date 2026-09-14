import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';
import { CurrentStaff } from '../../../common/decorators/current-staff.decorator';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStaff } from '../../../common/types/request';
import { SetCreditAfterConfirmationDto } from '../dto/reseller-store-terms.dto';
import {
  CreditAfterConfirmationService,
  type CreditAfterConfirmationStatus,
} from '../services/credit-after-confirmation.service';

/**
 * RS-4 / decision 10 — the per-seller switch that lets a seller's
 * reseller-store terms credit a party N days after CONFIRMATION.
 *
 * On the SELLER, not on a store: it is Skydrop agreeing to front money
 * for that seller, and it governs every store they run. Reading it (and
 * which stores it flags) is open to anyone who reads reseller stores;
 * switching it is `reseller.credit_after_confirmation.enable` alone —
 * dangerous, SUPER_ADMIN by construction, reason ≥ 20 chars, audited
 * HIGH. The generic per-seller override endpoint refuses the key
 * (`DEDICATED_OVERRIDE_KEYS`), so this is the only door.
 */
@ApiTags('admin-reseller-credit-after-confirmation')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@RequirePermissions('reseller.stores.view', 'reseller.credit_after_confirmation.enable')
@Controller('admin/sellers/:sellerId/reseller-credit-after-confirmation')
export class AdminCreditAfterConfirmationController {
  constructor(private readonly credit: CreditAfterConfirmationService) {}

  @Get()
  @ApiOperation({ summary: 'Whether it is on for this seller, and which stores it flags' })
  status(
    @Param('sellerId', new ParseUUIDPipe()) sellerId: string,
  ): Promise<CreditAfterConfirmationStatus> {
    return this.credit.status(sellerId);
  }

  @Put()
  @RequirePermissions('reseller.credit_after_confirmation.enable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Switch it on or off for this seller (HIGH audit; switching off rewrites no terms)',
  })
  set(
    @Param('sellerId', new ParseUUIDPipe()) sellerId: string,
    @Body() body: SetCreditAfterConfirmationDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ): Promise<CreditAfterConfirmationStatus> {
    return this.credit.set(
      sellerId,
      { enabled: body.enabled, reason: body.reason.trim() },
      staff.id,
    );
  }
}
