import { Module } from '@nestjs/common';
import { SellerAuthModule } from '../seller-auth/seller-auth.module';
import { SellerOnboardingModule } from '../seller-onboarding/seller-onboarding.module';
import { SellerAddressController } from './seller-address.controller';
import { SellerAddressService } from './services/seller-address.service';

@Module({
  imports: [SellerAuthModule, SellerOnboardingModule],
  controllers: [SellerAddressController],
  providers: [SellerAddressService],
  exports: [SellerAddressService],
})
export class SellerAddressModule {}
