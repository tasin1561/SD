import { Module } from '@nestjs/common';
import { AuthCommonModule } from '../auth-common/auth-common.module';
import { SystemIssuesModule } from '../system-issues/system-issues.module';
import { TreasuryModule } from '../treasury/treasury.module';
import { AdminCourierWalletController } from './controllers/admin-courier-wallet.controller';
import { CourierWalletReadService } from './services/courier-wallet-read.service';
import { CourierWalletRecordService } from './services/courier-wallet-record.service';

/**
 * The human half of the courier-wallet reconciliation.
 *
 * The sweep that READS the courier's wallet lives in `courier-portal`,
 * which runs in its own process and never appears in `AppModule` — a
 * browser must not run beside customer HTTP. This module is the API
 * side: it reads what that sweep wrote and lets a person answer it.
 *
 * A LEAF — exports nothing, and nothing imports it.
 */
@Module({
  imports: [TreasuryModule, AuthCommonModule, SystemIssuesModule],
  controllers: [AdminCourierWalletController],
  providers: [CourierWalletReadService, CourierWalletRecordService],
})
export class CourierWalletModule {}
