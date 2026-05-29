import { Module } from '@nestjs/common';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { AuthCommonModule } from '../auth-common/auth-common.module';
import { AdminFxController } from './controllers/admin-fx.controller';
import { FxRateService } from './services/fx-rate.service';

/**
 * Module 16 — Multi-Currency & FX. INR is canonical (M0 convention);
 * BDT is display-only via this module's conversion. Historical FX
 * timeseries is Phase 1B (the FxRate table holds ONE current row
 * per `(from, to)` pair). External fetcher (exchangerate.host /
 * open-exchange-rates) is also Phase 1B.
 */
@Module({
  imports: [AuthCommonModule],
  controllers: [AdminFxController],
  providers: [FxRateService, StaffJwtGuard],
  exports: [FxRateService],
})
export class FxModule {}
