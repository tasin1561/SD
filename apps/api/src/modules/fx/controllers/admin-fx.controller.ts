import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Currency } from '@skydrop/db';
import { CurrentStaff } from '../../../common/decorators/current-staff.decorator';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStaff } from '../../../common/types/request';
import { SetFxRateDto } from '../dto/set-fx-rate.dto';
import { FxRateService, type FxRateView } from '../services/fx-rate.service';
import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';

@ApiTags('admin-fx')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@RequirePermissions('fx.view')
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
  @RequirePermissions('fx.manage')
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

  @Get('history/:from/:to')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Historical timeseries for a (from,to) pair (most recent first; max 200)',
  })
  history(
    @Param('from', new ParseEnumPipe(Currency)) from: Currency,
    @Param('to', new ParseEnumPipe(Currency)) to: Currency,
    @Query('limit') limit?: string,
  ) {
    return this.svc.listHistory(from, to, Number(limit) || 50);
  }
}
