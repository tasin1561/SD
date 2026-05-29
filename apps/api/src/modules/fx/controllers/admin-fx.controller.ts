import { Body, Controller, Get, HttpCode, HttpStatus, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentStaff } from '../../../common/decorators/current-staff.decorator';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStaff } from '../../../common/types/request';
import { SetFxRateDto } from '../dto/set-fx-rate.dto';
import {
  FxRateService,
  type FxRateView,
} from '../services/fx-rate.service';

@ApiTags('admin-fx')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@Controller('admin/fx-rates')
export class AdminFxController {
  constructor(private readonly svc: FxRateService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List current FX rates (one row per (from,to) pair)' })
  list(): Promise<readonly FxRateView[]> {
    return this.svc.list();
  }

  @Patch()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Manual rate override — sets source=MANUAL, isManualOverride=true, audits MEDIUM with before/after.',
  })
  setManual(
    @Body() body: SetFxRateDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ): Promise<FxRateView> {
    return this.svc.setManualRate({
      from: body.fromCurrency,
      to: body.toCurrency,
      rate: body.rate,
      staffId: staff.id,
      reason: body.reason,
    });
  }
}
