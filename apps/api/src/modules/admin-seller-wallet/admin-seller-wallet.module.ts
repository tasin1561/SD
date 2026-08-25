import { Module } from '@nestjs/common';
import { AuthCommonModule } from '../auth-common/auth-common.module';
import { SellerWalletWithdrawalModule } from '../seller-wallet-withdrawal/seller-wallet-withdrawal.module';
import { SettingsModule } from '../settings/settings.module';
import { WalletTopupModule } from '../wallet-topup/wallet-topup.module';
import { AdminSellerWalletController } from './controllers/admin-seller-wallet.controller';
import { AdminSellerWalletService } from './services/admin-seller-wallet.service';

/**
 * A LEAF: nothing imports it, and it exports nothing. It reads what the
 * money modules already own rather than growing a second way to compute
 * a balance — two answers to "what is this seller's balance" is the one
 * outcome a finance screen must never produce.
 */
@Module({
  imports: [AuthCommonModule, SettingsModule, WalletTopupModule, SellerWalletWithdrawalModule],
  controllers: [AdminSellerWalletController],
  providers: [AdminSellerWalletService],
})
export class AdminSellerWalletModule {}
