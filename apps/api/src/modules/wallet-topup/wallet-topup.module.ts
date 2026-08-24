import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module';
import { FxModule } from '../fx/fx.module';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { SellerWalletModule } from '../seller-wallet/seller-wallet.module';
import { WalletTopupService } from './services/wallet-topup.service';
import { SellerTopupController } from './controllers/seller-topup.controller';
import { AdminTopupController } from './controllers/admin-topup.controller';
import { AdminPlatformBankAccountController } from './controllers/admin-platform-bank-account.controller';

/**
 * The wallet's inbound money path.
 *
 * A LEAF module — nothing imports it. It writes to the wallet only
 * through `WalletService.applyEntry` (W-2, the sole writer), and only
 * after an operator has confirmed the transfer against a bank statement.
 */
@Module({
  imports: [SellerWalletModule, FxModule, EmailModule],
  controllers: [SellerTopupController, AdminTopupController, AdminPlatformBankAccountController],
  providers: [WalletTopupService, SellerJwtGuard, StaffJwtGuard],
})
export class WalletTopupModule {}
