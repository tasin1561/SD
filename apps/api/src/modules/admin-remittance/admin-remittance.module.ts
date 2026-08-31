import { Module } from '@nestjs/common';
import { SellerWalletWithdrawalModule } from '../seller-wallet-withdrawal/seller-wallet-withdrawal.module';
import { FxModule } from '../fx/fx.module';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { AuthCommonModule } from '../auth-common/auth-common.module';
import { SellerWalletModule } from '../seller-wallet/seller-wallet.module';
import { AdminRemittanceController } from './admin-remittance.controller';
import { RemittanceService } from './services/remittance.service';
import { TreasuryModule } from '../treasury/treasury.module';

@Module({
  imports: [
    AuthCommonModule,
    SellerWalletModule,
    FxModule,
    TreasuryModule,
    // Recording a remittance closes the withdrawal it paid. Not a
    // cycle: the withdrawal module imports nothing from here — it is a
    // leaf that exports one service.
    SellerWalletWithdrawalModule,
  ],
  controllers: [AdminRemittanceController],
  providers: [RemittanceService, StaffJwtGuard],
})
export class AdminRemittanceModule {}
