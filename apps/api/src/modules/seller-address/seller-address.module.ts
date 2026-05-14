import { Module } from '@nestjs/common';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { SellerOnboardingModule } from '../seller-onboarding/seller-onboarding.module';
import { SellerAddressController } from './seller-address.controller';
import { SellerAddressService } from './services/seller-address.service';

@Module({
  imports: [SellerOnboardingModule],
  controllers: [SellerAddressController],
  providers: [SellerAddressService, SellerJwtGuard],
  exports: [SellerAddressService],
})
export class SellerAddressModule {}
