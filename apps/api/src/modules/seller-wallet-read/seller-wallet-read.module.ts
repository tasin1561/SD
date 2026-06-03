import { Module } from '@nestjs/common';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { AuthCommonModule } from '../auth-common/auth-common.module';
import { SellerWalletModule } from '../seller-wallet/seller-wallet.module';
import { SellerWalletController } from './seller-wallet.controller';

@Module({
  imports: [AuthCommonModule, SellerWalletModule],
  controllers: [SellerWalletController],
  providers: [SellerJwtGuard],
})
export class SellerWalletReadModule {}
