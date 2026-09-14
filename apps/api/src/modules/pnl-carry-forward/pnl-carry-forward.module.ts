import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { AuthCommonModule } from '../auth-common/auth-common.module';
import { SystemIssuesModule } from '../system-issues/system-issues.module';
import { TreasuryModule } from '../treasury/treasury.module';
import { AdminPnlPeriodController } from './controllers/admin-pnl-period.controller';
import { PnlPeriodWorker } from './queue/pnl-period.worker';
import { PnlNightlyGateService } from './services/pnl-nightly-gate.service';
import { PnlPeriodReadService } from './services/pnl-period-read.service';
import { PnlPeriodService } from './services/pnl-period.service';

/**
 * The carry-forward P&L (PNL-CF-1): closing months and carrying later
 * changes into the month then open.
 *
 * A LEAF: nothing imports it and it exports nothing. It reads the P&L only
 * through `PnlService` — the same engine /pnl runs — and never computes a
 * line of its own, so a frozen month is exactly what /pnl printed for it.
 */
@Module({
  imports: [PrismaModule, AuthCommonModule, TreasuryModule, SystemIssuesModule],
  controllers: [AdminPnlPeriodController],
  providers: [PnlPeriodService, PnlPeriodReadService, PnlNightlyGateService, PnlPeriodWorker],
})
export class PnlCarryForwardModule {}
