import { Module } from '@nestjs/common';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { AuthCommonModule } from '../auth-common/auth-common.module';
import { SellerWalletModule } from '../seller-wallet/seller-wallet.module';
import { SettingsModule } from '../settings/settings.module';
import { AdminWithdrawalRequestController } from './controllers/admin-withdrawal-request.controller';
import { SellerWithdrawalRequestController } from './controllers/seller-withdrawal-request.controller';
import { AutoWithdrawalSweepService } from './services/auto-withdrawal-sweep.service';
import { AutoWithdrawalQueue } from './queue/auto-withdrawal.queue';
import { WithdrawalRequestService } from './services/withdrawal-request.service';

/**
 * R2 (revised-plan roadmap) — seller-initiated withdrawal requests.
 * Leaf module: exports nothing (the request never itself moves money,
 * so nothing outside this module needs to call in — `markPaid` is the
 * admin's job via its own controller here).
 */
@Module({
  imports: [AuthCommonModule, SellerWalletModule, SettingsModule],
  controllers: [SellerWithdrawalRequestController, AdminWithdrawalRequestController],
  providers: [
    WithdrawalRequestService,
    AutoWithdrawalSweepService,
    AutoWithdrawalQueue,
    SellerJwtGuard,
    StaffJwtGuard,
  ],
})
export class SellerWalletWithdrawalModule {}
