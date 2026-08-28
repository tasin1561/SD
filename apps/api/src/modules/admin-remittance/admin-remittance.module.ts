import { Module } from '@nestjs/common';
import { FxModule } from '../fx/fx.module';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { AuthCommonModule } from '../auth-common/auth-common.module';
import { SellerWalletModule } from '../seller-wallet/seller-wallet.module';
import { AdminRemittanceController } from './admin-remittance.controller';
import { RemittanceService } from './services/remittance.service';
import { TreasuryModule } from '../treasury/treasury.module';

@Module({
  imports: [AuthCommonModule, SellerWalletModule, FxModule, TreasuryModule],
  controllers: [AdminRemittanceController],
  providers: [RemittanceService, StaffJwtGuard],
})
export class AdminRemittanceModule {}
