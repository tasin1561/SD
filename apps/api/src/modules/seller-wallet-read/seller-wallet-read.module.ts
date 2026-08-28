import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { AuthCommonModule } from '../auth-common/auth-common.module';
import { FxModule } from '../fx/fx.module';
import { SellerWalletModule } from '../seller-wallet/seller-wallet.module';
import { SellerWalletController } from './seller-wallet.controller';
import { SellerCreditModule } from '../seller-credit/seller-credit.module';

@Module({
  imports: [
    // The seller sees their own credit standing on the wallet page,
    // so the refusal at order create is never the first they hear of it.
    SellerCreditModule,
    AuthCommonModule,
    SellerWalletModule,
    FxModule,
    SettingsModule,
  ],
  controllers: [SellerWalletController],
  providers: [SellerJwtGuard],
})
export class SellerWalletReadModule {}
